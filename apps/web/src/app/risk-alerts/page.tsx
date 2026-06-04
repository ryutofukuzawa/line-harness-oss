'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const token = () => (typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : '')

type RiskKind = 'none' | 'churn' | 'complaint' | 'neglect'
interface Alert {
  id: string
  text: string
  risk: RiskKind
  severity: number
  reason: string
  live: number
  status: string
  created_at: string
  friend_name: string | null
  account_name: string | null
}

const META: Record<RiskKind, { label: string; cls: string }> = {
  churn: { label: '離脱予兆', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  complaint: { label: 'クレーム', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
  neglect: { label: '放置', cls: 'bg-violet-100 text-violet-800 border-violet-200' },
  none: { label: '問題なし', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
}

async function call(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...options?.headers },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export default function RiskAlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await call(`/api/risk-alerts?status=${filter}`)
      setAlerts(r.data || [])
      setOpenCount(r.openCount || 0)
    } catch {
      setAlerts([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  const resolve = async (id: string) => {
    await call(`/api/risk-alerts/${id}/resolve`, { method: 'POST' })
    load()
  }

  const classify = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    setResult(null)
    try {
      const v = await call('/api/risk-classify', { method: 'POST', body: JSON.stringify({ text }) })
      const m = META[v.risk as RiskKind]
      setResult(
        `判定: ${m.label}（深刻度 ${v.severity}/5・${v.live ? 'Claude判定' : 'ローカル判定'}）／根拠: ${v.reason}` +
          (v.alertId ? '　→ アラートを作成しました' : '　→ アラートなし'),
      )
      setText('')
      load()
    } catch {
      setResult('判定に失敗しました')
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <Header
        title="AIリスク検知"
        description="個別やりとりのメッセージをAIが分類し、離脱・クレーム・放置の兆候を管理者にアラートします（プロラボ独自機能）"
      />
      <div className="p-6 space-y-6">
        {/* シミュレーター */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">メッセージ判定シミュレーター</div>
          <p className="text-xs text-gray-500 mb-3">
            顧客メッセージを入力して判定。深刻度3以上ならアラートに記録されます（LINE接続後は受信メッセージを自動判定）。
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {['解約しようか迷ってます', '3日前に問い合わせたのに返信がありません', '施術の対応が雑でがっかりしました', '次回も楽しみにしています！'].map((ex) => (
              <button key={ex} onClick={() => setText(ex)} className="text-[11px] text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full px-2 py-1">
                {ex.length > 16 ? ex.slice(0, 16) + '…' : ex}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              onKeyDown={(e) => e.key === 'Enter' && classify()}
              placeholder="例：効果が出ないしもう解約しようか迷ってます…"
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500"
            />
            <button
              onClick={classify}
              disabled={!text.trim() || sending}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
              style={{ backgroundColor: '#A8842F' }}
            >
              {sending ? '判定中…' : '判定する'}
            </button>
          </div>
          {result && <div className="mt-2 text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">{result}</div>}
        </div>

        {/* 一覧 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-700">
              リスクアラート一覧 <span className="text-rose-600">（未対応 {openCount} 件）</span>
            </div>
            <div className="flex gap-1">
              {(['open', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-md ${filter === f ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                  {f === 'open' ? '未対応' : 'すべて'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-gray-400 py-8 text-center">読み込み中…</div>
          ) : alerts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">アラートはありません</div>
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => {
                const m = META[a.risk] || META.none
                return (
                  <div key={a.id} className={`bg-white border border-gray-200 rounded-xl p-4 ${a.status === 'resolved' ? 'opacity-60' : ''}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center text-[11px] font-semibold border rounded-full px-2 py-0.5 ${m.cls}`}>{m.label}</span>
                        <span className="text-[11px] text-gray-500">深刻度 {a.severity}/5</span>
                        <span className="text-[10px] border border-gray-200 rounded-full px-1.5 py-0.5 text-gray-500">{a.live ? 'Claude判定' : 'ローカル判定'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400">{a.created_at?.slice(0, 16).replace('T', ' ')}</span>
                        {a.status === 'open' ? (
                          <button onClick={() => resolve(a.id)} className="text-[11px] text-blue-700 hover:underline">対応済みにする</button>
                        ) : (
                          <span className="text-[11px] text-blue-600">対応済</span>
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-gray-800 mt-1.5">「{a.text}」</div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      {(a.account_name || '—')} ・ {(a.friend_name || '匿名')} ・ {a.reason}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
