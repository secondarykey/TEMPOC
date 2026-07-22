# desktop/CLAUDE.md

TEMPOC のデスクトップ版（Wails v3）。Chrome 拡張（`chrome-extension/src/`。[`../chrome-extension/CLAUDE.md`](../chrome-extension/CLAUDE.md)）と同じ「claude.ai の使用量 API を傍受して 5時間 / 7日ウィンドウの進捗を表示する」機能を、スタンドアロンのデスクトップアプリとして提供する。

- Wails: `github.com/wailsapp/wails/v3` alpha2.114
- Go module 名: `changeme`（テンプレート既定のまま。変更していない）
- フロント: React + Vite + TypeScript、`@wailsio/runtime`
- 対象プラットフォーム: Windows（WebView2 前提）
- Wails 全般の作法は `.claude/skills/wails3` を参照

## 全体像

claude.ai には「いつ枠がリセットされるか（何日の何時か）」が表示されない。これを取得・表示するのが本アプリの主目的。

Chrome 拡張は claude.ai のページ内に content script を注入して `window.fetch` を傍受していた。デスクトップ版は **Wails の WebView 内に claude.ai を読み込み**、同じ fetch 傍受を行って結果を Go 経由で自前 UI に流す。

### 3 ウィンドウ構成

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

┌─ 設定ウィンドウ (Frameless, 既定 Hidden, URL "/?window=settings") ─┐
│  メインの歯車 → Events.Emit("tempoc:open-settings") で Show      │
│  ドラフト編集 → Apply で Set + "tempoc:settings-applied" 発行     │
│  ✕/Close → close フックで Hide（破棄しない。傍受ウィンドウと同型） │
└──────────────────────────────────────────────────────────────┘
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `main.go` | エントリポイント。3 ウィンドウ生成（メイン・Claude 傍受・設定）、`RawMessageHandler`、イベント登録、傍受ウィンドウ表示制御 |
| `inject.js` | claude.ai に注入される素の JS。`window.fetch` を monkeypatch し使用量を postMessage |
| `settings/settings.go` | 設定モデル（`Settings` 構造体 + `Default()`）。Wails 非依存 |
| `settings/repository.go` | 設定の永続化（`os.UserConfigDir()/TEMPOC/settings.json`） |
| `settings/windowstate.go` | ウィンドウ位置の永続化（`windowstate.json`）。Wails 非依存 |
| `settings_service.go` | `SettingsService`（`Get()` / `Set()`）。フロントにバインド |
| `frontend/src/App.tsx` | URL クエリルーター（`?window=settings` で分岐）+ メインウィンドウ UI（タイトルバー・使用量バー） |
| `frontend/src/SettingsWindow.tsx` | 設定ウィンドウ UI（`SettingsView`・ドラフト管理・Apply/Close） |
| `frontend/src/theme.ts` | 共有テーマ色（`COLORS`）。App.tsx と SettingsWindow.tsx の両方から import |
| `frontend/src/i18n.ts` | i18n ロジック。サポートロケール一覧（`SUPPORTED_LOCALES`）、設定値/`navigator.language` をサポートコードへ解決する `resolveLocale()`、JSON を読み込んで型付き `Messages` を組み立てる `getMessages()`。App.tsx と SettingsWindow.tsx の両方から import |
| `frontend/src/locales/*.json` | ロケール別の文言リソース（`en-US.json` / `ja-JP.json`）。翻訳文字列の実体。パラメータ付きは `{token}` プレースホルダ、`durationUnits`/`ago` は Intl フォールバック用のデータ。i18n.ts の `RawMessages` 型に代入して**キー欠落はビルドで検出**（型チェックが落ちる）。**ルート `locales/` の同期コピーで直接編集不可**（`python3 scripts/sync_locales.py` で同期） |
| `frontend/src/main.tsx` | React エントリ。`import '@wailsio/runtime'`（Frameless のドラッグに必須） |
| `frontend/public/style.css` | スタイル |
| `frontend/bindings/changeme/` | `wails3 generate bindings` の生成物（git 管理外。無ければ `desktop/` で `wails3 generate bindings` を実行して生成） |

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
- `location` — href 変化時に送信。Go が傍受ウィンドウのネイティブタイトルに URL を反映（`SetTitle`）。これだけは claude.ai 以外のオリジンからも受け付ける（OAuth 中は accounts.google.com 等にいるため）。ただし**報告 URL がメッセージの実オリジン（`originInfo.Origin`）で始まる場合のみ**反映 — ページは自分の URL しかタイトルに出せない
- `auth-required` — 未認証を検知（`/login` にいる、または API が 401/403 を返した）→ `app.Event.Emit("tempoc:auth-required")` でフロントへ通知。フロントは usage データが残っていてもログイン前表示（「Log in to Claude」ボタン）に戻し、クリックで `Events.Emit('tempoc:login')` → Go が傍受ウィンドウを表示する（勝手には出さない）。このとき `/login` 以外の古い SPA 画面のままなら ExecJS で usage URL へ読み込み直し、claude.ai にログインページへ誘導させる
- `debug` — ログ出力用

### ログイン遷移の検知（pathname ウォッチャー）

ログインの完了/失効は claude.ai 内の **SPA 遷移**（新しいドキュメントを作らない）なので、document-created 注入スクリプトは再実行されない。そこで `inject.js` は `location.pathname` を1秒間隔でポーリングし:

- `/login` に**入った** → `auth-required` を post（SPA 遷移でのセッション切れも拾える）
- `/login` から**出た** → ログイン成功。SPA は `/new` に着地してハッシュが失われるため、**usage URL（`/new#settings/usage`）を開き直してモーダルを復元**する。リロード後は再注入スクリプトの初回取得がデータを届け、以後の自動更新はサイトの更新ボタン経由になる。ハッシュが残っている稀なケースのみ `__tempocRefetch()`（成否 boolean の Promise を返す）で直接取得

同じ1秒ティックで**アドレスバー**も駆動する: `location.href` をページ最下部の読み取り専用オーバーレイ（最上部だと claude.ai の上部ナビに視覚的に被ってボタンが狙いにくい）（`pointer-events: none`、SPA が body を再描画しても `isConnected` チェックで再生成）に表示し、href 変化時は `location` メッセージでネイティブタイトルにも反映する。アプリ内描画は偽装可能なため厳密な証明にはならない — ユーザー向けの検証手段（F12 DevTools 等）は `README.md` の Trust 節に記載。

ページ遷移を伴わないログアウト（別ブラウザからのログアウト等でセッションだけ失効するケース）は pathname では検知できないため、**API レスポンスからも未認証を検知して `auth-required` を post** する:

- `__tempocRefetch` の `/api/organizations`・usage 取得、およびパッチ済み fetch が傍受するサイト自身の usage リクエストの **401/403**
- `/api/organizations` が **200 でも空/非配列**のとき（実測ではログアウト状態でこちらが返る。正規アカウントに組織ゼロは無い）
- `catch`（ネットワークエラー等の一時障害）は認証エラー扱いに**しない**

手動更新ボタン → `__tempocRefetch` が失敗 → ログイン前表示に戻る、という経路もこれでカバーされる。

これが無いと、ログインページ上で失敗した初回取得（1.5秒後の `__tempocRefetch`）以降、誰も usage API を叩かず、ユーザーが手動で usage ページを開くまで無反応になる。Google OAuth 等のフルページ遷移で戻るケースは新ドキュメントでスクリプト自体が再実行されるため、ウォッチャー無しでも初回取得が走る。

### 対象 API

`/api/organizations/{id}/usage`（正規表現 `^/api/organizations/[^/]+/usage$`）。各ウィンドウは `utilization`（%）と `resets_at`（ISO or null）を持つ。

- `seven_day` / `five_hour` — レスポンスのトップレベル。それぞれ 7日 / 5時間ウィンドウ
- `weekly_scoped` — トップレベルではなく `limits` 配列の要素（`kind === "weekly_scoped"`）。存在しない場合がある（新しめ・一時的な可能性あり）。group は "weekly" のため**時間枠は 7日**として扱う
- `inject.js` の `findLimit()` が `limits` から `kind` で抽出、`normalizeWindow()` が使用量を正規化する。`limits` 要素は使用量を `percent` で持つため `percent` → `utilization` に変換（トップレベルの `utilization` にもフォールバック）。5時間/7日もトップレベルが無ければ `limits` から拾う

### 自動再取得（refreshInterval）

`inject.js` 内で `setInterval(__tempocClickRefresh, ms)`。`ms` は Go が起動時に `settings.RefreshInterval*60000` を `__TEMPOC_REFRESH_MS__` プレースホルダへ文字列置換して埋め込む。**傍受スクリプトは傍受ウィンドウに再注入できない**（上記 ExecJS の制約）ため、`refreshInterval` の変更は**次回起動時**に反映される。

繰り返しの再取得は API 直叩き（`__tempocRefetch`）ではなく、**サイト自身の更新ボタンをクリック**する `__tempocClickRefresh` を使う（下記「手動更新」と同じ経路）。ボタンは `findRefreshButton()` が **モーダル（`[role="dialog"]`）内の `aria-label="Refresh"`（または「更新」）** で構造的に探す — React の自動生成 ID（`_r_bb_` → `_r_h7_` と実際に変わった）には依存しない（旧 ID は最後の保険としてのみ参照）。通常利用と同じリクエストになり、ヘッダ/CSRF/エンドポイントの正しさをサイトに委ねられるため。**API 直叩きは極力使わない**方針: ボタンが無い場合、まず「usage モーダルが開いていない（SPA 遷移でハッシュ喪失）」を疑い、claude.ai 上でハッシュが `#settings/usage` でなければ **usage URL を開き直してモーダルを復元**する（リロード後の初回取得がデータを届け、以後はボタンが押せる）。ハッシュが正しいのにボタンが無い（ID 変更等）ときだけ `__tempocRefetch` にフォールバック — この分岐が再リロードしないことでリロードループを防ぐ。ただし**初回1回だけ**は、まだ更新ボタンが DOM に無い可能性が高いので `setTimeout(__tempocRefetch, 1500)` の直叩きのまま。また **`/login` 上では `__tempocClickRefresh` は何もしない** — モーダル復元リロードが走るとログイン入力中のユーザーの画面が消えるため（ログイン完了後の復帰は watchAuthTransition が担う）。

### 手動更新（タイトルバーの更新ボタン）

タイトルバーの歯車の隣の更新ボタン → `Events.Emit('tempoc:refresh')` → Go `app.Event.On("tempoc:refresh")` → `claude.win.ExecJS("window.__tempocClickRefresh && ...")`。`inject.js` の `__tempocClickRefresh()` が claude.ai の使用量更新ボタン（`findRefreshButton()` — モーダル内 `aria-label="Refresh"`）を `click()` して API を再リクエストさせ、パッチ済み fetch が最新レスポンスを傍受する。ボタンが無ければモーダル復元 → `__tempocRefetch()`（直接 API を叩く）の順にフォールバック（上記「自動再取得」参照）。

**ExecJS を効かせる仕掛け**: 通常 `ExecJS` は `runtimeLoaded`（`@wailsio/runtime` の `wails:runtime:ready` ハンドシェイクでのみ true）待ちで claude.ai では永久に実行されない。そこで `inject.js` が document-start で **生文字列 `"wails:runtime:ready"` を `chrome.webview.postMessage`** し、Wails 側の `HandleMessage` に `runtimeLoaded=true` を立てさせる（JSON ではなく生文字列でないと内部処理へルーティングされない）。副作用は `WindowRuntimeReady` イベント発火と `SetResizable`（ウィンドウスタイルのみ）だけで、claude.ai へ Wails ランタイム JS は注入されない。これにより Go→傍受ページの一方向 ExecJS が使えるようになる。

## 傍受ウィンドウの表示制御（`claudeCtl`）

既定は `Hidden: true`（傍受専用）。

- ログインが必要（`auth-required`）→ フロントが「Log in to Claude」ボタンを表示し、クリック（`tempoc:login`）で表示（ピン留めなし）。自動では表示しない
- 使用量データ受信（認証済み）→ 自動的に隠す（デバッグでピン留め中は維持）
- 設定ウィンドウの「Claude interceptor window」Toggle → 手動表示/非表示（`Events.Emit('tempoc:toggle-claude')` → Go `app.Event.On`）

### クローズ対策（破棄させない）

傍受ウィンドウを × で閉じて**破棄**すると、`inject.js` は再注入できない（下記 ExecJS 制約）ため傍受が二度と復旧しない。これを防ぐため:

- `claude.win.RegisterHook(events.Common.WindowClosing, ...)` で close を**フック**し、`e.Cancel()` + `claudeCtl.hideOnClose()`（ピン解除 + `Hide()`）に置換 → 破棄されず非表示になるだけ。フックはリスナーより先に走るので、Wails 既定の破棄リスナーを先取りしてキャンセルできる。
- 例外はアプリ終了時。`main` は `appQuitting`（`atomic.Bool`）で判定し、真なら close を通す（`cleanup()` が全ウィンドウに `Close()` を呼ぶため）。
- **メインウィンドウを閉じたらアプリ全体を終了**する（`mainWin.OnWindowEvent(events.Common.WindowClosing, ...)` → `appQuitting.Store(true)` + `app.Quit()`）。これが無いと、hide-on-close の傍受ウィンドウだけが登録済みウィンドウとして残り、UI 不在のままプロセスが終了しない（`PostQuitMessage` が呼ばれない）。

## メインウィンドウ UI

### Frameless + カスタムタイトルバー

ネイティブ枠なし（`Frameless: true`）。タイトルバーは React で描画。
- 左: 歯車アイコン → 設定ウィンドウを開く（`Events.Emit('tempoc:open-settings')` → Go が `Show()` + メインの現在のピン状態を `SetAlwaysOnTop` で追従させる）
- 右: 最前面トグル（ピン）｜最小化｜閉じる
- ヘッダー全体が `--wails-draggable: drag`、ボタン類は `no-drag`
- `#root` に 5px パディング（リサイズハンドル領域確保。skill 準拠）
- **✕ は `Window.Close()` ではなく `Events.Emit('tempoc:quit')`** — Frameless は `WindowClosing` 時点で `Position()` が不正値を返すことがあるため、ウィンドウが生きているうちに Go が位置を保存してから `app.Quit()` する（下記「ウィンドウ位置の保存・復元」）

### ウィンドウ位置・幅の保存・復元

メインウィンドウの位置と幅は終了時に保存し、次回起動時に復元する（高さはコンテンツ追従のため保存しない）。保存先は `%APPDATA%\TEMPOC\windowstate.json`（`settings/windowstate.go`）。**settings.json とは別ファイル** — ウィンドウ状態はユーザーが編集する設定ではなく、Settings に含めると設定ウィンドウのドラフト/Apply が古い座標で上書きし得るため分離している。

- **保存**: タイトルバー ✕ → `tempoc:quit` → Go が `mainWin.Position()`/`Size()` を保存して終了（正経路）。Alt+F4 / OS シャットダウンは `WindowClosing` でのベストエフォート保存（Frameless では不正値の可能性あり）。`sync.Once` で1回だけ。最小化中（約 -32000）は保存しない
- **復元は二段階**: (1) 起動時に保存座標を `X`/`Y` + `InitialPosition: application.WindowXY` で渡す（`WindowXY` を明示しないとゼロ値 `WindowCentered` が勝ち X/Y が無視される）。保存が無ければ従来どおり中央。幅は MinWidth 未満・4000 超なら既定 520 に戻す。(2) `WindowRuntimeReady` で `ScreenNearestDipPoint` により最寄りモニタの `WorkArea` へ位置をクランプ（モニタ取り外し対策。スクリーン情報は `Run()` 前は取れない）。幅が WorkArea より広い場合もここで既定 520 に戻す（クランプではなくデフォルト復帰）
- 未保存の判定は、位置はセンチネル `settings.UnsetPos`（-9999。負の座標はマルチモニタで正当なため `0`/`<0` では判定しない）、幅は `0`（幅 0 はあり得ないため）

### セカンダリウィンドウの初回表示位置

設定ウィンドウ・傍受ウィンドウは**初回 Show 時にメインウィンドウと同じモニタ**に配置する（`placeOnMainScreen`: メイン位置 +48,+48 をそのモニタの WorkArea にクランプ）。2回目以降の Show ではユーザーが動かした位置を尊重する（`sync.Once`）。

### 最前面表示（always on top）

タイトルバーのピンボタン → `settings.alwaysOnTop` をトグル（`updateSettings` で永続化）。`MainWindow` の `useEffect` が `settingsLoaded` 後に `Window.SetAlwaysOnTop(settings.alwaysOnTop)` を適用するため、**設定として保存され次回起動時も復元**される。

### 透明ウィンドウ（On/Off）

ネイティブウィンドウは常に完全透明対応（`BackgroundTypeTransparent`, alpha 0, backdrop なし）にしておき、**フロント側で不透明背景を出し入れ**して On/Off する（ランタイムで `BackgroundType` を切り替えられない制約の回避）。
- 設定ウィンドウの General セクションの「Transparent window」チェックボックスでドラフト編集 → Apply で確定（`settings.transparent`、永続化）
- `settings.transparent` に応じて `MainWindow` の `useEffect` が `document.documentElement` に `is-transparent` クラスを付け外し
- CSS: 既定 `html { background: var(--ink) }`（不透明）、`html.is-transparent { background: transparent }`（素通し）
- 設定なので次回起動時も維持

### 使用量バー（`UsageBar`）

上段（`usage-bar-head`）は **ラベル｜使用率** の 2 カラム。使用率のすぐ左に日時が並ぶと「日付 xx%」に見えて何の％か紛らわしいため、**リセット日時は下段（`usage-bar-foot`）へ移動**した。下段は「時間の行」で **`{日付}にリセット`（左）｜`あと{残り時間}`（右）** の 2 セル（flex space-between。`resetsAt` / `remaining` は i18n テンプレート。左右で「リセット」の語を分担するため right は `でリセット` を含まない）。バー本体は「塗り＝使用率」「白い縦マーカー＝時間経過率」。

**バーごとのツールチップ（`title`）**: `使用量｜リセット日付｜経過%｜残り` を改行区切りでまとめた `title` を各バーに付ける（`buildTip(util)` で生成、全サイズモード共通）。経過%は独立表示を持たずこのツールチップに集約。**リセット日付/経過/残りはタイムライン共有なので主バーと副バーで違うのは使用量の行だけ**。主バーは `tooltip`（=`buildTip(util)`）、**weekly_scoped 副バーは `secTooltip`（=`buildTip(secUtil)`）で自分の使用量を表示**する。
- ノーマル/スモール: `.usage-bar` カードに主 `tooltip`、副バーの `usage-bar-head--sub` と `usage-bar-track-wrap` に `secTooltip` を付けて内側で上書き（ホバーで副バーは Scoped 値、それ以外は主バー値）。マーカー・フッターセルに個別 `title` は付けない。
- コンパクト: 各行（`usage-bar-compact`）に自分のツールチップ（主行=`tooltip`、副行=`secTooltip`）。**ラベルの省略時 `title` は付けない**ため、行のどこ（ラベル含む）をホバーしてもこの値が出る。

色分けロジックは Chrome 拡張の `content.js` `redraw()` を厳密移植（`computeColor()` / `pickCfg()` に切り出し）:

```
colorEnabled=false                                   → accent
util >= utilizationDanger                            → danger
diff = util - elapsed
  diff > danger                                      → danger
  diff > warning || util >= utilizationWarning       → warning
  otherwise                                          → accent
```
色: accent `#7dd3fc` / warning `#fbbf24` / danger `#ef4444`。

- **残り時間の表記**: 残り1分未満は**秒でカウントダウン**する（`formatRemaining`）。`Intl.DurationFormat` は 0 の単位を省くため、日/時/分だけを渡すと最後の1分は空文字になり「あと」「left」だけが残ってしまう。この間だけ `{ seconds }` を渡し、`durationFallback` も日/時/分がすべて 0 なら秒だけを返す
- **使用率の表記**: `utilization` は API 上つねに整数（`percent`）なので `formatUtil()` で `100%` のように整数表示する（`decimalPlaces` / `percentFormat` は適用しない）。一方 **Elapsed（経過%）は計算値**なので `decimalPlaces` / `percentFormat` を適用（`formatPercent()`）。
- **weekly_scoped のネスト表示**: `seven_day` と `weekly_scoped` はリセット時刻・経過・残り時間が同じで、違うのはラベルと使用率だけ。そこで **Weekly limit カード（`seven_day`）の中に副バーとしてネスト**する（`UsageBar` の `secondary` prop）。タイムライン（リセット日時・経過マーカー・残り時間）は主バーと共有し、副バーはラベル・使用率・色のみ独立。表示は `showDay7 && showWeeklyScoped` かつデータ存在時のみ。5時間バーは独立カードのまま。
- **ウィンドウ高さの動的調整**: 副バー（weekly_scoped）が表示されるとき `Window.SetSize(520, 396)`、それ以外は `340`（`MainWindow` の `useEffect` が `weeklyBarVisible` を監視）。

## 設定（Chrome 拡張から移植 + 追加）

`settings/settings.go` の `Settings`。永続化先は `%APPDATA%\TEMPOC\settings.json`（`os.UserConfigDir()`）。メインウィンドウは起動時に `SettingsService.Get()` で読み込み、`MainWindow` の state に保持して `UsageBar` に渡す。

設定編集は独立した設定ウィンドウ（メインとは別 JS コンテキストのため state を共有できない）が担い、**ドラフト方式**で保存する:

- 設定ウィンドウはマウント時 + `tempoc:open-settings` 受信時に `SettingsService.Get()` でドラフトを読み込む（`updateDraft` は state 更新のみで保存はしない）
- Apply（`SettingsWindow.tsx` の `apply()`）は、保存直前にもう一度 `Get()` して `alwaysOnTop` だけ現在値を採用しドラフトへ上書き（メインのピンボタンがドラフト外で唯一即時保存する項目のため、古いドラフトで巻き戻さないための対策）→ `SettingsService.Set()` → `Events.Emit('tempoc:settings-applied')`
- メインウィンドウは `tempoc:settings-applied` を購読して `SettingsService.Get()` で再読込するだけ（値をイベントペイロードに乗せない）。これにより既存の transparent / alwaysOnTop / sizeMode 用 `useEffect` がそのまま適用処理として機能する
- 閉じる（✕ / Close ボタン）は未適用の変更を確認なしで破棄する。`Window.Close()` は close フックで `Hide()` に置き換えられ実際には破棄されない（傍受ウィンドウの close フックと同型）ため、次に `tempoc:open-settings` で開いたときにドラフトが保存値へ再読込されることで「破棄」が成立する

**前提**: Wails alpha2.114 ではフロントから発行した `Events.Emit` は Go 側リスナーと（発行元を含む）全ウィンドウの両方に配信される。設定ウィンドウ↔メインウィンドウの通知に Go 中継コードは不要。

イベント: `tempoc:open-settings`（メインの歯車 → Go が設定ウィンドウを `Show()`、設定ウィンドウ front はドラフト再読込）/ `tempoc:settings-applied`（設定ウィンドウの Apply → メインが `Get()` で再読込）/ `tempoc:quit`（メインの ✕ → Go が位置保存してから終了）。

拡張と同一のキー（`showDay7`/`showHour5`、`day7Danger`/`day7Warning`、`day7ColorEnabled`、`hour5*`、`showRemainDay7`/`showRemainHour5`、`decimalPlaces`、`durationStyle`、`percentFormat`、`refreshInterval`、`utilizationWarning`/`utilizationDanger`）に加え、デスクトップ独自:

| キー | 既定 | 説明 |
|---|---|---|
| `locale` | `""`(Auto) | **UI 言語**と日時・残り時間の表記ロケール。値は Claude 公式のロケールコード（地域サブタグ付き: `en-US` / `ja-JP`。一覧は `frontend/src/i18n.ts` の `SUPPORTED_LOCALES`、将来は公式の全コードへ拡張予定）。空は `navigator.language` を最寄りのサポートコードへ解決（`ja` → `ja-JP`、非対応言語 → `en-US`）。**UI 文言と Intl 日時整形の両方に同じ解決済みコードを使う**ため言語と日付書式がズレない。設定ウィンドウの Language セレクタは選択した瞬間に設定ウィンドウ自身へプレビューされ、メインへの反映は Apply 時 |
| `theme` | `"system"` | UI テーマ: `system` / `light` / `dark`。`system` は `prefers-color-scheme` で OS 設定に追従（OS 側の切り替えもライブ反映）。`theme.ts` の `applyTheme()` が `<html>` に `data-theme="light\|dark"` を付与し、`style.css` の CSS 変数（`:root` = ダーク既定、`[data-theme="light"]` で上書き）が切り替わる。バー色（`COLORS`）も `var(--color-*)` 参照でテーマ追従。メイン・設定ウィンドウは別 JS コンテキストのため各自 `applyTheme()` を呼ぶ（設定ウィンドウは保存値で描画し、Apply 時に反映） |
| `transparent` | `false` | ウィンドウ透明の On/Off（設定ウィンドウ General のチェックボックス） |
| `alwaysOnTop` | `false` | 最前面表示の On/Off（タイトルバーのピン。永続化・起動時復元） |
| `showWeeklyScoped` | `true` | weekly_scoped バーの表示 |
| `weeklyScopedWarning` / `weeklyScopedDanger` | `0` / `10` | weekly_scoped の色閾値 |
| `weeklyScopedColorEnabled` | `true` | weekly_scoped の色分け有効 |
| `showRemainWeeklyScoped` | `true` | weekly_scoped の残り時間表示 |
| `weeklyScopedLabel` | `""` | weekly_scoped 副バーのラベル（設定ウィンドウで変更可）。空は UI 言語の既定ラベル（`i18n.ts` の `weeklyScopedFallback`）に従う |

設定ウィンドウ（`SettingsWindow.tsx` の `SettingsView` コンポーネント）は General / Formatting / 5-Hour / 7-Day / (weekly_scoped 存在時のみ) Weekly (scoped) / Utilization Threshold の各セクション + dual-range スライダー + Claude interceptor toggle、フッターに Apply/Close ボタンを持つ。weekly_scoped セクションは **データが存在するときだけ表示**され、5h/7d と同じ設定に加え Label（名称）入力を持つ（`hasWeeklyScoped` prop で制御。設定ウィンドウ自身も `tempoc:usage` を購読して導出）。設定ウィンドウは常に不透明（`BackgroundColour` を不透明固定・`is-transparent` クラスを付けない）— `transparent` 設定はメインウィンドウの表示にのみ適用される。

### 設定を追加する手順

1. `settings/settings.go` の `Settings` にフィールド追加（+ 必要なら `Default()`）
2. `desktop/` で `wails3 generate bindings -ts`（`frontend/bindings/changeme/settings/` が再生成される）
3. `SettingsWindow.tsx` の `SettingsView` に UI を追加し、`App.tsx`（`UsageBar` などの描画側）へ反映

## 国際化（i18n）

UI 文言と日時・残り時間の表記をロケール対応にする仕組み。メイン・設定ウィンドウの両方が使う。

### 構成

| 要素 | 役割 |
|---|---|
| `frontend/src/locales/<code>.json` | **翻訳文字列の実体**。ロケールごとに1ファイル（`en-US.json` / `ja-JP.json`）。UI ロジックからは分離されている。**ルート `locales/`（マスター）の同期コピーなので直接編集しない** — ルートを編集して `python3 scripts/sync_locales.py` を実行する（[`../CLAUDE.md`](../CLAUDE.md) の Shared locale resources 参照） |
| `frontend/src/i18n.ts` | ロジック。JSON を import し、`resolveLocale()`・`getMessages()`・型定義（`Messages` / `RawMessages`）を提供 |

### ロケールコード

内部で持つのは **Claude 公式のロケールコード（地域サブタグ付き: `en-US` / `ja-JP`）**。`SUPPORTED_LOCALES`（`i18n.ts`）が一覧で、将来は公式の全コードへ拡張する前提。設定 `locale` の空値（Auto）は `resolveLocale()` が `navigator.language` を最寄りのサポートコードへ解決する（完全一致 → 主言語一致 `ja`→`ja-JP` / `en-GB`→`en-US` → 既定 `en-US`）。**解決済みの1コードを UI 文言と Intl 日時整形の両方に渡す**ため、言語と日付書式がズレない。

### JSON の中身と組み立て

`getMessages(locale)` が JSON（`RawMessages`）を消費側 API（`Messages`）へ組み立てる。3 種類ある:

- **プレーン文字列**（大多数）— そのまま `Messages` のフィールドになる（例: `"settings": "設定"`）
- **パラメータ付き**（`updated` / `elapsed` / `resetsIn` / `resetsTooltip`）— JSON では `{token}` プレースホルダ入りテンプレート（例: `"updated": "{when}に更新"`）。`i18n.ts` の `interpolate()` が `{key}` を埋め、`Messages` では**関数**として公開される（`t.updated("2分前")` → `"2分前に更新"`）。言語ごとに token の位置を変えられるのが要点
- **Intl フォールバック用データ**（`durationUnits` / `ago`）— `Intl.DurationFormat` / `Intl.RelativeTimeFormat` が使えない環境（WebView2 では基本的に発生しない保険）向け。組み立てロジック（どの単位を出すか、複数形の選択）は言語非依存なので `i18n.ts` に置き、**単位ラベルだけ** JSON に持つ。`ago` は CLDR 準拠で `one`/`other` の複数形を持ち、`value === 1` で選択

### 型安全（キー欠落はビルドで落ちる）

各 JSON を `RawMessages` 型へ代入しているため、**あるロケールでキーが欠けると `tsc`（＝ビルド）が失敗する**。ランタイムで undefined 文字列が出ることはない。消費側は `Messages` 型経由なので、文言の追加時に `App.tsx` / `SettingsWindow.tsx` のどこで使うかも型で導かれる。

### ネイティブウィンドウタイトル（タスクバー / Alt-Tab）

Frameless のタイトルバーは React 描画だが、**タスクバー・Alt-Tab に出るネイティブタイトルは Wails が持つ**。これを **Go にロケール解決を持たせず**ローカライズするため、設定ウィンドウ自身の JS コンテキストが `Window.SetTitle(\`TEMPOC ${t.settingsTitle}\`)` を `useEffect` で呼び、**ドラフト言語（プレビュー中の UI 言語）に追従**させる。`main.go` 側の `Title: "TEMPOC Settings"` は **React マウント前のフォールバックだけ**（マウント後に上書きされる）。`Locale` が空（Auto）でもフロントは `navigator.language` を解決済みなので、Go 側の言語判定は不要。メインウィンドウのタイトルは `TEMPOC`（ブランド名）でローカライズ対象外。**傍受ウィンドウのタイトル（`… — TEMPOC interceptor`）は Go が動的に組み立てる**（claude.ai を読むため React 不在で `SetTitle` できない）ので現状は英語のまま — 必要ならローカライズ語をフロントから Go へ渡す方式にする。

### 言語を追加する手順

1. ルート `locales/<code>.json` を新規作成（既存 JSON をコピーして全キーを翻訳。キーが揃っていないと `sync_locales.py` と `tsc` の両方で落ちるのでコピーが安全）し、`python3 scripts/sync_locales.py` で両モジュールへ同期
2. `i18n.ts` の `SUPPORTED_LOCALES` に `<code>` を追加し、`import` と `build(...)` を1行ずつ足す（拡張側は `chrome-extension/src/i18n.js` の `TEMPOC_LOCALES` — [`../chrome-extension/CLAUDE.md`](../chrome-extension/CLAUDE.md) 参照）
3. `SettingsWindow.tsx` の Language セレクタに `<option>` を追加（表示名は各言語の自称表記のまま。例: `English` / `日本語`）

**文言キーの追加時**（新しい UI 文字列を足すとき）は、`RawMessages`（`i18n.ts`）にフィールドを足し、**ルート `locales/` の全 JSON に同じキーを足して同期**する（欠けると `sync_locales.py` と `tsc` の両方が指摘する）。パラメータ付きなら `Messages` 側の関数シグネチャと `build()` の組み立ても足す。拡張のオプションページだけが使うキー（`previewLabel` / `refreshHelp` / `savedToast`）も `RawMessages` に列挙してあり、デスクトップの型チェックが全キーの充足を保証する。

## 開発・ビルド

```bash
cd desktop
wails3 dev               # 開発起動（GUI・ブロッキング）
wails3 generate bindings -ts # Go の Service/型を変更したら（dev を使わない場合）
go build ./...           # Go のコンパイル確認
cd frontend && npx tsc --noEmit   # フロントの型チェック
```

- **`wails3 dev` は bindings を内部で自動再生成する**（`build/Taskfile.yml` の `generate:bindings`、`-clean=true -ts`）。dev の前に手動で generate する必要はない
- 手動で generate する場合（`npx tsc --noEmit` の前など）は **`-ts` を付ける**（dev と同一フォーマット＝TypeScript クラス）。**`-i` は付けない** — interface 生成になり、`new Settings()`（App.tsx）が `TS2693: 'Settings' only refers to a type` で壊れる。引数なし（JS 生成）でもコンパイルは通るが、dev と生成物が入れ替わり続けるので避ける
- Go の Service やバインド対象の型を変えたら bindings の再生成を忘れない。忘れると無言で壊れる
- **ログは slog 1本**（`slog.SetDefault` と `application.Options.Logger` に同一ロガー。渡さないと Wails は制御外の出力先に流す）。レベルは `production` ビルドタグで切り替え（`dev.go` / `production.go`）: 開発 = Info、正規ビルド（`wails3 task windows:build`）= Warn
- **`-log debug|info|warn` でファイル出力**: 指定時のみ、標準エラーの代わりに**実行位置（カレントディレクトリ）の `YYYY-MM-DD.log`** へ指定レベルで出力（同日は追記）。正規 exe（windowsgui でコンソール無し）からログを取る手段であり、`slog.Debug`（inject.js の debug 中継等）を見る手段でもある。フラグ無しの既定では Debug はどこにも出ない
- バインディングの import パスはパッケージパス基準: `import { SettingsService } from '../bindings/changeme'`、`Settings` 型は `../bindings/changeme/settings`

## バージョン管理・アプリ情報

バージョンの**唯一の正は `desktop/version`**（テキスト1行）。`build/config.yml` の `info.version` と `frontend/package.json` の `version` はその写しで、**手で編集しない**。同期は `_cmd/version.go` が行う（`desktop/` から実行）:

```bash
go run ./_cmd/version.go 1.2.3   # 指定バージョンを全ファイルへ
go run ./_cmd/version.go -bump   # patch/minor/major を対話選択（Enter=patch）
go run ./_cmd/version.go         # version の現在値で他ファイルを再同期
go run ./_cmd/version.go -print  # 現在値を表示するだけ（CI 用）
```

`frontend/package-lock.json` の `version` は**同期対象に含めていない**。ロック内の依存パッケージのバージョン行と同じインデント（6スペースの `"version": "..."`）で並んでおり、行パターンで置換すると全依存のバージョンを書き潰すため。ビルド時の `npm install`（`npm ci` ではない）が package.json に合わせて自動で書き直すので実害はなく、アプリの中身にも影響しない。

`_cmd/` はアンダースコア始まりなので go ツールが `./...` から除外する。よってこのツールは `go build ./...` の対象外だが `go run ./_cmd/version.go` では動く。`main.go` の `//go:embed version` は **version ファイルが main.go と同じディレクトリにある必要がある**（ルートの `chrome-extension/version` は参照できない）。埋め込んだ値は起動ログ（`level=INFO msg=starting version=0.1.0`。開発ビルドのみ — 下記ログ方針参照）に出る。

### exe 名（`APP_NAME`）

exe 名は `Taskfile.yml` の `APP_NAME`（= `tempoc`）が決める。`config.yml` の `info:` には**バイナリ名を指定するキーが無い**ため（`name:` / `binary:` は存在しない）、`update build-assets` へは `-name` / `-binaryname` として渡される。よって `APP_NAME` を変えたら `wails3 task common:update:build-assets` → 再ビルドまでやらないと、生成済みアセット（NSIS の `INFO_PROJECTNAME`、Linux の `Exec`/`Icon`/`StartupWMClass`、darwin の `CFBundleExecutable`）が古い名前のまま残る。

⚠️ **`APP_NAME` の変更は WebView2 のユーザーデータフォルダ（`%APPDATA%\<exe名>\EBWebView`）を変える**。旧フォルダのセッションは引き継がれないため、改名後の初回起動では claude.ai が未ログイン状態になり、一度ログインし直すことになる（`desktop` → `tempoc` の改名時も同様）。この挙動は `.claude/skills/tempoc-desktop-verify` にも別名 exe のスモークテスト手段として記載がある。

### exe のメタデータ（`info:` → 各アセット）

`build/config.yml` の `info:` が一元ソース。値の対応と「ユーザーに何として見えるか」は `.claude/skills/wails3/references/build-assets.md` を参照。**Windows のタスクバー／タスクマネージャの表示名は `description`（FileDescription）であって ProductName ではない**ため、`description` にはアプリの表示名を入れてある。

再生成は**必ず Taskfile 経由**で行う:

```bash
wails3 task common:update:build-assets   # -name/-binaryname/-config/-dir を APP_NAME 込みで渡してくれる
```

**素の `wails3 update build-assets` を叩いてはいけない** — フラグが無いと全項目がテンプレート既定値で上書きされ、`windows/wails.exe.manifest` の `com.github.secondarykey.tempoc.desktop`（`productIdentifier` 由来）も失われる。

**`build/windows/msix/` だけは例外で、`wails3 init` 時にしか生成されず update でも再生成されない**（＝手で直すと恒久的に残る一方、`config.yml` や `APP_NAME` を変えても自動追従しない）。`app_manifest.xml` / `template.xml` の表示名・exe 名・`Version="0.1.0.0"` は手で同期させてある。**バージョン番号は `_cmd/version.go` の同期対象外なので、MSIX で配布するなら bump のたびに手で直すこと**。現状の既定パッケージ形式は NSIS（`wails3 task windows:package`）で MSIX は使っていない。

exe への焼き込みは `wails3 generate syso`（`windows:build` タスクが毎回実行）→ `.syso` を go build がリンク、という順で起こる。したがって `config.yml` を直しただけでは何も変わらず、`update build-assets` → 再ビルドまでやって初めて反映される。

### リリース（自動。タグは手で打たない）

2本のワークフローが直列に動く。**通常運用で必要なのは main に push することだけ**:

1. `versionup-desktop.yml` — `desktop/**` を触る push で起動。次バージョンを決めて `go run ./_cmd/version.go` + `wails3 task common:update:build-assets` を実行し、bump を PR 経由で main にマージして `desktop-v<version>` タグを打つ
2. `release-desktop.yml` — そのタグで起動。`verify`（タグ/version/info.json 一致チェック）→ `build`（`windows-latest` / `macos-15` / `ubuntu-latest` のマトリクスで各 OS ネイティブビルド）→ `release`（3成果物を1つの **draft** リリースへ添付）。成果物は Windows=`tempoc-desktop-<version>-windows-amd64.zip`（`windows:build` の `tempoc.exe`）、macOS=`…-darwin-arm64.zip`（`darwin:package` の `.app` を ditto 圧縮。`macos-15`=Apple Silicon のネイティブ arm64。Intel は非対応 — universal 化するなら amd64 の CGO クロスが要る）、Linux=`…-linux-amd64.tar.gz`（`linux:build` の裸バイナリ）。**macOS ランナーは `macos-15` 固定**（`macos-latest`=macos-26 は `generate:icons` の `actool` がクラッシュ。skill pitfalls #11）。Linux ビルドは `WAILS_LINUX_DEPS`（GTK4/WebKitGTK）が必要

⚠️ **傍受は WebView2 固有**（`window.chrome.webview`）のため、macOS(WKWebView)/Linux(WebKitGTK) バイナリは起動・表示はできても **claude.ai の使用量ブリッジが動かず使用量が出ない**。現状これらはクロスプラットフォームでビルドを緑に保つ土台・ブリッジ移植の起点として配布している（`inject.js` の page→Go 送信を各 WebView 用に移植すれば機能する）。**移植の担当セッション向けガイドは [`multios.md`](multios.md)**（WebView2 固有の3点・調査項目・抽象化方針）。

次バージョンの決め方は拡張と同じ規則: **`desktop/version` の値が未タグならその値をそのまま使い、タグ済みなら patch を上げる**。したがって **minor/major を上げたいときは `go run ./_cmd/version.go 0.2.0` して commit するだけでよい**（CI はその値を尊重してリリースする）。CI が bump する場合、生成アセットも一緒にコミットされる。

CLI のバージョンは `.github/variables` の `WAILS_VERSION` に固定。**`go.mod` の `wails/v3` と一致させること**（CLI が bindings と .syso を生成するため、alpha 間のズレは壊れる）。

⚠️ **Linux で wails/v3 を import する物をコンパイルするには GTK4/WebKitGTK の開発パッケージが要る**。`internal/operatingsystem` が `#cgo linux pkg-config: gtk4 webkitgtk-6.0` を宣言しているため、**GUI をビルドしない `versionup-desktop` でも `go install .../cmd/wails3` の時点で失敗する**（`Package gtk4 was not found`）。パッケージ名は `.github/variables` の `WAILS_LINUX_DEPS` に `WAILS_VERSION` と並べて置いてある — **この2つは常にセットで更新すること**。alpha.84 で既定が GTK3/WebKit2（`libgtk-3-dev` / `webkit2gtk-4.1-dev`）から GTK4/WebKitGTK 6.0 に変わった前例がある（`.claude/skills/wails3/references/pitfalls.md` の 6）。

release 側の先頭には **タグ / `desktop/version` / `build/windows/info.json` の3者一致チェック**がある。exe のバージョンはタグではなく `info.json`（`config.yml` 由来）から焼かれるため、手で bump して `update build-assets` を忘れると中身が旧版のまま配布されうる。ズレていれば直し方を示してツールチェイン導入前に落ちる。

### ⚠️ exe のバージョン情報の確認方法

wails3 の syso はバージョンリソースを**言語ニュートラル（`0000`）**で埋め込む。このため .NET 経由（`(Get-Item x.exe).VersionInfo` / `[System.Diagnostics.FileVersionInfo]`）では**文字列が全て空に見えるが、壊れているわけではない**（FixedFileInfo の `FileMajorPart` 等だけは読める）。エクスプローラ・タスクバーが使うシェルプロパティでは正しく読めるので、検証はシェル経由で行う:

```powershell
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace("<絶対パス>\desktop\bin")
$item = $folder.ParseName("tempoc.exe")
$folder.GetDetailsOf($item, 34)   # File description
$folder.GetDetailsOf($item, 306)  # Product version
```

さらに Windows は FileDescription を exe のフルパス単位でキャッシュする（MuiCache / PCA）ため、更新しても古い表示名が残る。詳細と対処は `.claude/skills/wails3/references/pitfalls.md` の 14 を参照。

## 既知の制約・注意

- **`ExecJS` は傍受ウィンドウ（claude.ai）では使えない**（`runtimeLoaded` が立たない）。ページへの注入は document-created 方式のみ
- そのため `refreshInterval` の変更は次回起動時に反映
- DOM セレクタ依存の脆さは無い（自前 DOM を描画するため）が、傍受は使用量 API のパス・レスポンス形状に依存する
- 完全透明時は背景次第で文字が読みづらくなることがある
