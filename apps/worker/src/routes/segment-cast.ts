/**
 * プロラボ独自機能: セグメント配信（中間レイヤー）
 * 1:1より広く一斉配信より狭い、属性ベースの店舗内配信。店舗カウンセラー(staff)が自店で実行可能。
 * 絞り込み: タグ / スコア / 担当者・購入コース(SF風メタdata) / 最終接触日数。
 *
 * POST /api/segment-cast/preview { lineAccountId, filters }  -> 対象件数 + サンプル
 * POST /api/segment-cast         { lineAccountId, filters, message }
 * GET  /api/segment-casts?lineAccountId=                     -> 配信履歴
 */
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { resolveOrg } from '../lib/org.js';

export const segmentCast = new Hono<Env>();

type Staff = { id: string; name: string; role: 'owner' | 'admin' | 'staff' };

interface Filters {
  tagIds?: string[];
  scoreMin?: number;
  scoreMax?: number;
  tantou?: string; // 担当者(SF)
  course?: string; // 購入コース(SF)
  lastContactDaysMax?: number; // 最終接触からの経過(以内)
}

// 4階層ロールでアクセス可否を判定（経営層=全店, エリアMgr=担当エリア, 店長/現場=自店）
async function canAccess(db: D1Database, staff: Staff, accountId: string): Promise<boolean> {
  const org = await resolveOrg(db, staff);
  return org.allStores || org.storeIds.includes(accountId);
}

/** filters → WHERE句 + bindings（friends f を対象、store/follow は呼び出し側で前置） */
function buildWhere(f: Filters): { sql: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (f.tagIds && f.tagIds.length) {
    for (const t of f.tagIds) {
      clauses.push(`EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`);
      binds.push(t);
    }
  }
  if (typeof f.scoreMin === 'number') { clauses.push(`f.score >= ?`); binds.push(f.scoreMin); }
  if (typeof f.scoreMax === 'number') { clauses.push(`f.score <= ?`); binds.push(f.scoreMax); }
  if (f.tantou) { clauses.push(`json_extract(f.metadata, '$.tantou') = ?`); binds.push(f.tantou); }
  if (f.course) { clauses.push(`json_extract(f.metadata, '$.course') = ?`); binds.push(f.course); }
  if (typeof f.lastContactDaysMax === 'number') {
    clauses.push(
      `EXISTS (SELECT 1 FROM messages_log m WHERE m.friend_id = f.id AND m.direction='incoming'
               AND m.created_at >= datetime('now', '-' || ? || ' days', '+9 hours'))`,
    );
    binds.push(f.lastContactDaysMax);
  }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', binds };
}

function jstNow(): string {
  return new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, -1) + '+09:00';
}

segmentCast.post('/api/segment-cast/preview', async (c) => {
  const staff = c.get('staff') as Staff;
  const b = (await c.req.json().catch(() => ({}))) as { lineAccountId?: string; filters?: Filters };
  if (!b.lineAccountId) return c.json({ error: 'lineAccountId required' }, 400);
  if (!(await canAccess(c.env.DB, staff, b.lineAccountId))) return c.json({ error: 'この店舗へのアクセス権がありません' }, 403);

  const { sql, binds } = buildWhere(b.filters ?? {});
  const base = `FROM friends f WHERE f.line_account_id = ? AND f.is_following = 1${sql}`;
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${base}`).bind(b.lineAccountId, ...binds).first<{ n: number }>();
  const sample = await c.env.DB
    .prepare(`SELECT f.display_name, json_extract(f.metadata,'$.tantou') AS tantou, json_extract(f.metadata,'$.course') AS course, f.score ${base} ORDER BY f.score DESC LIMIT 10`)
    .bind(b.lineAccountId, ...binds)
    .all();
  return c.json({ count: countRow?.n ?? 0, sample: sample.results ?? [] });
});

segmentCast.post('/api/segment-cast', async (c) => {
  const staff = c.get('staff') as Staff;
  const b = (await c.req.json().catch(() => ({}))) as { lineAccountId?: string; filters?: Filters; message?: string; imageUrl?: string };
  if (!b.lineAccountId || !b.message?.trim()) return c.json({ error: 'lineAccountId and message required' }, 400);
  if (!(await canAccess(c.env.DB, staff, b.lineAccountId))) return c.json({ error: 'この店舗へのアクセス権がありません' }, 403);

  const { sql, binds } = buildWhere(b.filters ?? {});
  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM friends f WHERE f.line_account_id = ? AND f.is_following = 1${sql}`)
    .bind(b.lineAccountId, ...binds)
    .first<{ n: number }>();
  const target = countRow?.n ?? 0;
  const id = crypto.randomUUID();
  // NOTE: 実際のLINE送信は各OA接続後に既存配信パイプラインへ接続。現時点は配信ログを記録。
  await c.env.DB.prepare(
    `INSERT INTO segment_casts (id, line_account_id, message, image_url, filters, target_count, sent_by, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?)`,
  )
    .bind(id, b.lineAccountId, b.message, (b.imageUrl ?? '').toString().trim() || null, JSON.stringify(b.filters ?? {}), target, staff?.name ?? 'Owner', jstNow())
    .run();
  return c.json({ id, target });
});

segmentCast.get('/api/segment-casts', async (c) => {
  const staff = c.get('staff') as Staff;
  const accountId = new URL(c.req.url).searchParams.get('lineAccountId');
  if (!accountId) return c.json({ error: 'lineAccountId required' }, 400);
  if (!(await canAccess(c.env.DB, staff, accountId))) return c.json({ error: 'forbidden' }, 403);
  const res = await c.env.DB
    .prepare(`SELECT * FROM segment_casts WHERE line_account_id = ? ORDER BY created_at DESC LIMIT 100`)
    .bind(accountId)
    .all();
  return c.json({ data: res.results ?? [] });
});
