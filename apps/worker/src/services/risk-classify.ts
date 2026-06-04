/**
 * プロラボ独自機能: 個別やりとりのAIリスク検知
 * 受信メッセージを「離脱(churn) / クレーム(complaint) / 放置(neglect) / none」に分類する。
 * ANTHROPIC_API_KEY が設定されていれば Claude で判定、無ければルールベース(heuristic)にフォールバック。
 */

export type RiskKind = 'none' | 'churn' | 'complaint' | 'neglect';
export interface RiskVerdict {
  risk: RiskKind;
  severity: number; // 1-5
  reason: string;
  live: boolean; // true = Claude判定 / false = ローカル判定
}

export const RISK_LABEL: Record<RiskKind, string> = {
  none: '問題なし',
  churn: '離脱予兆',
  complaint: 'クレーム',
  neglect: '放置',
};

/** 外部APIを使わないルールベース判定（フォールバック） */
export function heuristic(text: string): Omit<RiskVerdict, 'live'> {
  const complaint = /(最悪|ひどい|遅い|態度|不満|雑|痛かった|効果ない|がっかり|クレーム|怒|二度と|失礼|多すぎ|うんざり)/;
  const neglect = /(返事|返信(ない|来ない|こない)|連絡(こない|ない)|無視|放置|いつになったら|まだですか|何度も|待って)/;
  const churn = /(解約|やめ|辞め|退会|もう行かない|通うのをやめ|キャンセルしたい|返金|高い|続け(る|られ)|効果(が|を)?(ない|感じ)|迷って|もう無理)/;
  if (complaint.test(text)) return { risk: 'complaint', severity: 4, reason: '不満・クレームの語を検知' };
  if (neglect.test(text)) return { risk: 'neglect', severity: 3, reason: '未応答・放置の示唆を検知' };
  if (churn.test(text)) return { risk: 'churn', severity: 4, reason: '解約・離脱の示唆を検知' };
  return { risk: 'none', severity: 1, reason: 'リスク語なし' };
}

export async function classifyRisk(
  text: string,
  env: { ANTHROPIC_API_KEY?: string },
): Promise<RiskVerdict> {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return { ...heuristic(text), live: false };

  const prompt = `あなたはエステサロンの顧客対応リスク判定器です。顧客からのLINEメッセージ1件を分類し、JSONのみを返してください。前置き・markdown・コードフェンスは禁止。
スキーマ: {"risk":"none|churn|complaint|neglect","severity":整数1-5,"reason":"短い日本語の根拠"}
定義: churn=解約/終了/離脱の示唆 / complaint=不満・クレーム / neglect=放置されている問い合わせの兆候 / none=軽い雑談やポジティブ。過剰検知は避けること。
判定対象:
"""${text}"""`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw new Error('anthropic ' + r.status);
    const data = (await r.json()) as { content?: Array<{ type: string; text: string }> };
    const rawText = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const p = JSON.parse(rawText.replace(/```json|```/g, '').trim()) as Partial<RiskVerdict>;
    const risk = (['none', 'churn', 'complaint', 'neglect'] as RiskKind[]).includes(p.risk as RiskKind)
      ? (p.risk as RiskKind)
      : 'none';
    return { risk, severity: Number(p.severity) || 1, reason: p.reason || '', live: true };
  } catch {
    return { ...heuristic(text), live: false };
  }
}

/** Slack通知（SLACK_WEBHOOK_URL が設定されていれば送る・ベストエフォート） */
export async function notifySlack(
  env: { SLACK_WEBHOOK_URL?: string },
  text: string,
): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) return;
  try {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    /* best-effort */
  }
}
