'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const token = () => (typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : '')

interface Account { id: string; name: string }
interface Conv {
  friend_id: string; display_name: string | null; last_at: string
  last_text: string | null; last_dir: string | null; open_risks: number
}
interface StaffM { id: string; name: string; role: string }
interface Assignment { staff_id: string; line_account_id: string; account_name: string }

async function call(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...options?.headers },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export default function StoreChatsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [scoped, setScoped] = useState(false)
  const [role, setRole] = useState('owner')
  const [active, setActive] = useState<string>('')
  const [convs, setConvs] = useState<Conv[]>([])
  const [loading, setLoading] = useState(false)

  // assignment管理 (本部のみ)
  const [staff, setStaff] = useState<StaffM[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [asgStaff, setAsgStaff] = useState('')
  const [asgAcc, setAsgAcc] = useState('')

  useEffect(() => {
    call('/api/store-chats/accounts').then((r) => {
      setAccounts(r.accounts || [])
      setScoped(r.scoped)
      setRole(r.role)
      if (r.accounts?.[0]) setActive(r.accounts[0].id)
    }).catch(() => {})
  }, [])

  const loadConvs = useCallback(async (accId: string) => {
    if (!accId) return
    setLoading(true)
    try { setConvs((await call(`/api/store-chats?lineAccountId=${accId}`)).data || []) }
    catch { setConvs([]) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { loadConvs(active) }, [active, loadConvs])

  const isHQ = role === 'owner' || role === 'admin'
  const loadAssignments = useCallback(async () => {
    if (!isHQ) return
    try {
      const r = await call('/api/store-assignments')
      setStaff((r.staff || []).filter((s: StaffM) => s.role === 'staff'))
      setAssignments(r.assignments || [])
    } catch { /* noop */ }
  }, [isHQ])
  useEffect(() => { loadAssignments() }, [loadAssignments])

  const addAsg = async () => {
    if (!asgStaff || !asgAcc) return
    await call('/api/store-assignments', { method: 'POST', body: JSON.stringify({ staffId: asgStaff, lineAccountId: asgAcc }) })
    setAsgStaff(''); setAsgAcc(''); loadAssignments()
  }
  const delAsg = async (staffId: string, lineAccountId: string) => {
    await call('/api/store-assignments', { method: 'DELETE', body: JSON.stringify({ staffId, lineAccountId }) })
    loadAssignments()
  }

  return (
    <div>
      <Header
        title="店舗チャット"
        description="担当店舗(OA)のチャットだけを表示。本部は全店、店舗マネージャーは自店のみ（プロラボ独自機能）"
      />
      <div className="p-6 space-y-5">
        <div className={`rounded-lg border p-3 text-sm ${scoped ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
          {scoped
            ? `あなたは担当店舗のみ閲覧できます（${accounts.length}店舗）。他店のチャットは表示されません。`
            : `本部ビュー：全${accounts.length}店舗のチャットを閲覧できます。`}
        </div>

        {/* 店舗セレクタ */}
        <div className="flex flex-wrap gap-1.5">
          {accounts.length === 0 && <span className="text-sm text-gray-400">表示できる店舗(OA)がありません。LINE公式アカウントを接続してください。</span>}
          {accounts.map((a) => (
            <button key={a.id} onClick={() => setActive(a.id)}
              className={`text-sm px-3 py-1.5 rounded-lg border ${active === a.id ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
              {a.name}
            </button>
          ))}
        </div>

        {/* 会話一覧 */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">読み込み中…</div>
          ) : convs.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">この店舗の会話はありません</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {convs.map((c) => (
                <div key={c.friend_id} className="p-3 flex items-center justify-between hover:bg-gray-50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800">{c.display_name || '名前なし'}</span>
                      {c.open_risks > 0 && (
                        <span className="text-[10px] font-semibold text-rose-700 bg-rose-100 border border-rose-200 rounded-full px-1.5 py-0.5">⚠ リスク{c.open_risks}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate mt-0.5">{c.last_dir === 'outgoing' ? '↩ ' : ''}{c.last_text || ''}</div>
                  </div>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap ml-2">{c.last_at?.slice(5, 16).replace('T', ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 担当割当（本部のみ） */}
        {isHQ && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-700 mb-1">店舗担当の割当（本部のみ）</div>
            <p className="text-xs text-gray-500 mb-3">店舗マネージャー(role=staff)を店舗に割当てると、その人のログインでは自店のチャットだけが見えます。</p>
            <div className="flex flex-wrap gap-2 items-end mb-3">
              <select value={asgStaff} onChange={(e) => setAsgStaff(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-2">
                <option value="">スタッフを選択</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={asgAcc} onChange={(e) => setAsgAcc(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-2">
                <option value="">店舗を選択</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button onClick={addAsg} disabled={!asgStaff || !asgAcc} className="px-3 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40" style={{ backgroundColor: '#A8842F' }}>割当てる</button>
            </div>
            {staff.length === 0 && <div className="text-xs text-gray-400">role=staff のスタッフがいません（スタッフ管理で追加）。</div>}
            <div className="space-y-1">
              {assignments.map((a) => {
                const s = staff.find((x) => x.id === a.staff_id)
                return (
                  <div key={a.staff_id + a.line_account_id} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-1.5">
                    <span>{s?.name || a.staff_id} → <b>{a.account_name}</b></span>
                    <button onClick={() => delAsg(a.staff_id, a.line_account_id)} className="text-xs text-gray-400 hover:text-rose-500">解除</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
