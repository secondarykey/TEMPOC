# desktop/CLAUDE.md

TEMPOC のデスクトップ版（Wails v3）。Chrome 拡張（リポジトリルートの `src/`）と同じ「claude.ai の使用量 API を傍受して 5時間 / 7日ウィンドウの進捗を表示する」機能を、スタンドアロンのデスクトップアプリとして提供する。

- Wails: `github.com/wailsapp/wails/v3` alpha2.114
- Go module 名: `changeme`（テンプレート既定のまま。変更していない）
- フロント: React + Vite + TypeScript、`@wailsio/runtime`
- 対象プラットフォーム: Windows（WebView2 前提）
- Wails 全般の作法は `.claude/skills/wails3` を参照

## 全体像

claude.ai には「いつ枠がリセットされるか（何日の何時か）」が表示されない。これを取得・表示するのが本アプリの主目的。

Chrome 拡張は claude.ai のページ内に content script を注入して `window.fetch` を傍受していた。デスクトップ版は **Wails の WebView 内に claude.ai を読み込み**、同じ fetch 傍受を行って結果を Go 経由で自前 UI に流す。

### 2 ウィンドウ構成

```
┌─ メインウィンドウ (Frameless, URL "/") ─────────────┐
│  React 製の自前 UI。傍受した使用量をプログレスバー表示 │
│  タイトルバー・ウィンドウ操作も React で描画          │
└────────────────────────────────────────────────────┘
        ▲ app.Event.Emit("tempoc:usage")
        │ (RawMessageHandler が中継)
┌─ Claude 傍受ウィンドウ (既定 Hidden) ───────────────┐
│  claude.ai/new#settings/usage を読み込む            │
│  inject.js が fetch を傍受 → chrome.webview.postMessage │
│  ログイン時・デバッグ時のみ表示                       │
└────────────────────────────────────────────────────┘
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `main.go` | エントリポイント。2 ウィンドウ生成、`RawMessageHandler`、イベント登録、傍受ウィンドウ表示制御 |
| `inject.js` | claude.ai に注入される素の JS。`window.fetch` を monkeypatch し使用量を postMessage |
| `settings/settings.go` | 設定モデル（`Settings` 構造体 + `Default()`）。Wails 非依存 |
| `settings/repository.go` | 設定の永続化（`os.UserConfigDir()/TEMPOC/settings.json`） |
| `settings_service.go` | `SettingsService`（`Get()` / `Set()`）。フロントにバインド |
| `frontend/src/App.tsx` | UI 全体（タイトルバー・使用量バー・設定画面） |
| `frontend/src/main.tsx` | React エントリ。`import '@wailsio/runtime'`（Frameless のドラッグに必須） |
| `frontend/public/style.css` | スタイル |
| `frontend/bindings/changeme/` | `wails3 generate bindings` の生成物（コミット対象） |

## 使用量の傍受の仕組み（重要な設計判断）

### document-created スクリプト注入

claude.ai のような**第三者ページに JS を注入する**には、Wails の `WebviewWindow.ExecJS()` は使えない。`ExecJS` は `runtimeLoaded == true` の間しか実行されず、このフラグは `@wailsio/runtime` が送る `wails:runtime:ready` ハンドシェイクでのみ true になる。claude.ai はこれを送らないため、`ExecJS` は永久にキューに溜まり実行されない。

代わりに WebView2 の `AddScriptToExecuteOnDocumentCreated`（document-start で全ページに注入、クロスオリジン・リロードを横断して永続）を使う。Wails はこれを `chromium.Init(script)` として **HTML モードで生成したウィンドウのときだけ** 呼ぶ。そこで傍受ウィンドウは:

1. 極小の HTML（`claudeBootstrapHTML`）+ `JS: injectJS` で生成 → `injectJS` が document-created スクリプトとして登録される
2. その HTML が `location.replace("https://claude.ai/new#settings/usage")` で claude.ai へ遷移
3. 登録済みスクリプトが claude.ai の document-start（Claude 自身の JS より前）で走り、`window.fetch` を確実にパッチ

### ページ → Go の通信

`inject.js` から `window.chrome.webview.postMessage(JSON.stringify(...))`（`window.chrome.webview` は WebView2 が全ページに提供）。Go 側は `application.Options.RawMessageHandler(window, message, originInfo)` で受信（`wails:` で始まらない全メッセージが届く）。`originInfo.Origin` に `claude.ai` が含まれるか検証してから処理する。

postMessage の `type` で分岐:
- `usage` — `seven_day`/`five_hour`/`weekly_scoped` を `app.Event.Emit("tempoc:usage", ...)` でフロントへ。以後 `Events.On("tempoc:usage")` で受信
- `auth-required` — `/login` へリダイレクトされた（未認証）→ 傍受ウィンドウを表示
- `debug` — ログ出力用

### 対象 API

`/api/organizations/{id}/usage`（正規表現 `^/api/organizations/[^/]+/usage$`）。各ウィンドウは `utilization`（%）と `resets_at`（ISO or null）を持つ。

- `seven_day` / `five_hour` — レスポンスのトップレベル。それぞれ 7日 / 5時間ウィンドウ
- `weekly_scoped` — トップレベルではなく `limits` 配列の要素（`kind === "weekly_scoped"`）。存在しない場合がある（新しめ・一時的な可能性あり）。group は "weekly" のため**時間枠は 7日**として扱う
- `inject.js` の `findLimit()` が `limits` から `kind` で抽出、`normalizeWindow()` が使用量を正規化する。`limits` 要素は使用量を `percent` で持つため `percent` → `utilization` に変換（トップレベルの `utilization` にもフォールバック）。5時間/7日もトップレベルが無ければ `limits` から拾う

### 自動再取得（refreshInterval）

`inject.js` 内で `setInterval(__tempocClickRefresh, ms)`。`ms` は Go が起動時に `settings.RefreshInterval*60000` を `__TEMPOC_REFRESH_MS__` プレースホルダへ文字列置換して埋め込む。**傍受スクリプトは傍受ウィンドウに再注入できない**（上記 ExecJS の制約）ため、`refreshInterval` の変更は**次回起動時**に反映される。

繰り返しの再取得は API 直叩き（`__tempocRefetch`）ではなく、**サイト自身の更新ボタン `_r_bb_` をクリック**する `__tempocClickRefresh` を使う（下記「手動更新」と同じ経路）。通常利用と同じリクエストになり、ヘッダ/CSRF/エンドポイントの正しさをサイトに委ねられるため。ボタンが無ければ `__tempocRefetch` にフォールバック。ただし**初回1回だけ**は、まだ更新ボタンが DOM に無い可能性が高いので `setTimeout(__tempocRefetch, 1500)` の直叩きのまま。

### 手動更新（タイトルバーの更新ボタン）

タイトルバーの歯車の隣の更新ボタン → `Events.Emit('tempoc:refresh')` → Go `app.Event.On("tempoc:refresh")` → `claude.win.ExecJS("window.__tempocClickRefresh && ...")`。`inject.js` の `__tempocClickRefresh()` が claude.ai の使用量更新ボタン（`document.getElementById("_r_bb_")`）を `click()` して API を再リクエストさせ、パッチ済み fetch が最新レスポンスを傍受する。ボタンが無ければ `__tempocRefetch()`（直接 API を叩く）へフォールバック。

**ExecJS を効かせる仕掛け**: 通常 `ExecJS` は `runtimeLoaded`（`@wailsio/runtime` の `wails:runtime:ready` ハンドシェイクでのみ true）待ちで claude.ai では永久に実行されない。そこで `inject.js` が document-start で **生文字列 `"wails:runtime:ready"` を `chrome.webview.postMessage`** し、Wails 側の `HandleMessage` に `runtimeLoaded=true` を立てさせる（JSON ではなく生文字列でないと内部処理へルーティングされない）。副作用は `WindowRuntimeReady` イベント発火と `SetResizable`（ウィンドウスタイルのみ）だけで、claude.ai へ Wails ランタイム JS は注入されない。これにより Go→傍受ページの一方向 ExecJS が使えるようになる。

## 傍受ウィンドウの表示制御（`claudeCtl`）

既定は `Hidden: true`（傍受専用）。

- ログインが必要（`auth-required`）→ 自動表示
- 使用量データ受信（認証済み）→ 自動的に隠す（デバッグでピン留め中は維持）
- 設定画面の「Claude interceptor window」Toggle → 手動表示/非表示（`Events.Emit('tempoc:toggle-claude')` → Go `app.Event.On`）

### クローズ対策（破棄させない）

傍受ウィンドウを × で閉じて**破棄**すると、`inject.js` は再注入できない（下記 ExecJS 制約）ため傍受が二度と復旧しない。これを防ぐため:

- `claude.win.RegisterHook(events.Common.WindowClosing, ...)` で close を**フック**し、`e.Cancel()` + `claudeCtl.hideOnClose()`（ピン解除 + `Hide()`）に置換 → 破棄されず非表示になるだけ。フックはリスナーより先に走るので、Wails 既定の破棄リスナーを先取りしてキャンセルできる。
- 例外はアプリ終了時。`main` は `appQuitting`（`atomic.Bool`）で判定し、真なら close を通す（`cleanup()` が全ウィンドウに `Close()` を呼ぶため）。
- **メインウィンドウを閉じたらアプリ全体を終了**する（`mainWin.OnWindowEvent(events.Common.WindowClosing, ...)` → `appQuitting.Store(true)` + `app.Quit()`）。これが無いと、hide-on-close の傍受ウィンドウだけが登録済みウィンドウとして残り、UI 不在のままプロセスが終了しない（`PostQuitMessage` が呼ばれない）。

## メインウィンドウ UI

### Frameless + カスタムタイトルバー

ネイティブ枠なし（`Frameless: true`）。タイトルバーは React で描画。
- 左: 歯車アイコン → 設定画面トグル
- 右: 最前面トグル（ピン）｜最小化｜閉じる
- ヘッダー全体が `--wails-draggable: drag`、ボタン類は `no-drag`
- `#root` に 5px パディング（リサイズハンドル領域確保。skill 準拠）

### 最前面表示（always on top）

タイトルバーのピンボタン → `settings.alwaysOnTop` をトグル（`updateSettings` で永続化）。`App` の `useEffect` が `settingsLoaded` 後に `Window.SetAlwaysOnTop(settings.alwaysOnTop)` を適用するため、**設定として保存され次回起動時も復元**される。

### 透明ウィンドウ（On/Off）

ネイティブウィンドウは常に完全透明対応（`BackgroundTypeTransparent`, alpha 0, backdrop なし）にしておき、**フロント側で不透明背景を出し入れ**して On/Off する（ランタイムで `BackgroundType` を切り替えられない制約の回避）。
- 設定画面（General）の「Transparent window」チェックボックスでトグル（`settings.transparent`、永続化）
- `settings.transparent` に応じて `App` の `useEffect` が `document.documentElement` に `is-transparent` クラスを付け外し
- CSS: 既定 `html { background: var(--ink) }`（不透明）、`html.is-transparent { background: transparent }`（素通し）
- 設定なので次回起動時も維持

### 使用量バー（`UsageBar`）

上段を **タイトル｜リセット日時｜使用率** の 3 カラムグリッド（列幅固定で上下バーが揃う）。バー本体は「塗り＝使用率」「白い縦マーカー＝時間経過率」。色分けロジックは Chrome 拡張の `content.js` `redraw()` を厳密移植（`computeColor()` / `pickCfg()` に切り出し）:

```
colorEnabled=false                                   → accent
util >= utilizationDanger                            → danger
diff = util - elapsed
  diff > danger                                      → danger
  diff > warning || util >= utilizationWarning       → warning
  otherwise                                          → accent
```
色: accent `#7dd3fc` / warning `#fbbf24` / danger `#ef4444`。

- **使用率の表記**: `utilization` は API 上つねに整数（`percent`）なので `formatUtil()` で `100%` のように整数表示する（`decimalPlaces` / `percentFormat` は適用しない）。一方 **Elapsed（経過%）は計算値**なので `decimalPlaces` / `percentFormat` を適用（`formatPercent()`）。
- **weekly_scoped のネスト表示**: `seven_day` と `weekly_scoped` はリセット時刻・経過・残り時間が同じで、違うのはラベルと使用率だけ。そこで **Weekly limit カード（`seven_day`）の中に副バーとしてネスト**する（`UsageBar` の `secondary` prop）。タイムライン（リセット日時・経過マーカー・残り時間）は主バーと共有し、副バーはラベル・使用率・色のみ独立。表示は `showDay7 && showWeeklyScoped` かつデータ存在時のみ。5時間バーは独立カードのまま。
- **ウィンドウ高さの動的調整**: 副バー（weekly_scoped）が表示されるとき `Window.SetSize(520, 396)`、それ以外は `340`（`App` の `useEffect` が `weeklyBarVisible` を監視）。

## 設定（Chrome 拡張から移植 + 追加）

`settings/settings.go` の `Settings`。永続化先は `%APPDATA%\TEMPOC\settings.json`（`os.UserConfigDir()`）。フロントは起動時に `SettingsService.Get()` で読み込み、`App` の state に保持して `UsageBar` に渡す。変更時は state 更新（即時反映）＋ `SettingsService.Set()`（保存）。

拡張と同一のキー（`showDay7`/`showHour5`、`day7Danger`/`day7Warning`、`day7ColorEnabled`、`hour5*`、`showRemainDay7`/`showRemainHour5`、`decimalPlaces`、`durationStyle`、`percentFormat`、`refreshInterval`、`utilizationWarning`/`utilizationDanger`）に加え、デスクトップ独自:

| キー | 既定 | 説明 |
|---|---|---|
| `locale` | `""`(Auto) | 日時・残り時間の表記ロケール。空は `navigator.language` に従う。設定画面の Language セレクタ（Auto / English / 日本語） |
| `transparent` | `false` | ウィンドウ透明の On/Off（設定画面 General のチェックボックス） |
| `alwaysOnTop` | `false` | 最前面表示の On/Off（タイトルバーのピン。永続化・起動時復元） |
| `showWeeklyScoped` | `true` | weekly_scoped バーの表示 |
| `weeklyScopedWarning` / `weeklyScopedDanger` | `0` / `10` | weekly_scoped の色閾値 |
| `weeklyScopedColorEnabled` | `true` | weekly_scoped の色分け有効 |
| `showRemainWeeklyScoped` | `true` | weekly_scoped の残り時間表示 |
| `weeklyScopedLabel` | `"Weekly (scoped)"` | weekly_scoped 副バーのラベル（設定画面で変更可） |

設定画面（歯車）は 5-Hour / 7-Day / (weekly_scoped 存在時のみ) Weekly (scoped) / General の各セクション + dual-range スライダー + Claude interceptor toggle。weekly_scoped セクションは **データが存在するときだけ表示**され、5h/7d と同じ設定に加え Label（名称）入力を持つ（`SettingsView` の `hasWeeklyScoped` prop で制御）。

### 設定を追加する手順

1. `settings/settings.go` の `Settings` にフィールド追加（+ 必要なら `Default()`）
2. `desktop/` で `wails3 generate bindings`（`frontend/bindings/changeme/settings/` が再生成される）
3. `App.tsx` の設定画面に UI を追加し、描画側へ反映

## 開発・ビルド

```bash
cd desktop
wails3 dev               # 開発起動（GUI・ブロッキング）
wails3 generate bindings # Go の Service/型を変更したら必須
go build ./...           # Go のコンパイル確認
cd frontend && npx tsc --noEmit   # フロントの型チェック
```

- Go の Service やバインド対象の型を変えたら **必ず `wails3 generate bindings`**。忘れると無言で壊れる
- バインディングの import パスはパッケージパス基準: `import { SettingsService } from '../bindings/changeme'`、`Settings` 型は `../bindings/changeme/settings`

## 既知の制約・注意

- **`ExecJS` は傍受ウィンドウ（claude.ai）では使えない**（`runtimeLoaded` が立たない）。ページへの注入は document-created 方式のみ
- そのため `refreshInterval` の変更は次回起動時に反映
- DOM セレクタ依存の脆さは無い（自前 DOM を描画するため）が、傍受は使用量 API のパス・レスポンス形状に依存する
- 完全透明時は背景次第で文字が読みづらくなることがある
