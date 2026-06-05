# DESIGN.md — プロラボ LINE統合基盤

> AIコーディング/デザインエージェント向けのデザインシステム仕様。本ファイルを基準にUIを生成・改修すれば、プロラボ（Esthe Pro Labo）のブランドで一貫した見た目になる。
> 形式は getdesign.md / Google Stitch の DESIGN.md 仕様に準拠。

## Overview

エステプロ・ラボの高級感（ディープネイビーの朱子＋ゴールドの箔押し）を基調にした、多店舗LINE運用の管理ダッシュボード。データ密度は高いが、余白とカードで整理し、現場でも迷わないことを最優先する。落ち着いた紺をクローム（土台）に、ゴールドを主要アクション（CTA）とブランド要素にだけ使う「2色＋中間ブルー」構成。LINEグリーン(#06C755)は使わない。

- トーン: 信頼・上質・端正。装飾過多にしない。
- 原則: 紺＝土台/見出し/アクティブ、金＝CTA/ロゴ、青＝情報/リンク、グレー＝本文/枠。

## Colors

### Brand & Accent
- `--navy` `#1C2E6E` — ブランド主色。サイドバー基調・見出し・アクティブnav・ログイン背景・セカンダリボタン。
- `--navy-ink` `#16264F` — 濃紺。金地の上のテキスト等。
- `--gold` `#A8842F` — 主要CTAボタン（白文字）。送信/承認/取込など「実行」アクション。
- `--gold-bright` `#C2A24C` — ブランドアクセント（ロゴバッジ等）。紺文字を乗せる。
- `--blue-accent` `#1D4ED8`(blue-700) — リンク・情報・サブ操作（ドライラン等のアウトライン）。

### Surface
- ページ背景 `#F8FAFC`（slate-50）
- カード/パネル `#FFFFFF`、枠 `#E5E7EB`（gray-200）、内側区切り `#F3F4F6`（gray-100）
- ヘッダー/サイドバー `#FFFFFF`（境界線で区切る）

### Text
- 見出し `#111827`（gray-900）／本文 `#374151`（gray-700）／補足 `#6B7280`（gray-500）／微細 `#9CA3AF`（gray-400）
- 金地(#A8842F)の上は `#FFFFFF`、明るい金(#C2A24C)の上は `#16264F`。

### Semantic
- 情報/成功・確定 = ブルー系（`bg-blue-100`/`text-blue-800`）※緑は使わない
- 注意/除外 = アンバー（`text-amber-600`/`bg-amber-100`）
- リスク/危険 = ローズ（`text-rose-700`/`bg-rose-100`）
- リスク種別: 離脱=amber / クレーム=rose / 放置=violet

## Typography

### Font Family
- 日本語UI: `"Noto Sans JP","Hiragino Sans","Yu Gothic",system-ui,sans-serif`
- 等幅（APIキー/CSV等）: ui-monospace 系

### Hierarchy
- ページ見出し(H1): 24–28px / bold / navy
- セクション(H2): 18–22px / bold / 濃いめのブルー(#2E4480)
- 小見出し(H3): 16px / bold / gray-900
- 本文: 14px、補足: 11–12px、バッジ: 10–11px

### Principles
- 1画面の主役は1つ。数字（KPI・件数）は太く大きく、ラベルは小さくグレー。

## Layout
- 余白スケール: 4 / 8 / 12 / 16 / 24px（Tailwind 1/2/3/4/6）
- 左サイドバー固定 + 右メインの2カラム。メインは `max-w` で読みやすい幅に。
- カードは `p-4`、要素間 `space-y-5`、グリッドは `gap-3〜6`。
- 余白を惜しまず、密度の高い表でも行間・パディングで可読性を確保。

## Shapes & Elevation
- 角丸: 入力/ボタン `rounded-lg`(8px)、カード `rounded-xl`(12px)、バッジ `rounded-full`(pill)
- 影: 最小限。カードは枠線中心、必要時のみ `shadow-sm`。ログインカードのみ `shadow-xl`。

## Components

### サイドバー
- 白背景。ロゴバッジ = `#C2A24C`(金) に紺文字「プ」。アクティブ項目 = `#1C2E6E`(紺) 背景・白文字。
- レイヤー（経営層/エリア/店長/現場）で表示項目を出し分ける。

### ボタン
- 主要CTA（実行）: 背景 `#A8842F`(金)・白文字・`rounded-lg`・hoverで opacity 90%。
- セカンダリ: 背景 `#1C2E6E`(紺)・白文字、または `bg-gray-800`。
- アウトライン（試算/サブ）: `border border-blue-500 text-blue-700 hover:bg-blue-50`。
- 無効: `opacity-40`。

### カード/コンテナ
- `bg-white border border-gray-200 rounded-xl p-4`。KPIカードは数値を `text-2xl font-bold`、ラベル `text-xs text-gray-500`。

### 入力/フォーム
- `border border-gray-300 rounded-lg px-3 py-2`、フォーカス `focus:border-blue-500`。ラベルは `text-xs text-gray-500`。

### バッジ/タグ
- pill。`text-[11px] font-semibold border rounded-full px-2 py-0.5`。意味別に色（情報=blue / 注意=amber / 危険=rose / 中立=gray）。

### バナー/注記
- ロール権限や状態は薄色バナー（`bg-slate-50 border-slate-200` 等）。重要操作の前提（承認が必要 等）は補足テキストで明示。

## Do's and Don'ts

### Do
- 紺を土台、金はCTAとロゴだけに絞って“効かせる”。
- 数字・件数を主役にし、ラベルは控えめ。
- 重要アクション（配信・承認・取込）はゴールドCTAで明確に。
- 現場ロールには必要最小限だけ見せる。

### Don't
- LINEグリーン(#06C755)や原色の多用。金を広い面積に使わない（安っぽくなる）。
- 1画面に強い色を何種類も置かない。
- 緑＝成功の慣習に頼らない（本基盤は情報/成功もブルー）。

## Responsive
- ブレークポイント: モバイル（サイドバーはドロワー）/ デスクトップ（固定サイドバー）。
- タッチターゲット 最低 40px。表は横スクロール許容、主要列を優先表示。

## Iteration Guide
- 新規画面は「白カード＋紺見出し＋ゴールドCTA＋ブルーのサブ操作」を踏襲。
- 迷ったら本書のColors/Componentsのトークンをそのまま使う。

## Known Gaps
- ダッシュボードのクイックアクションカードは未だブランド統一の途中。
- 画像アップロード(R2)・LINE実接続後にメディア系コンポーネントを追加予定。
