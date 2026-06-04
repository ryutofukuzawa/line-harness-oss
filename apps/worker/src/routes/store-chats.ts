/**
 * プロラボ独自機能: 店舗スコープの担当チャットビュー
 * 店舗スタッフ(role=staff)は割当てられた店舗(OA)のチャットのみ閲覧。本部(owner/admin)は全店。
 *
 * GET  /api/store-chats/accounts            -> 閲覧可能な店舗一覧（ロール/割当でスコープ）
 * GET  /api/store-chats?lineAccountId=      -> その店舗の会話一覧（スコープ強制）
 * GET  /api/store-assignments               -> スタッフ×店舗の割当一覧（本部のみ）
 * POST /api/store-assignments  { staffId, lineAccountId }   （本部のみ）
 * DELETE /api/store-assignments { staffId, lineAccountId }  （本部のみ）
 */
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { resolveOrg } from '../lib/org.js';

export const storeChats = new Hono<Env>();

type Staff = { id: string; name: string; role: 'owner' | 'admin' | 'staff' };

// 4階層ロールで閲覧可能な店舗を解決（経営層=全店, エリアMgr=担当エリア, 店長/現場=自店）
async function accessibleAccounts(db: D1Database, staff: Staff) {
  const org = await resolveOrg(db, staff);
  if (org.storeIds.length === 0) return { accounts: [], scoped: !org.allStores };
  const ph = org.storeIds.map(() => '?').join(',');
  const r = await db
    .prepare(`SELECT id, name FROM line_accounts WHERE is_active = 1 AND id IN (${ph}) ORDER BY display_order, name`)
    .bind(...org.storeIds)
    .all<{ id: string; name: string }>();
  return { accounts: r.results ?? [], scoped: !org.allStores };
}

storeChats.get('/api/store-chats/accounts', async (c) => {
  const staff = c.get('staff') as Staff;
  const { accounts, scoped } = await accessibleAccounts(c.env.DB, staff);
  return c.json({ accounts, scoped, role: staff?.role ?? 'owner' });
});

storeChats.get('/api/store-chats', async (c) => {
  const staff = c.get('staff') as Staff;
  const accountId = new URL(c.req.url).searchParams.get('lineAccountId');
  if (!accountId) return c.json({ error: 'lineAccountId required' }, 400);

  // スコープ強制: アクセス可能な店舗以外は 403
  const { accounts } = await accessibleAccounts(c.env.DB, staff);
  if (!accounts.some((a) => a.id === accountId)) {
    return c.json({ error: 'この店舗へのアクセス権がありません' }, 403);
  }

  const res = await c.env.DB.prepare(
    `WITH conv AS (
       SELECT friend_id, MAX(created_at) AS last_at
       FROM messages_log
       WHERE line_account_id = ?
       GROUP BY friend_id
     )
     SELECT f.id AS friend_id, f.display_name,
            conv.last_at,
            (SELECT content FROM messages_log m
               WHERE m.friend_id = f.id AND m.line_account_id = ?
               ORDER BY created_at DESC LIMIT 1) AS last_text,
            (SELECT direction FROM messages_log m
               WHERE m.friend_id = f.id AND m.line_account_id = ?
               ORDER BY created_at DESC LIMIT 1) AS last_dir,
            (SELECT COUNT(*) FROM risk_alerts r
               WHERE r.friend_id = f.id AND r.status = 'open') AS open_risks
     FROM conv JOIN friends f ON f.id = conv.friend_id
     ORDER BY conv.last_at DESC
     LIMIT 100`,
  )
    .bind(accountId, accountId, accountId)
    .all();
  return c.json({ data: res.results ?? [] });
});

storeChats.get('/api/store-assignments', requireRole('owner', 'admin'), async (c) => {
  const staffRes = await c.env.DB.prepare(
    `SELECT id, name, role FROM staff_members WHERE is_active = 1 ORDER BY role, name`,
  ).all<{ id: string; name: string; role: string }>();
  const asgRes = await c.env.DB.prepare(
    `SELECT a.staff_id, a.line_account_id, la.name AS account_name
     FROM staff_store_assignments a
     LEFT JOIN line_accounts la ON la.id = a.line_account_id`,
  ).all<{ staff_id: string; line_account_id: string; account_name: string }>();
  const accounts = await c.env.DB.prepare(
    `SELECT id, name FROM line_accounts WHERE is_active = 1 ORDER BY display_order, name`,
  ).all<{ id: string; name: string }>();
  return c.json({
    staff: staffRes.results ?? [],
    assignments: asgRes.results ?? [],
    accounts: accounts.results ?? [],
  });
});

storeChats.post('/api/store-assignments', requireRole('owner', 'admin'), async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { staffId?: string; lineAccountId?: string };
  if (!b.staffId || !b.lineAccountId) return c.json({ error: 'staffId and lineAccountId required' }, 400);
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO staff_store_assignments (staff_id, line_account_id) VALUES (?, ?)`,
  )
    .bind(b.staffId, b.lineAccountId)
    .run();
  return c.json({ ok: true });
});

storeChats.delete('/api/store-assignments', requireRole('owner', 'admin'), async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { staffId?: string; lineAccountId?: string };
  if (!b.staffId || !b.lineAccountId) return c.json({ error: 'staffId and lineAccountId required' }, 400);
  await c.env.DB.prepare(
    `DELETE FROM staff_store_assignments WHERE staff_id = ? AND line_account_id = ?`,
  )
    .bind(b.staffId, b.lineAccountId)
    .run();
  return c.json({ ok: true });
});
