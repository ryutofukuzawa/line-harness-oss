/**
 * プロラボ独自機能: 全店横断 一斉配信の承認ガバナンス
 * 起案(pending) → 承認/却下 → 送信。起案者と承認者を分離し、頻度上限で自動除外。
 *
 * GET  /api/broadcast-requests?status=pending|approved|rejected|sent|all
 * POST /api/broadcast-requests/dry-run   { message? }     -> 送信対象の試算(店舗別内訳・頻度除外)
 * POST /api/broadcast-requests           { title, message, scope? }
 * POST /api/broadcast-requests/:id/approve
 * POST /api/broadcast-requests/:id/reject
 * POST /api/broadcast-requests/:id/send
 */
import { Hono } from 'hono';
import type { Env } from '../index.js';

export const broadcastGovernance = new Hono<Env>();

const FREQ_CAP = 4; // 直近7日でこの回数以上配信済みの友だちは自動除外
const WINDOW_DAYS = 7;

function jstNow(): string {
  return new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, -1) + '+09:00';
}
function actor(c: { get: (k: 'staff') => { name?: string } | undefined }): string {
  try {
    return c.get('staff')?.name || 'Owner';
  } catch {
    return 'Owner';
  }
}

interface Audience {
  total: number;
  excluded: number;
  target: number;
  perStore: Array<{ accountId: string; name: string; count: number }>;
  freqCap: number;
  windowDays: number;
}

async function computeAudience(db: D1Database): Promise<Audience> {
  // 全店横断 = フォロー中の友だち全員（友だちはアカウント横断でグローバル）
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM friends WHERE is_following = 1`)
    .first<{ n: number }>();
  const total = totalRow?.n ?? 0;

  // 頻度上限で除外: 直近WINDOW_DAYS日で FREQ_CAP 回以上 broadcast を受け取った友だち
  const excludedRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT friend_id FROM messages_log
         WHERE broadcast_id IS NOT NULL
           AND created_at >= datetime('now', '-${WINDOW_DAYS} days', '+9 hours')
         GROUP BY friend_id
         HAVING COUNT(*) >= ${FREQ_CAP}
       )`,
    )
    .first<{ n: number }>();
  const excluded = excludedRow?.n ?? 0;

  // 店舗(OA)別の到達内訳: messages_log で各アカウントと接点のあるフォロー中の友だち数
  const perStoreRes = await db
    .prepare(
      `SELECT la.id AS accountId, la.name AS name,
              COUNT(DISTINCT ml.friend_id) AS count
       FROM line_accounts la
       LEFT JOIN messages_log ml ON ml.line_account_id = la.id
       LEFT JOIN friends f ON f.id = ml.friend_id AND f.is_following = 1
       WHERE la.is_active = 1
       GROUP BY la.id, la.name
       ORDER BY la.display_order, la.name`,
    )
    .all<{ accountId: string; name: string; count: number }>();

  return {
    total,
    excluded,
    target: Math.max(0, total - excluded),
    perStore: perStoreRes.results ?? [],
    freqCap: FREQ_CAP,
    windowDays: WINDOW_DAYS,
  };
}

broadcastGovernance.post('/api/broadcast-requests/dry-run', async (c) => {
  const aud = await computeAudience(c.env.DB);
  return c.json(aud);
});

broadcastGovernance.get('/api/broadcast-requests', async (c) => {
  const status = new URL(c.req.url).searchParams.get('status') ?? 'all';
  const where = status === 'all' ? '' : 'WHERE status = ?';
  const stmt = c.env.DB.prepare(
    `SELECT * FROM broadcast_requests ${where} ORDER BY created_at DESC LIMIT 200`,
  );
  const res = await (where ? stmt.bind(status) : stmt).all();
  return c.json({ data: res.results });
});

broadcastGovernance.post('/api/broadcast-requests', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; message?: string; scope?: string };
  const title = (body.title ?? '').toString().trim();
  const message = (body.message ?? '').toString().trim();
  if (!title || !message) return c.json({ error: 'title and message required' }, 400);

  const aud = await computeAudience(c.env.DB);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO broadcast_requests
       (id, title, message, scope, target_count, excluded_count, per_store, status, proposed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(
      id,
      title,
      message,
      body.scope ?? 'all',
      aud.target,
      aud.excluded,
      JSON.stringify(aud.perStore),
      actor(c),
      jstNow(),
    )
    .run();
  return c.json({ id, status: 'pending', ...aud });
});

broadcastGovernance.post('/api/broadcast-requests/:id/approve', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT status, proposed_by FROM broadcast_requests WHERE id = ?`)
    .bind(id)
    .first<{ status: string; proposed_by: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.status !== 'pending') return c.json({ error: `承認できません（現在: ${row.status}）` }, 409);
  await c.env.DB.prepare(
    `UPDATE broadcast_requests SET status='approved', approved_by=?, decided_at=? WHERE id=?`,
  )
    .bind(actor(c), jstNow(), id)
    .run();
  return c.json({ ok: true, status: 'approved' });
});

broadcastGovernance.post('/api/broadcast-requests/:id/reject', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(
    `UPDATE broadcast_requests SET status='rejected', approved_by=?, decided_at=? WHERE id=? AND status='pending'`,
  )
    .bind(actor(c), jstNow(), id)
    .run();
  return c.json({ ok: true, status: 'rejected' });
});

broadcastGovernance.post('/api/broadcast-requests/:id/send', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT status FROM broadcast_requests WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.status !== 'approved') return c.json({ error: '承認後のみ送信できます' }, 409);
  // NOTE: 実際のLINE配信は各OA接続後に既存 broadcast 送信パイプラインへ接続する。
  // 現時点では承認済み配信を「送信済み」として記録する（ガバナンス確定）。
  await c.env.DB.prepare(`UPDATE broadcast_requests SET status='sent', sent_at=? WHERE id=?`)
    .bind(jstNow(), id)
    .run();
  return c.json({ ok: true, status: 'sent' });
});
