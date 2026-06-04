'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const token = () => (typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : '')

interface Store { id: string; name: string; area_id?: string }
interface Area { id: string; name: string }
interface Me { layer: string; layerLabel: string; areaId: string | null; areaName: string | null; stores: Store[]; areas: Area[]; proposableScopes: string[]; canApprove: boolean }
interface Aud { total: number; excluded: number; target: number; perStore: { accountId: string; name: string; count: number }[]; freqCap: number; windowDays: number }
interface Req {
  id: string; title: string; message: string; scope: string; area_id: string | null; line_account_id: string | null
  target_count: number; excluded_count: number; per_store: string | null
  status: 'pending' | 'approved' | 'rejected' | 'sent'; proposed_by: string | null; proposed_layer: string | null; approved_by: string | null; created_at: string; sent_at: string | null
}

async function call(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...options?.headers } })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`)
  return res.json()
}

const STATUS: Record<Req['status'], { label: string; cls: string }> = {
  pending: { label: '承認待ち', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: '承認済', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  rejected: { label: '却下', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  sent: { label: '配信実行', cls: 'bg-green-100 text-green-800 border-green-200' },
}
const SCOPE_LABEL: Record<string, string> = { all: '全店', area: 'エリア', store: '店舗' }

export default function BroadcastGovernancePage() {
  const [me, setMe] = useState<Me | null>(null)
  const [scope, setScope] = useState('')
  const [areaId, setAreaId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [aud, setAud] = useState<Aud | null>(null)
  const [busy, setBusy] = useState(false)
  const [reqs, setReqs] = useState<Req[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const r = await call('/api/broadcast-requests?status=all'); setReqs(r.data || []) } catch { setReqs([]) }
  }, [])

  useEffect(() => {
    call('/api/org/me').then((m: Me) => {
      setMe(m)
      if (m.proposableScopes[0]) setScope(m.proposableScopes[0])
      if (m.areaId) setAreaId(m.areaId)
      if (m.stores[0]) setStoreId(m.stores[0].id)
    }).catch(() => {})
    load()
  }, [load])

  const reset = () => setAud(null)
  const params = () => ({ scope, areaId: scope === 'area' ? areaId : undefined, lineAccountId: scope === 'store' ? storeId : undefined })

  const dryRun = async () => {
    setBusy(true); setErr(null)
    try { setAud(await call('/api/broadcast-requests/dry-run', { method: 'POST', body: JSON.stringify(params()) })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const submit = async () => {
    if (!title.trim() || !message.trim() || !aud) return
    setBusy(true); setErr(null)
    try { await call('/api/broadcast-requests', { method: 'POST', body: JSON.stringify({ ...params(), title, message }) }); setTitle(''); setMessage(''); setAud(null); load() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const act = async (id: string, action: 'approve' | 'reject') => {
    try { await call(`/api/broadcast-requests/${id}/${action}`, { method: 'POST' }); load() }
    catch (e) { alert((e as Error).message) }
  }

  const canPropose = (me?.proposableScopes.length ?? 0) > 0

  return (
    <div>
      <Header
        title="配信申請・承認"
        description="店長=自店、エリアMgr=担当エリア、経営層=全店を起案。経営層が承認すると配信が実行されます（プロラボ独自・4階層）"
      />
      <div className="p-6 space-y-5">
        {me && (
          <div className="rounded-lg border bg-slate-50 border-slate-200 text-slate-700 p-3 text-sm flex items-center gap-2">
            <span className="font-semibold">あなたの権限：{me.layerLabel}</span>
            {me.areaName && <span>／担当エリア：{me.areaName}</span>}
            <span className="text-slate-400">／起案可能：{me.proposableScopes.map((s) => SCOPE_LABEL[s]).join('・') || 'なし（閲覧のみ）'}</span>
            {me.canApprove && <span className="ml-auto text-green-700 font-semibold">承認権限あり</span>}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-6">
          {/* 起案 */}
          {canPropose ? (
            <div className="bg-white border border-gray-200 rounded-xl p-4 h-fit space-y-3">
              <div className="text-sm font-semibold text-gray-700">① 配信を起案</div>
              <div className="flex gap-2 items-end flex-wrap">
                <label className="text-xs text-gray-500">配信範囲
                  <select value={scope} onChange={(e) => { setScope(e.target.value); reset() }} className="mt-1 block text-sm border border-gray-300 rounded-lg px-2 py-2">
                    {me?.proposableScopes.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                  </select>
                </label>
                {scope === 'area' && (
                  <label className="text-xs text-gray-500">エリア
                    <select value={areaId} onChange={(e) => { setAreaId(e.target.value); reset() }} className="mt-1 block text-sm border border-gray-300 rounded-lg px-2 py-2">
                      {me?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                )}
                {scope === 'store' && (
                  <label className="text-xs text-gray-500">店舗
                    <select value={storeId} onChange={(e) => { setStoreId(e.target.value); reset() }} className="mt-1 block text-sm border border-gray-300 rounded-lg px-2 py-2">
                      {me?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="配信タイトル（社内管理用）" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-green-500" />
              <textarea value={message} onChange={(e) => { setMessage(e.target.value); reset() }} rows={4} placeholder="配信メッセージ本文" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-green-500" />
              <button onClick={dryRun} disabled={busy} className="w-full py-2 rounded-lg border border-green-500 text-green-700 text-sm font-medium hover:bg-green-50 disabled:opacity-40">② ドライラン（対象を試算）</button>
              {err && <div className="text-xs text-rose-600">{err}</div>}
              {aud && (
                <div className="text-sm bg-gray-50 border border-gray-100 rounded-lg p-3 space-y-1">
                  <div>対象 <b className="text-gray-900">{aud.target}</b> 件{aud.excluded > 0 && <span className="text-amber-600">（頻度上限で {aud.excluded} 件除外）</span>}</div>
                  {aud.perStore.length > 0 && <div className="flex flex-wrap gap-1">{aud.perStore.map((s) => <span key={s.accountId} className="text-[11px] bg-white border border-gray-200 rounded px-1.5 py-0.5">{s.name}: {s.count}</span>)}</div>}
                </div>
              )}
              <button onClick={submit} disabled={!title.trim() || !message.trim() || !aud || busy} className="w-full py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40">③ 承認に提出</button>
              <p className="text-[11px] text-gray-400">※ 経営層が承認するまで配信されません。</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">あなたの権限では配信の起案はできません（閲覧のみ）。</div>
          )}

          {/* キュー */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-3">{me?.canApprove ? '承認ボード（経営層）' : '申請状況'}</div>
            {reqs.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">配信はまだありません</div>
            ) : (
              <div className="space-y-2">
                {reqs.map((r) => {
                  const st = STATUS[r.status]
                  return (
                    <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-gray-900">{r.title}</span>
                        <span className={`inline-flex items-center text-[11px] font-semibold border rounded-full px-2 py-0.5 ${st.cls}`}>{st.label}</span>
                      </div>
                      <div className="text-sm text-gray-700 mt-1">{r.message}</div>
                      <div className="text-[11px] text-gray-500 mt-1.5">
                        {SCOPE_LABEL[r.scope] || r.scope}配信・対象 {r.target_count} 件{r.excluded_count > 0 && `（除外 ${r.excluded_count}）`}
                        ・起案: {r.proposed_by || '—'}{r.proposed_layer ? `(${r.proposed_layer})` : ''}{r.approved_by && `／承認: ${r.approved_by}`}
                      </div>
                      {me?.canApprove && r.status === 'pending' && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => act(r.id, 'approve')} className="text-xs px-2.5 py-1 rounded-md text-white" style={{ backgroundColor: '#06C755' }}>承認して配信</button>
                          <button onClick={() => act(r.id, 'reject')} className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-600">却下</button>
                        </div>
                      )}
                      {r.status === 'sent' && <div className="text-[11px] text-gray-400 mt-1">{r.sent_at?.slice(0, 16).replace('T', ' ')} 配信実行</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
