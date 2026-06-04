'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const token = () => (typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : '')

interface PerStore { accountId: string; name: string; count: number }
interface Audience { total: number; excluded: number; target: number; perStore: PerStore[]; freqCap: number; windowDays: number }
interface Req {
  id: string; title: string; message: string; scope: string
  target_count: number; excluded_count: number; per_store: string | null
  status: 'pending' | 'approved' | 'rejected' | 'sent'
  proposed_by: string | null; approved_by: string | null
  created_at: string; sent_at: string | null
}

async function call(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...options?.headers },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

const STATUS: Record<Req['status'], { label: string; cls: string }> = {
  pending: { label: '承認待ち', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: '承認済', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  rejected: { label: '却下', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  sent: { label: '送信済', cls: 'bg-green-100 text-green-800 border-green-200' },
}

export default function BroadcastGovernancePage() {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [aud, setAud] = useState<Audience | null>(null)
  const [busy, setBusy] = useState(false)
  const [reqs, setReqs] = useState<Req[]>([])

  const load = useCallback(async () => {
    try {
      const r = await call('/api/broadcast-requests?status=all')
      setReqs(r.data || [])
    } catch {
      setReqs([])
    }
  }, [])
  useEffect(() => { load() }, [load])

  const dryRun = async () => {
    setBusy(true)
    try { setAud(await call('/api/broadcast-requests/dry-run', { method: 'POST', body: JSON.stringify({ message }) })) }
    finally { setBusy(false) }
  }
  const submit = async () => {
    if (!title.trim() || !message.trim() || !aud) return
    setBusy(true)
    try {
      await call('/api/broadcast-requests', { method: 'POST', body: JSON.stringify({ title, message, scope: 'all' }) })
      setTitle(''); setMessage(''); setAud(null); load()
    } finally { setBusy(false) }
  }
  const act = async (id: string, action: 'approve' | 'reject' | 'send') => {
    try { await call(`/api/broadcast-requests/${id}/${action}`, { method: 'POST' }); load() }
    catch (e) { alert('操作できませんでした: ' + (e as Error).message) }
  }

  return (
    <div>
      <Header
        title="全店一斉配信（承認）"
        description="管理者の1操作で全店舗(全OA)へ一斉配信。起案→承認→送信のガバナンスと頻度上限の自動除外（プロラボ独自機能）"
      />
      <div className="p-6 grid lg:grid-cols-2 gap-6">
        {/* 起案 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 h-fit">
          <div className="text-sm font-semibold text-gray-700 mb-3">① 配信を起案</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="配信タイトル（社内管理用）"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 mb-2 outline-none focus:border-green-500" />
          <textarea value={message} onChange={(e) => { setMessage(e.target.value); setAud(null) }} rows={4} placeholder="配信メッセージ本文"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 mb-2 outline-none focus:border-green-500" />
          <button onClick={dryRun} disabled={!message.trim() || busy}
            className="w-full py-2 rounded-lg border border-green-500 text-green-700 text-sm font-medium hover:bg-green-50 disabled:opacity-40">
            ② ドライラン（全店の送信対象を試算）
          </button>

          {aud && (
            <div className="mt-3 text-sm bg-gray-50 border border-gray-100 rounded-lg p-3 space-y-2">
              <div>送信対象 <span className="font-bold text-gray-900">{aud.target.toLocaleString()}</span> 件
                {aud.excluded > 0 && <span className="text-amber-600">（頻度上限で {aud.excluded} 件を自動除外 / 直近{aud.windowDays}日{aud.freqCap}回以上）</span>}
                <span className="text-gray-400">／全フォロワー {aud.total.toLocaleString()}</span>
              </div>
              {aud.perStore.length > 0 && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">店舗別内訳</div>
                  <div className="flex flex-wrap gap-1">
                    {aud.perStore.map((s) => (
                      <span key={s.accountId} className="text-[11px] bg-white border border-gray-200 rounded px-1.5 py-0.5">{s.name}: {s.count}</span>
                    ))}
                  </div>
                </div>
              )}
              {aud.perStore.length === 0 && <div className="text-xs text-gray-400">※ 接続済みOA・友だちが無いため内訳は空です（LINE接続後に表示）</div>}
            </div>
          )}

          <button onClick={submit} disabled={!title.trim() || !message.trim() || !aud || busy}
            className="mt-2 w-full py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40">
            ③ 承認に提出
          </button>
          <p className="text-[11px] text-gray-400 mt-2">※ 承認なし・ドライラン未実行では提出不可。承認者が承認するまで送信されません。</p>
        </div>

        {/* 承認キュー */}
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-3">配信キュー（承認ボード）</div>
          {reqs.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">配信はまだありません</div>
          ) : (
            <div className="space-y-2">
              {reqs.map((r) => {
                const st = STATUS[r.status]
                let stores: PerStore[] = []
                try { stores = r.per_store ? JSON.parse(r.per_store) : [] } catch { /* noop */ }
                return (
                  <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-gray-900">{r.title}</span>
                      <span className={`inline-flex items-center text-[11px] font-semibold border rounded-full px-2 py-0.5 ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="text-sm text-gray-700 mt-1">{r.message}</div>
                    <div className="text-[11px] text-gray-500 mt-1.5">
                      全店配信・対象 {r.target_count} 件{r.excluded_count > 0 && `（除外 ${r.excluded_count}）`}
                      {stores.length > 0 && `・${stores.length}店舗`}
                      ・起案: {r.proposed_by || '—'}{r.approved_by && `／承認: ${r.approved_by}`}
                    </div>
                    <div className="flex gap-2 mt-2">
                      {r.status === 'pending' && (
                        <>
                          <button onClick={() => act(r.id, 'approve')} className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white">承認</button>
                          <button onClick={() => act(r.id, 'reject')} className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-600">却下</button>
                        </>
                      )}
                      {r.status === 'approved' && (
                        <button onClick={() => act(r.id, 'send')} className="text-xs px-2.5 py-1 rounded-md text-white" style={{ backgroundColor: '#06C755' }}>全店へ送信</button>
                      )}
                      {r.status === 'sent' && <span className="text-xs text-gray-400">{r.sent_at?.slice(0, 16).replace('T', ' ')} 送信</span>}
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
