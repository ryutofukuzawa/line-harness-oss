/**
 * プロラボ独自機能: 階層的 配信申請・承認ガバナンス（4階層）
 * 起案: 店長=自店 / エリアMgr=担当エリア / 経営層=全店・任意。
 * 承認: 経営層のみ。承認したら配信が実行される。頻度上限で自動除外。
 *
 * GET  /api/org/me
 * POST /api/broadcast-requests/dry-run { scope, areaId?, lineAccountId? }
 * POST /api/broadcast-requests         { title, message, scope, areaId?, lineAccountId? }
 * GET  /api/broadcast-requests?status=
 * POST /api/broadcast-requests/:id/approve   （経営層）
 * POST /api/broadcast-requests/:id/reject     （経営層）
 */
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { resolveOrg, proposableScopes, LAYER_LABEL, type Layer } from '../lib/org.js';

export const broadcastGovernance = new Hono<Env>();

const FREQ_CAP = 4;
const WINDOW_DAYS = 7;
const jstNow = () => new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, -1) + '+09:00';
const actor = (c: any) => { try { return c.get('staff')?.name || 'Owner'; } catch { return 'Owner'; } };

/** scope に応じた対象店舗idリストを、権限チェック込みで返す。許可外は null。 */
async function scopedStoreIds(
  db: D1Database, org: Awaited<ReturnType<typeof resolveOrg>>,
  scope: string, areaId?: string, lineAccountId?: string,
): Promise<string[] | null> {
  if (scope === 'all') {
    if (org.layer !== 'exec') return null;
    const r = await db.prepare(`SELECT id FROM line_accounts WHERE is_active=1`).all<{ id: string }>();
    return (r.results ?? []).map((x) => x.id);
  }
  if (scope === 'area') {
    if (!areaId) return null;
    if (org.layer !== 'exec' && org.areaId !== areaId) return null;
    const r = await db.prepare(`SELECT id FROM line_accounts WHERE is_active=1 AND area_id=?`).bind(areaId).all<{ id: string }>();
    return (r.results ?? []).map((x) => x.id);
  }
  if (scope === 'store') {
    if (!lineAccountId) return null;
    if (!org.allStores && !org.storeIds.includes(lineAccountId)) return null;
    return [lineAccountId];
  }
  return null;
}

// 同一人物の正規化キー: 電話 → SF ID → LINE画像トークン → 個別ID。
// 複数OAに登録された同一人物は同じキーになり、一斉配信で1通に重複排除される。
const PKEY = `COALESCE(
  NULLIF(json_extract(f.metadata,'$.phone'),''),
  NULLIF(json_extract(f.metadata,'$.sf_id'),''),
  CASE WHEN f.picture_url LIKE 'https://sprofile.line-scdn.net/%' THEN SUBSTR(f.picture_url,42,80)
       WHEN f.picture_url LIKE 'https://profile.line-scdn.net/%' THEN SUBSTR(f.picture_url,41,80) END,
  'solo:'||f.id)`;

async function audience(db: D1Database, storeIds: string[]) {
  if (storeIds.length === 0) return { gross: 0, unique: 0, savedDup: 0, total: 0, excluded: 0, target: 0, perStore: [] as any[] };
  const ph = storeIds.map(() => '?').join(',');
  // gross=のべ登録件数, unique=重複排除後の人数
  const row = await db.prepare(
    `SELECT COUNT(*) AS gross, COUNT(DISTINCT ${PKEY}) AS uniq
     FROM friends f WHERE f.is_following=1 AND f.line_account_id IN (${ph})`,
  ).bind(...storeIds).first<{ gross: number; uniq: number }>();
  // 頻度上限: 直近WINDOW日にFREQ_CAP回以上配信された「人」を除外
  const excludedRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT ${PKEY} AS pk FROM friends f
       JOIN messages_log m ON m.friend_id=f.id
       WHERE f.line_account_id IN (${ph}) AND m.broadcast_id IS NOT NULL
         AND m.created_at >= datetime('now','-${WINDOW_DAYS} days','+9 hours')
       GROUP BY pk HAVING COUNT(*) >= ${FREQ_CAP})`,
  ).bind(...storeIds).first<{ n: number }>();
  const per = await db.prepare(
    `SELECT la.id AS accountId, la.name, COUNT(f.id) AS count
     FROM line_accounts la LEFT JOIN friends f ON f.line_account_id=la.id AND f.is_following=1
     WHERE la.id IN (${ph}) GROUP BY la.id, la.name ORDER BY la.display_order, la.name`,
  ).bind(...storeIds).all();
  const gross = row?.gross ?? 0;
  const uniq = row?.uniq ?? 0;
  const excluded = excludedRow?.n ?? 0;
  const target = Math.max(0, uniq - excluded);
  return { gross, unique: uniq, savedDup: gross - uniq, total: gross, excluded, target, perStore: per.results ?? [] };
}

broadcastGovernance.get('/api/org/me', async (c) => {
  const staff = c.get('staff') as any;
  const org = await resolveOrg(c.env.DB, staff);
  const stores = org.storeIds.length
    ? (await c.env.DB.prepare(`SELECT id, name, area_id FROM line_accounts WHERE id IN (${org.storeIds.map(() => '?').join(',')})`).bind(...org.storeIds).all()).results
    : [];
  const areas = (await c.env.DB.prepare(`SELECT id, name FROM areas ORDER BY sort_order`).all()).results ?? [];
  let areaName: string | null = null;
  if (org.areaId) areaName = (areas.find((a: any) => a.id === org.areaId) as any)?.name ?? null;
  return c.json({
    layer: org.layer, layerLabel: LAYER_LABEL[org.layer],
    areaId: org.areaId, areaName,
    stores, areas: org.layer === 'exec' ? areas : areas.filter((a: any) => a.id === org.areaId),
    proposableScopes: proposableScopes(org.layer),
    canApprove: org.layer === 'exec',
  });
});

broadcastGovernance.post('/api/broadcast-requests/dry-run', async (c) => {
  const staff = c.get('staff') as any;
  const org = await resolveOrg(c.env.DB, staff);
  const b = (await c.req.json().catch(() => ({}))) as any;
  const ids = await scopedStoreIds(c.env.DB, org, b.scope, b.areaId, b.lineAccountId);
  if (ids === null) return c.json({ error: 'この配信範囲を起案する権限がありません' }, 403);
  return c.json({ ...(await audience(c.env.DB, ids)), freqCap: FREQ_CAP, windowDays: WINDOW_DAYS });
});

broadcastGovernance.post('/api/broadcast-requests', async (c) => {
  const staff = c.get('staff') as any;
  const org = await resolveOrg(c.env.DB, staff);
  const b = (await c.req.json().catch(() => ({}))) as any;
  const title = (b.title ?? '').toString().trim();
  const message = (b.message ?? '').toString().trim();
  if (!title || !message) return c.json({ error: 'title and message required' }, 400);
  const ids = await scopedStoreIds(c.env.DB, org, b.scope, b.areaId, b.lineAccountId);
  if (ids === null) return c.json({ error: 'この配信範囲を起案する権限がありません' }, 403);
  const aud = await audience(c.env.DB, ids);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO broadcast_requests
       (id,title,message,scope,area_id,line_account_id,target_count,excluded_count,per_store,status,proposed_by,proposed_layer,created_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?, ?, ?)`,
  ).bind(id, title, message, b.scope, b.areaId ?? null, b.lineAccountId ?? null, aud.target, aud.excluded, JSON.stringify(aud.perStore), actor(c), org.layer, jstNow()).run();
  return c.json({ id, status: 'pending', ...aud });
});

broadcastGovernance.get('/api/broadcast-requests', async (c) => {
  const staff = c.get('staff') as any;
  const org = await resolveOrg(c.env.DB, staff);
  const status = new URL(c.req.url).searchParams.get('status') ?? 'all';
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (status !== 'all') { conds.push('status = ?'); binds.push(status); }
  if (org.layer !== 'exec') {
    // 自分の起案 OR 自分の店舗/エリアに関係する申請のみ
    const ors: string[] = ['proposed_by = ?']; binds.push(actor(c));
    if (org.storeIds.length) { ors.push(`line_account_id IN (${org.storeIds.map(() => '?').join(',')})`); binds.push(...org.storeIds); }
    if (org.areaId) { ors.push('area_id = ?'); binds.push(org.areaId); }
    conds.push('(' + ors.join(' OR ') + ')');
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const res = await c.env.DB.prepare(`SELECT * FROM broadcast_requests ${where} ORDER BY created_at DESC LIMIT 200`).bind(...binds).all();
  return c.json({ data: res.results ?? [], canApprove: org.layer === 'exec' });
});

broadcastGovernance.post('/api/broadcast-requests/:id/approve', async (c) => {
  const org = await resolveOrg(c.env.DB, c.get('staff') as any);
  if (org.layer !== 'exec') return c.json({ error: '承認は経営層のみ可能です' }, 403);
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT status FROM broadcast_requests WHERE id=?`).bind(id).first<{ status: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.status !== 'pending') return c.json({ error: `承認できません（現在: ${row.status}）` }, 409);
  // 承認＝配信実行（実LINE配信は各OA接続後に既存送信系へ接続。現時点は実行確定を記録）
  await c.env.DB.prepare(`UPDATE broadcast_requests SET status='sent', approved_by=?, decided_at=?, sent_at=? WHERE id=?`)
    .bind(actor(c), jstNow(), jstNow(), id).run();
  return c.json({ ok: true, status: 'sent' });
});

broadcastGovernance.post('/api/broadcast-requests/:id/reject', async (c) => {
  const org = await resolveOrg(c.env.DB, c.get('staff') as any);
  if (org.layer !== 'exec') return c.json({ error: '却下は経営層のみ可能です' }, 403);
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE broadcast_requests SET status='rejected', approved_by=?, decided_at=? WHERE id=? AND status='pending'`)
    .bind(actor(c), jstNow(), id).run();
  return c.json({ ok: true, status: 'rejected' });
});
