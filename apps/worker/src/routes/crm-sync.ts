/**
 * プロラボ独自機能: CRM / Salesforce 属性取込
 * SFからエクスポートした顧客属性(担当者/購入コース/LTV等)を、突合キーで friends に名寄せし
 * friends.metadata(JSON) にマージする。→ セグメント配信が実データで動く。
 * ライブSF API直結は SALESFORCE_* 認証情報が入り次第この上に追加する想定。
 *
 * POST /api/crm-sync/preview { keyField, rows:[{key, attrs:{...}}] }
 * POST /api/crm-sync         { keyField, rows, source? }
 * GET  /api/crm-sync/status
 */
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

export const crmSync = new Hono<Env>();

type KeyField = 'line_user_id' | 'sf_id' | 'phone';
interface Row { key: string; attrs: Record<string, unknown> }

function matchSql(keyField: KeyField): string {
  if (keyField === 'line_user_id') return `SELECT id, metadata FROM friends WHERE line_user_id = ?`;
  if (keyField === 'sf_id') return `SELECT id, metadata FROM friends WHERE json_extract(metadata,'$.sf_id') = ?`;
  return `SELECT id, metadata FROM friends WHERE json_extract(metadata,'$.phone') = ?`;
}

function jstNow(): string {
  return new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, -1) + '+09:00';
}

crmSync.post('/api/crm-sync/preview', requireRole('owner', 'admin'), async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { keyField?: KeyField; rows?: Row[] };
  const keyField = (b.keyField ?? 'sf_id') as KeyField;
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [];
  if (!rows.length) return c.json({ error: 'rows required' }, 400);

  let matched = 0;
  const sample: Array<{ key: string; name: string; attrs: Record<string, unknown> }> = [];
  const stmt = c.env.DB.prepare(matchSql(keyField));
  for (const r of rows) {
    if (!r.key) continue;
    const hit = await stmt.bind(String(r.key)).first<{ id: string }>();
    if (hit) {
      matched++;
      if (sample.length < 8) {
        const f = await c.env.DB.prepare(`SELECT display_name FROM friends WHERE id = ?`).bind(hit.id).first<{ display_name: string }>();
        sample.push({ key: r.key, name: f?.display_name ?? '—', attrs: r.attrs });
      }
    }
  }
  return c.json({ total: rows.length, matched, unmatched: rows.length - matched, sample, keyField });
});

/** タグ名→tag_id を取得（無ければ作成）。name はUNIQUEなのでOR IGNOREで重複防止。 */
async function ensureTag(db: D1Database, name: string): Promise<string> {
  await db.prepare(`INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, '#A8842F')`)
    .bind(crypto.randomUUID(), name).run();
  const row = await db.prepare(`SELECT id FROM tags WHERE name = ?`).bind(name).first<{ id: string }>();
  return row!.id;
}

crmSync.post('/api/crm-sync', requireRole('owner', 'admin'), async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { keyField?: KeyField; rows?: Row[]; source?: string; tagFrom?: string; tagPrefix?: string };
  const keyField = (b.keyField ?? 'sf_id') as KeyField;
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [];
  if (!rows.length) return c.json({ error: 'rows required' }, 400);
  const tagFrom = (b.tagFrom ?? '').toString().trim(); // タグ化する列名（例: course / product）
  const tagPrefix = (b.tagPrefix ?? '購入:').toString();

  const findStmt = c.env.DB.prepare(matchSql(keyField));
  let matched = 0;
  let tagged = 0;
  const tagCache = new Map<string, string>();
  for (const r of rows) {
    if (!r.key || !r.attrs || typeof r.attrs !== 'object') continue;
    const hit = await findStmt.bind(String(r.key)).first<{ id: string }>();
    if (!hit) continue;
    // 既存metadataを保持しつつ属性をマージ
    await c.env.DB.prepare(`UPDATE friends SET metadata = json_patch(COALESCE(metadata,'{}'), ?), updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(r.attrs), jstNow(), hit.id)
      .run();
    matched++;
    // 購入商品でタグ分け: 指定列の値からタグを作成・付与
    if (tagFrom && r.attrs[tagFrom] != null && String(r.attrs[tagFrom]).trim()) {
      const tagName = `${tagPrefix}${String(r.attrs[tagFrom]).trim()}`;
      let tagId = tagCache.get(tagName);
      if (!tagId) { tagId = await ensureTag(c.env.DB, tagName); tagCache.set(tagName, tagId); }
      await c.env.DB.prepare(`INSERT OR IGNORE INTO friend_tags (friend_id, tag_id) VALUES (?, ?)`).bind(hit.id, tagId).run();
      tagged++;
    }
  }
  const staff = c.get('staff') as { name?: string } | undefined;
  await c.env.DB.prepare(
    `INSERT INTO crm_sync_log (id, source, key_field, matched, unmatched, run_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), b.source ?? 'csv', keyField, matched, rows.length - matched, staff?.name ?? 'Owner', jstNow())
    .run();
  return c.json({ matched, unmatched: rows.length - matched, tagged, tagsCreated: tagCache.size });
});

crmSync.get('/api/crm-sync/status', requireRole('owner', 'admin'), async (c) => {
  const cov = await c.env.DB
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN json_extract(metadata,'$.tantou') IS NOT NULL THEN 1 ELSE 0 END) AS hasTantou,
         SUM(CASE WHEN json_extract(metadata,'$.course') IS NOT NULL THEN 1 ELSE 0 END) AS hasCourse,
         SUM(CASE WHEN json_extract(metadata,'$.ltv')    IS NOT NULL THEN 1 ELSE 0 END) AS hasLtv
       FROM friends WHERE is_following = 1`,
    )
    .first();
  const last = await c.env.DB.prepare(`SELECT * FROM crm_sync_log ORDER BY created_at DESC LIMIT 5`).all();
  return c.json({ coverage: cov, recent: last.results ?? [], salesforceLive: false });
});
