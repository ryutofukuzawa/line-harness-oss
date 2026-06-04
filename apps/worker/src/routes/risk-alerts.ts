/**
 * プロラボ独自機能: AIリスクアラート（個別やりとり → 管理者アラート）
 * GET  /api/risk-alerts?status=open|resolved|all
 * POST /api/risk-alerts/:id/resolve
 * POST /api/risk-classify   { text, friendId?, lineAccountId?, threshold? }
 */
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { classifyRisk, notifySlack, RISK_LABEL } from '../services/risk-classify.js';

export const riskAlerts = new Hono<Env>();

function jstNow(): string {
  return new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, -1) + '+09:00';
}

riskAlerts.get('/api/risk-alerts', async (c) => {
  const status = new URL(c.req.url).searchParams.get('status') ?? 'open';
  const where = status === 'all' ? '' : 'WHERE r.status = ?';
  const base = `
    SELECT r.id, r.friend_id, r.line_account_id, r.text, r.risk, r.severity,
           r.reason, r.live, r.status, r.created_at,
           f.display_name AS friend_name, la.name AS account_name
    FROM risk_alerts r
    LEFT JOIN friends f ON f.id = r.friend_id
    LEFT JOIN line_accounts la ON la.id = r.line_account_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 200`;
  const stmt = c.env.DB.prepare(base);
  const res = await (where ? stmt.bind(status) : stmt).all();
  // open件数も返す
  const openCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM risk_alerts WHERE status='open'`,
  ).first<{ n: number }>();
  return c.json({ data: res.results, openCount: openCount?.n ?? 0 });
});

riskAlerts.post('/api/risk-alerts/:id/resolve', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE risk_alerts SET status='resolved' WHERE id=?`).bind(id).run();
  return c.json({ ok: true });
});

riskAlerts.post('/api/risk-classify', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    text?: string;
    friendId?: string;
    lineAccountId?: string;
    threshold?: number;
  };
  const text = (body.text ?? '').toString();
  if (!text.trim()) return c.json({ error: 'text required' }, 400);
  if (text.length > 500) return c.json({ error: 'too long' }, 400);

  const v = await classifyRisk(text, c.env);
  const threshold = body.threshold ?? 3;
  let alertId: string | null = null;

  if (v.risk !== 'none' && v.severity >= threshold) {
    alertId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO risk_alerts (id, friend_id, line_account_id, message_id, text, risk, severity, reason, live, status, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'open', ?)`,
    )
      .bind(
        alertId,
        body.friendId ?? null,
        body.lineAccountId ?? null,
        text,
        v.risk,
        v.severity,
        v.reason,
        v.live ? 1 : 0,
        jstNow(),
      )
      .run();
    await notifySlack(
      c.env,
      `🚨 AIリスク検知: ${RISK_LABEL[v.risk]}（深刻度${v.severity}）\n「${text}」\n根拠: ${v.reason}`,
    );
  }

  return c.json({ ...v, alertId });
});
