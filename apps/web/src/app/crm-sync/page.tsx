'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const token = () => (typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : '')

async function call(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...options?.headers },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

const SAMPLE_CSV = `sf_id,tantou,course,ltv
SF-1001,山田,痩身プレミアム,360000
SF-1002,山田,美容コース,520000
SF-2001,佐藤,痩身コース,310000`

// CSV -> rows[{key, attrs}]  (1列目=突合キー、以降=属性。ltvは数値化)
function parseCsv(text: string): { key: string; attrs: Record<string, unknown> }[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((ln) => {
    const cols = ln.split(',').map((c) => c.trim())
    const attrs: Record<string, unknown> = {}
    for (let i = 1; i < header.length; i++) {
      const k = header[i]; const v = cols[i]
      if (v === undefined || v === '') continue
      attrs[k] = /^\d+$/.test(v) ? Number(v) : v
    }
    return { key: cols[0], attrs }
  })
}

export default function CrmSyncPage() {
  const [keyField, setKeyField] = useState<'sf_id' | 'phone' | 'line_user_id'>('sf_id')
  const [csv, setCsv] = useState(SAMPLE_CSV)
  const [preview, setPreview] = useState<{ total: number; matched: number; unmatched: number; sample: { name: string; attrs: Record<string, unknown> }[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [status, setStatus] = useState<{ coverage: Record<string, number>; recent: { source: string; matched: number; unmatched: number; created_at: string }[] } | null>(null)

  const loadStatus = useCallback(async () => {
    try { setStatus(await call('/api/crm-sync/status')) } catch { /* noop */ }
  }, [])
  useEffect(() => { loadStatus() }, [loadStatus])

  const runPreview = async () => {
    const rows = parseCsv(csv)
    if (!rows.length) { setFlash('CSVを確認してください（ヘッダ行＋データ行）'); return }
    setBusy(true)
    try { setPreview(await call('/api/crm-sync/preview', { method: 'POST', body: JSON.stringify({ keyField, rows }) })) }
    finally { setBusy(false) }
  }
  const apply = async () => {
    const rows = parseCsv(csv)
    if (!rows.length) return
    setBusy(true)
    try {
      const r = await call('/api/crm-sync', { method: 'POST', body: JSON.stringify({ keyField, rows, source: 'csv' }) })
      setFlash(`取込完了：${r.matched}件を更新（未一致 ${r.unmatched}件）`)
      setPreview(null); loadStatus()
      setTimeout(() => setFlash(null), 5000)
    } finally { setBusy(false) }
  }

  const c = status?.coverage
  return (
    <div>
      <Header
        title="CRM / Salesforce 連携"
        description="SFからエクスポートした顧客属性(担当者・購入コース・LTV)を名寄せして取込み、セグメント配信で使えるようにします（プロラボ独自機能）"
      />
      <div className="p-6 space-y-5">
        <div className="rounded-lg border bg-blue-50 border-blue-200 text-blue-800 p-3 text-sm">
          ライブSF API直結は認証情報(SALESFORCE_*)接続後に対応。現在は<b>CSV/エクスポート取込</b>で実データを反映できます。
        </div>

        {/* カバレッジ */}
        {c && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[['友だち総数', c.total], ['担当者あり', c.hasTantou], ['購入コースあり', c.hasCourse], ['LTVあり', c.hasLtv]].map(([label, v]) => (
              <div key={label as string} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="text-xs text-gray-500">{label as string}</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{v as number}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-6">
          {/* インポート */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-700">① 顧客属性CSVを取込</div>
            <label className="text-xs text-gray-500 block">突合キー（1列目）
              <select value={keyField} onChange={(e) => { setKeyField(e.target.value as 'sf_id'); setPreview(null) }} className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-2 py-2">
                <option value="sf_id">Salesforce ID</option>
                <option value="phone">電話番号</option>
                <option value="line_user_id">LINEユーザーID</option>
              </select>
            </label>
            <textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null) }} rows={7} className="w-full text-xs font-mono border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500" />
            <p className="text-[11px] text-gray-400">1行目=ヘッダ（1列目に突合キー、以降に tantou / course / ltv 等）。数値はそのまま格納。</p>
            <div className="flex gap-2">
              <button onClick={runPreview} disabled={busy} className="flex-1 py-2 rounded-lg border border-blue-500 text-blue-700 text-sm font-medium hover:bg-blue-50 disabled:opacity-40">② 照合プレビュー</button>
              <button onClick={apply} disabled={busy || !preview} className="flex-1 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40" style={{ backgroundColor: '#A8842F' }}>③ 取込実行</button>
            </div>
            {flash && <div className="text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">{flash}</div>}
          </div>

          {/* プレビュー結果 + 履歴 */}
          <div className="space-y-4">
            {preview && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="text-sm font-semibold text-gray-700 mb-2">照合結果</div>
                <div className="text-sm">一致 <b className="text-blue-700">{preview.matched}</b> 件 / 未一致 <b className="text-amber-600">{preview.unmatched}</b> 件（全{preview.total}行）</div>
                {preview.sample.length > 0 && (
                  <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                    {preview.sample.map((s, i) => <div key={i}>・{s.name}：{Object.entries(s.attrs).map(([k, v]) => `${k}=${v}`).join(' / ')}</div>)}
                  </div>
                )}
              </div>
            )}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-sm font-semibold text-gray-700 mb-2">取込履歴</div>
              {status?.recent?.length ? (
                <div className="space-y-1">
                  {status.recent.map((r, i) => (
                    <div key={i} className="text-xs text-gray-600 flex justify-between border border-gray-100 rounded px-2 py-1.5">
                      <span>{r.source}・一致{r.matched}/未一致{r.unmatched}</span>
                      <span className="text-gray-400">{r.created_at?.slice(5, 16).replace('T', ' ')}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-gray-400">履歴はありません</div>}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-gray-400">※ 取込んだ担当者・購入コース・LTVは「セグメント配信」の絞り込み条件として即利用できます。</p>
      </div>
    </div>
  )
}
