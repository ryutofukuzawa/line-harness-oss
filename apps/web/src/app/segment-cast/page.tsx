'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const token = () => (typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : '')

interface Account { id: string; name: string }
interface Tag { id: string; name: string; color: string }
interface SampleRow { display_name: string | null; tantou: string | null; course: string | null; score: number }
interface Cast { id: string; message: string; target_count: number; sent_by: string | null; created_at: string }

async function call(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...options?.headers },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export default function SegmentCastPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [scoped, setScoped] = useState(false)
  const [active, setActive] = useState('')
  const [tags, setTags] = useState<Tag[]>([])

  const [tagIds, setTagIds] = useState<string[]>([])
  const [tantou, setTantou] = useState('')
  const [course, setCourse] = useState('')
  const [scoreMin, setScoreMin] = useState('')
  const [message, setMessage] = useState('')
  const [imageUrl, setImageUrl] = useState('')

  const [preview, setPreview] = useState<{ count: number; sample: SampleRow[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<Cast[]>([])
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    call('/api/store-chats/accounts').then((r) => {
      setAccounts(r.accounts || [])
      setScoped(r.scoped)
      if (r.accounts?.[0]) setActive(r.accounts[0].id)
    }).catch(() => {})
    call('/api/tags').then((r) => setTags(r.data || [])).catch(() => {})
  }, [])

  const loadHistory = useCallback(async (acc: string) => {
    if (!acc) return
    try { setHistory((await call(`/api/segment-casts?lineAccountId=${acc}`)).data || []) } catch { setHistory([]) }
  }, [])
  useEffect(() => { loadHistory(active); setPreview(null) }, [active, loadHistory])

  const filters = () => ({
    tagIds: tagIds.length ? tagIds : undefined,
    tantou: tantou || undefined,
    course: course || undefined,
    scoreMin: scoreMin ? Number(scoreMin) : undefined,
  })

  const runPreview = async () => {
    if (!active) return
    setBusy(true)
    try { setPreview(await call('/api/segment-cast/preview', { method: 'POST', body: JSON.stringify({ lineAccountId: active, filters: filters() }) })) }
    finally { setBusy(false) }
  }
  const send = async () => {
    if (!active || !message.trim() || !preview) return
    setBusy(true)
    try {
      const r = await call('/api/segment-cast', { method: 'POST', body: JSON.stringify({ lineAccountId: active, filters: filters(), message, imageUrl }) })
      setFlash(`セグメント配信を実行しました（対象 ${r.target} 件）`)
      setMessage(''); setImageUrl(''); setPreview(null); loadHistory(active)
      setTimeout(() => setFlash(null), 4000)
    } finally { setBusy(false) }
  }

  const toggleTag = (id: string) => setTagIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <div>
      <Header
        title="セグメント配信"
        description="1:1より広く一斉より狭い、属性で絞った配信。店舗カウンセラーが自店で実行できます（プロラボ独自機能）"
      />
      <div className="p-6 space-y-5">
        {scoped && <div className="rounded-lg border bg-blue-50 border-blue-200 text-blue-800 p-3 text-sm">担当店舗のみ配信できます。</div>}
        {/* 店舗 */}
        <div className="flex flex-wrap gap-1.5">
          {accounts.map((a) => (
            <button key={a.id} onClick={() => setActive(a.id)} className={`text-sm px-3 py-1.5 rounded-lg border ${active === a.id ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200'}`}>{a.name}</button>
          ))}
          {accounts.length === 0 && <span className="text-sm text-gray-400">配信できる店舗がありません</span>}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* 絞り込み */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-700">① 配信先を絞り込む</div>
            <div>
              <div className="text-xs text-gray-400 mb-1">タグ</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button key={t.id} onClick={() => toggleTag(t.id)} className={`text-xs rounded-full px-2.5 py-1 border ${tagIds.includes(t.id) ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 bg-white'}`} style={tagIds.includes(t.id) ? { backgroundColor: t.color } : {}}>{t.name}</button>
                ))}
                {tags.length === 0 && <span className="text-xs text-gray-400">タグなし</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">担当者(SF)
                <select value={tantou} onChange={(e) => setTantou(e.target.value)} className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-2 py-2">
                  <option value="">指定なし</option>{['山田','鈴木','佐藤','高橋'].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-500">購入コース(SF)
                <select value={course} onChange={(e) => setCourse(e.target.value)} className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-2 py-2">
                  <option value="">指定なし</option>{['痩身コース','美容コース'].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
            </div>
            <label className="text-xs text-gray-500 block">スコア下限（行動エンゲージメント）
              <input value={scoreMin} onChange={(e) => setScoreMin(e.target.value)} type="number" placeholder="例: 50" className="mt-1 w-32 text-sm border border-gray-300 rounded-lg px-2 py-2" />
            </label>
            <button onClick={runPreview} disabled={!active || busy} className="w-full py-2 rounded-lg border border-blue-500 text-blue-700 text-sm font-medium hover:bg-blue-50 disabled:opacity-40">② 対象を試算</button>
            {preview && (
              <div className="text-sm bg-gray-50 border border-gray-100 rounded-lg p-3">
                対象 <span className="font-bold text-gray-900">{preview.count}</span> 件
                {preview.sample.length > 0 && (
                  <div className="mt-1 text-xs text-gray-500">
                    例: {preview.sample.slice(0, 6).map((s) => `${s.display_name}(${s.course || '-'}/${s.tantou || '-'}/${s.score})`).join('、')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* メッセージ */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-700">③ メッセージを送信</div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="このセグメント向けのメッセージ本文（テキスト）" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500" />
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="画像URL（任意・テキストと一緒に配信）" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500" />
            {imageUrl.trim() && <img src={imageUrl} alt="プレビュー" className="max-h-32 rounded-lg border border-gray-200" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
            <button onClick={send} disabled={!message.trim() || !preview || busy} className="w-full py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40" style={{ backgroundColor: '#A8842F' }}>
              {preview ? `この${preview.count}件に配信` : '配信（先に試算）'}
            </button>
            {flash && <div className="text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">{flash}</div>}
            <p className="text-[11px] text-gray-400">※ 全店一斉(本部承認)とは別。自店セグメントへの中間配信です。</p>
          </div>
        </div>

        {/* 履歴 */}
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">配信履歴</div>
          {history.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm">履歴はありません</div>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-800 truncate">{h.message}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">対象 {h.target_count} 件・{h.sent_by || '—'}</div>
                  </div>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap ml-2">{h.created_at?.slice(5, 16).replace('T', ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
