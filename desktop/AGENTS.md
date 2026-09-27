# desktop/AGENTS.md

TEMPOC のデスクトップ版（Wails v3）。Chrome 拡張（`chrome-extension/src/`。[`../chrome-extension/AGENTS.md`](../chrome-extension/AGENTS.md)）と同じ「claude.ai の使用量 API を傍受して 5時間 / 7日ウィンドウの進捗を表示する」機能を、スタンドアロンのデスクトップアプリとして提供する。

- Wails: `github.com/wailsapp/wails/v3` beta.16（Go 1.27）
- Go module 名: `changeme`（テンプレート既定のまま。変更していない）
- フロント: React + Vite + TypeScript、`@wailsio/runtime`
- 対象プラットフォーム: Windows（WebView2）/ macOS（WKWebView）/ Linux（WebKitGTK）。OS 差の実装メモは [`multios.md`](multios.md)
- Wails 全般の作法は `wails3` skill（リポジトリ外の資料）を参照

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
| `cookies_linux.go` / `cookies_other.go` | **Linux のみ**: WebKitGTK の cookie 保存先を `~/.config/TEMPOC/cookies.sqlite` に指定する cgo（`enableCookiePersistence()`）。Wails がこれを呼ばないため、無いと再起動のたびに claude.ai のログインが消える。Windows/macOS 版は no-op（下記「cookie の永続化」） |
| `settings/settings.go` | 設定モデル（`Settings` 構造体 + `Default()`）。Wails 非依存 |
| `settings/paths.go` | `ConfigDir()`（`os.UserConfigDir()/TEMPOC`）。永続化するファイルの置き場を一本化 |
| `settings/repository.go` | 設定の永続化（`ConfigDir()/settings.json`） |
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

`inject.js` から `sendToHost()` 経由で `postMessage(JSON.stringify(...))`（口は OS で違う。下記「マルチ OS」）。Go 側は `application.Options.RawMessageHandler(window, message, originInfo)` で受信（`wails:` で始まらない全メッセージが届く）。`originInfo.Origin` に `claude.ai` が含まれるか検証してから処理する。

postMessage の `type` で分岐:
- `usage` — `seven_day`/`five_hour`/`weekly_scoped` を `app.Event.Emit("tempoc:usage", ...)` でフロントへ。以後 `Events.On("tempoc:usage")` で受信
- `location` — href 変化時に送信。Go が傍受ウィンドウのネイティブタイトルに URL を反映（`SetTitle`）。これだけは claude.ai 以外のオリジンからも受け付ける（OAuth 中は accounts.google.com 等にいるため）。ただし**報告 URL がメッセージの実オリジン（`originInfo.Origin`）で始まる場合のみ**反映 — ページは自分の URL しかタイトルに出せない
- `auth-required` — 未認証を検知（`/login` にいる、または API が 401/403 を返した）→ `app.Event.Emit("tempoc:auth-required")` でフロントへ通知。フロントは usage データが残っていてもログイン前表示（「Log in to Claude」ボタン）に戻し、クリックで `Events.Emit('tempoc:login')` → Go が傍受ウィンドウを表示する（勝手には出さない）。このとき `/login` 以外の古い SPA 画面のままなら ExecJS で usage URL へ読み込み直し、claude.ai にログインページへ誘導させる
- `fetch-error` — **claude.ai が落ちている/読めなかった**ことの通知（下記「取得失敗の扱い」）→ `app.Event.Emit("tempoc:fetch-error", {msg})`。`auth-required` とは別物（ログインし直しても直らない）なので傍受ウィンドウは出さない
- `debug` — ログ出力用

### マルチ OS

`inject.js` の page→Go 送信は WebView ごとに口が違う（Windows=`window.chrome.webview` / macOS・Linux=`window.webkit.messageHandlers.external`）。`sendToHost()` が実行時に検出して切り替える（**WebView2 を先に判定するので Windows は無変更**）。受信・`wails:` ルーティング・`ExecJS` の `runtimeLoaded` ゲートは Wails の共通コードなので **Go 側は無改修**。⚠️ ただし **macOS は注入が document-END**（`options.JS` が `WebViewDidFinishNavigation` で `execJS` される）で Windows の document-START と異なり、初回の usage リクエストを取り逃しうる（能動取得 `__tempocRefetch` で埋める想定）。詳細・調査根拠・実機確認の観点は **[`multios.md`](multios.md)**。mac/Linux の実機確認は未了。

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
- `extra_usage` — トップレベル。claude.ai の **Usage credits**（プラン上限到達後の従量課金）。他のウィンドウと**形が違う**ので `normalizeCredits()` で別扱いにする:
  - フィールドは `is_enabled` / `monthly_limit`（月額上限）/ `used_credits`（消費額）/ `utilization` / `currency` / `decimal_places`
  - **金額は通貨の最小単位の整数**。実額は `decimal_places` で割る（`5000` + `2` → $50.00）
  - **`resets_at` が無い**（レスポンス全体で `resets_at` を持つのは `five_hour` / `seven_day` / `limits[]` だけ）。claude.ai 自身の UI も "Resets Aug 1" としか出さない。よってリセット時刻は**フロントで UTC 月初として合成**する（App.tsx の `nextUtcMonthStart()`）
  - **`utilization` は実測で常に null**。使用率は `used_credits / monthly_limit` から自前計算する（API が値を入れてきたらそちらを優先）
  - 残高・プロモクレジット（claude.ai の "Current balance"）は**このAPIには無い**。`/api/organizations/{id}/prepaid/credits` と `/overage_credit_grant` という別エンドポイントなので、表示したくなったら傍受対象を増やす必要がある（サイトの更新ボタンでは再取得されず、モーダルを開いた時だけ飛ぶ点にも注意）

### 自動再取得（refreshInterval）

`inject.js` 内で `setInterval(__tempocClickRefresh, ms)`。`ms` は Go が起動時に `settings.RefreshInterval*60000` を `__TEMPOC_REFRESH_MS__` プレースホルダへ文字列置換して埋め込む。**傍受スクリプトは傍受ウィンドウに再注入できない**（上記 ExecJS の制約）ため、`refreshInterval` の変更は**次回起動時**に反映される。

繰り返しの再取得は API 直叩き（`__tempocRefetch`）ではなく、**サイト自身の更新ボタンをクリック**する `__tempocClickRefresh` を使う（下記「手動更新」と同じ経路）。ボタンは `findRefreshButton()` が **モーダル（`[role="dialog"]`）内の `aria-label="Refresh"`（または「更新」）** で構造的に探す — React の自動生成 ID（`_r_bb_` → `_r_h7_` と実際に変わった）には依存しない（旧 ID は最後の保険としてのみ参照）。通常利用と同じリクエストになり、ヘッダ/CSRF/エンドポイントの正しさをサイトに委ねられるため。**API 直叩きは極力使わない**方針: ボタンが無い場合、まず「usage モーダルが開いていない（SPA 遷移でハッシュ喪失）」を疑い、claude.ai 上でハッシュが `#settings/usage` でなければ **usage URL を開き直してモーダルを復元**する（リロード後の初回取得がデータを届け、以後はボタンが押せる）。ハッシュが正しいのにボタンが無い（ID 変更等）ときだけ `__tempocRefetch` にフォールバック — この分岐が再リロードしないことでリロードループを防ぐ。ただし**初回だけ**は、まだ更新ボタンが DOM に無い可能性が高いので `__tempocRefetch` の直叩き（下記「初回取得のリトライ」）。また **`/login` 上では `__tempocClickRefresh` は何もしない** — モーダル復元リロードが走るとログイン入力中のユーザーの画面が消えるため（ログイン完了後の復帰は watchAuthTransition が担う）。

### 取得失敗の扱い（`fetch-error`）

Claude 側の障害（5xx・レート制限・HTML のエラーページ・ネットワーク断）は**未認証とは別の失敗**として扱う。原則は2つ:

1. **失敗を成功として post しない**。以前は `handleUsageResponse` がステータスを見ずに本文を JSON として解釈していたため、障害時のエラー JSON（`{"error": ...}` や 200 のエラー応答）でも `usage` が飛び、全ウィンドウ `undefined` のペイロードがフロントに届いていた。フロントは `utilization ?? 0` / `resets_at` 無しで描くので、**全バーが 0% にリセットされたように見える**（障害がリセット直後の画面と区別できない）。よって inject.js は次をすべて `postFetchError()` に落とす: 使用量 API の非 2xx（401/403 を除く）/ JSON でない応答 / `five_hour` も `seven_day` も含まない応答 / `__tempocRefetch` の `catch`。**空の usage を post する経路を作らないこと。**
2. **最後に取れた値は消さない**。フロントは `tempoc:fetch-error` を受けても `usage` / `lastUpdated` を触らず、コンテンツ領域を覆う**モーダル**（`.error-modal-backdrop`、文言 + 中央の再取得ボタン。`t.fetchError` / `t.retry`）を被せるだけ。古い値を現在値と読み違えさせないのがモーダルの役目で、タイトルバーの「〜に更新」が古いままになることと合わせて「止まっている」ことが伝わる。モーダルは次に `usage` が届いた時点で自動的に消える。データがまだ一度も無い場合も同じモーダル（下は待機プレースホルダのまま）。再取得ボタンは手動更新と同じ `tempoc:refresh`。

   モーダルはタイトルバーの下（`top: var(--titlebar-h)`）から始める — 覆っている間もウィンドウの移動・ピン・クローズができるようにするため。再取得を押している間は `retrying` でボタンを無効化し、`usage` か次の `fetch-error` が届く（届かなければ 15 秒で）まで待機表示にする。押しても同じエラーが再報告されるだけだと画面が変わらず、ボタンが死んで見えるため。

`postFetchError()` は **claude.ai（と hostname 空のナビゲーション失敗ページ）以外では黙る** — OAuth 中の accounts.google.com 上でも相対 URL の取得は走り、そこでの失敗は Claude の障害ではないため。Go 側の origin ゲートも同じ理由で `fetch-error` に限り空/`null` オリジンを通す（到達できないときはエラーページのオリジンになり得るため）。

エラー帯は `.usage-bars` の**内側**に置く。ウィンドウ高はこのコンテナの実測値（`measureRef`）で決まるので、外に出すと帯のぶんだけ見切れる。

### 初回取得のリトライ（`refetchWithRetry`）

初回の能動取得は `setTimeout` で 1.5 秒待ってから `__tempocRefetch` を叩くが、**1回では足りない**。ページがまだ出来ていない・一時的なネットワークエラーで取り逃すと、次に何かが動くのは自動更新（既定5分）で、しかもそれはモーダル内の更新ボタンを押す経路なので**モーダルが開いていなければ空振り**し、フロントは「使用量を待っています」のまま無反応になる。

そこで `refetchWithRetry(attempt)` が **1.5s → 3s → 6s → 12s** の順に間隔を伸ばして再試行する。打ち切りは2つだけ:

- **取得成功**
- **未認証が確定**（何度叩いても同じ。ログイン完了の検知と再取得は `watchAuthTransition` の担当）

一時障害（`__tempocRefetch` の `catch`）だけがリトライに値する、という区別が肝。`__tempocRefetch` は**成否の boolean しか返さない**契約（Go 側・ExecJS 経路もこれを前提にしている）ので理由を返り値には載せられない。代わりに **`postAuthRequired()` を通した回数（`authSignals`）を呼び出し前後で比べて**「未認証だったのか」を判定する。**`auth-required` の post は必ず `postAuthRequired()` 経由にすること** — 直接 `post({type:"auth-required"})` を書くとこのカウンタから漏れ、ログイン前なのにリトライし続ける。

ログイン完了時（`watchAuthTransition` の `/login` から出た経路）も同じ `refetchWithRetry` を使う。挙動は `inject.test.mjs` が `setTimeout` を差し替えて固定している（バックオフの間隔・403 で止まること・打ち切ること）。

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

## cookie の永続化（ログインの保持）

claude.ai のログインは傍受ウィンドウの cookie に載っているので、これが消えると毎回ログインし直しになる。**Windows/macOS は WebView が勝手に永続化する**（WebView2 は `%APPDATA%\tempoc\EBWebView`）が、**Linux は自前で面倒を見る必要がある**:

- Wails の Linux 実装は `webkit_network_session_get_default()` を取るだけで **`webkit_cookie_manager_set_persistent_storage()` を呼んでいない**（beta.16 の `linux_cgo.go:1241` 付近）。WebKitGTK は保存先ファイルの指定が無いと cookie をメモリにしか置かないため、**実機 Ubuntu で「再起動のたびにログインが必要」が発生していた**
- `LinuxOptions` にレバーは無く、環境変数でも有効化できない。**端末側の設定では直せない**
- そこで `cookies_linux.go` が同じデフォルトセッション（プロセス共通のシングルトン。Wails は webview 生成時に `network-session` を渡さないので全ウィンドウがこれを使う）を cgo で取り、`ConfigDir()/cookies.sqlite` を保存先に指定する

⚠️ **`enableCookiePersistence()` は `app.Run()` より前に呼ぶこと**（`main.go` の末尾）。Wails はネイティブ webview を GTK ループ開始後に作るので、`Run()` 前なら傍受ウィンドウの最初のリクエストより確実に早い。後から指定すると、ディスクに有効な cookie があるのに初回ロードが空のまま飛んで `/login` に落ちる。gtk_init 前になるが `WebKitNetworkSession` は GTK ウィジェットに触らないので問題ない（ヘッドレスでの実測は [`multios.md`](multios.md) の「既知の制約」3）。

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

バー本体は「塗り＝使用率」「白い縦マーカー＝時間経過率」。レイアウト・ツールチップ・数値の表記・ウィンドウ高さの詳細は [`_docs/ui.md`](_docs/ui.md)。

色分けロジックは Chrome 拡張の `content.js` `redraw()` を厳密移植（`computeColor()` / `pickCfg()` に切り出し）。**拡張と挙動を揃えること**:

```
colorEnabled=false                                   → accent
util >= utilizationDanger                            → danger
diff = util - elapsed
  diff > danger                                      → danger
  diff > warning || util >= utilizationWarning       → warning
  otherwise                                          → accent
```
色: accent `#7dd3fc` / warning `#fbbf24` / danger `#ef4444`。

- **weekly_scoped は `seven_day` カードの副バー**としてネストする。リセット時刻・経過・残り時間が同じで、違うのはラベルと使用率だけのため
- **Usage credits のリセットは UTC 月初**としてフロントで合成する（API に `resets_at` が無い。上記「対象 API」）。使用率も `used_credits / monthly_limit` から自前計算
- 表示条件は `settings.showCredits && monthly_limit != null`（**既定は非表示**）。`creditsOnlyWhenNeeded` は `five_hour` か `seven_day` が 100% のときだけ出す — **weekly_scoped は数えない**（週ウィンドウの内訳であって、単独でクレジット消費に落ちる上限ではないため）
- ウィンドウの高さはコンテンツの実測で決まる。バーと一緒に出す要素は `.usage-bars` の内側に置く
## 設定（Chrome 拡張から移植 + 追加）

`settings/settings.go` の `Settings`。永続化先は `%APPDATA%\TEMPOC\settings.json`（`os.UserConfigDir()`）。メインウィンドウは起動時に `SettingsService.Get()` で読み込み、`MainWindow` の state に保持して `UsageBar` に渡す。

設定編集は独立した設定ウィンドウ（メインとは別 JS コンテキストのため state を共有できない）が担い、**ドラフト方式**で保存する:

- 設定ウィンドウはマウント時 + `tempoc:open-settings` 受信時に `SettingsService.Get()` でドラフトを読み込む（`updateDraft` は state 更新のみで保存はしない）
- Apply（`SettingsWindow.tsx` の `apply()`）は、保存直前にもう一度 `Get()` して `alwaysOnTop` だけ現在値を採用しドラフトへ上書き（メインのピンボタンがドラフト外で唯一即時保存する項目のため、古いドラフトで巻き戻さないための対策）→ `SettingsService.Set()` → `Events.Emit('tempoc:settings-applied')`
- メインウィンドウは `tempoc:settings-applied` を購読して `SettingsService.Get()` で再読込するだけ（値をイベントペイロードに乗せない）。これにより既存の transparent / alwaysOnTop / sizeMode 用 `useEffect` がそのまま適用処理として機能する
- 閉じる（✕ / Close ボタン）は未適用の変更を確認なしで破棄する。`Window.Close()` は close フックで `Hide()` に置き換えられ実際には破棄されない（傍受ウィンドウの close フックと同型）ため、次に `tempoc:open-settings` で開いたときにドラフトが保存値へ再読込されることで「破棄」が成立する

**前提**: Wails beta.16 ではフロントから発行した `Events.Emit` は Go 側リスナーと（発行元を含む）全ウィンドウの両方に配信される。設定ウィンドウ↔メインウィンドウの通知に Go 中継コードは不要。

イベント: `tempoc:open-settings`（メインの歯車 → Go が設定ウィンドウを `Show()`、設定ウィンドウ front はドラフト再読込）/ `tempoc:settings-applied`（設定ウィンドウの Apply → メインが `Get()` で再読込）/ `tempoc:quit`（メインの ✕ → Go が位置保存してから終了）。

キーの一覧と既定値は [`_docs/ui.md`](_docs/ui.md) の「設定キー一覧」（定義の正は `settings/settings.go`）。拡張と同名のキーは意味も揃えてある。

**API に無いウィンドウのセクションは「消さずに無効化」する**。weekly_scoped（出たり消えたりする）と extra_usage（クレジット未設定なら来ない）は欠けうるが、セクションは常に描画し、データが無いときだけ `settings-section--disabled`（淡色化）+ 全コントロール `disabled` + 見出し下に `sectionUnavailable` の一文を出す。消してしまうと設定一覧の並びが動き、保存済みの設定ごと無くなったように見えるため — 値は保存されたままで、データが戻れば即座に効く。判定は `hasWeeklyScoped` / `hasCredits` prop（設定ウィンドウ自身も `tempoc:usage` を購読して導出。`monthly_limit != null` かどうか等）で、**設定値ではなくデータの有無だけ**で決まる。なお**バー本体（メインウィンドウ）は従来どおりデータが無ければ描かない**（無効化ではなく非表示）。設定ウィンドウは常に不透明（`BackgroundColour` を不透明固定・`is-transparent` クラスを付けない）— `transparent` 設定はメインウィンドウの表示にのみ適用される。

### 設定を追加する手順

1. `settings/settings.go` の `Settings` にフィールド追加（+ 必要なら `Default()`）
2. `desktop/` で `wails3 generate bindings -ts`（`frontend/bindings/changeme/settings/` が再生成される）
3. `SettingsWindow.tsx` の `SettingsView` に UI を追加し、`App.tsx`（`UsageBar` などの描画側）へ反映
4. [`_docs/ui.md`](_docs/ui.md) の「設定キー一覧」に行を足す

## 国際化（i18n）

UI 文言と日時・残り時間の表記をロケール対応にする仕組み。メイン・設定ウィンドウの両方が使う。

### 構成

| 要素 | 役割 |
|---|---|
| `frontend/src/locales/<code>.json` | **翻訳文字列の実体**。ロケールごとに1ファイル（`en-US.json` / `ja-JP.json` など）。UI ロジックからは分離されている。**ルート `locales/`（マスター）の同期コピーなので直接編集しない** — ルートを編集して `python3 scripts/sync_locales.py` を実行する（[`../AGENTS.md`](../AGENTS.md) の Shared locale resources 参照） |
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

### 言語・文言キーの追加

手順は [`../docs/i18n.md`](../docs/i18n.md)。`RawMessages` には**デスクトップが使うキーだけ**を列挙する（拡張だけが使うキーは足さない）。

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
- **`wails3 dev` にアプリ引数を渡すには環境変数 `TEMPOC_ARGS`**:

  ```bash
  TEMPOC_ARGS="-log debug" wails3 dev     # wails3 task run でも同じ
  ```

  dev は `build/config.yml` の `dev_mode.executes`（`type: primary`）にある **`wails3 task run` 経由でアプリを起動**し、そのコマンドラインは固定で拡張できない。そこで各 OS の `run` タスク（`build/<os>/Taskfile.yml`）の起動行末尾に `$TEMPOC_ARGS` を付けてある — **タスク変数ではなく環境変数**なのは、dev から渡す唯一の経路がこれだから（`wails3 task` の CLI_ARGS 非対応は [`_docs/release.md`](_docs/release.md) の macOS 署名の項も参照）。未設定なら空に展開されるだけ。ログの出力先は起動時のカレントなので、dev では `desktop/YYYY-MM-DD.log` に出る
- バインディングの import パスはパッケージパス基準: `import { SettingsService } from '../bindings/changeme'`、`Settings` 型は `../bindings/changeme/settings`
- **実機検証**（ビルドした exe を CDP で駆動し、画面操作なしで DOM・ウィンドウ状態を確かめる）の手順は [`_docs/verify.md`](_docs/verify.md)

## バージョン管理・リリース

詳細（各項目の理由・経緯・手順）は [`_docs/release.md`](_docs/release.md)。ビルド設定・アセット・リリースを触る前に読むこと。常に守る制約だけをここに置く:

- バージョンの**唯一の正は `desktop/version`**。`build/config.yml` の `info.version` と `frontend/package.json` の `version` は写しなので手で編集しない — 同期は `go run ./_cmd/version.go`（`desktop/` から）
- リリースの流れ（自動・タグは手で打たない）は拡張と共通で、ルートの [`../AGENTS.md`](../AGENTS.md) の Versioning にある。minor/major は `go run ./_cmd/version.go 0.3.0` して commit する
- ビルドアセットの再生成は**必ず `wails3 task common:update:build-assets`**。素の `wails3 update build-assets` はテンプレート既定値で全項目を上書きする
- `config.yml` を直しただけでは exe に反映されない（update build-assets → 再ビルドが要る）。`APP_NAME` の変更は WebView2 のユーザーデータフォルダも変える（ログインが引き継がれない）
- `build/Taskfile.yml` の `generate:icons` に `-iconcomposerinput` / `-macassetdir` を戻さない（macOS で Wails ロゴが出る）
- `build/darwin/Taskfile.yml` の `rm -rf`（バンドル作り直し）と `xattr -cr` を消さない（2回目以降の codesign が落ちて起動しなくなる）
- `.github/variables` の `WAILS_VERSION` は `go.mod` の `wails/v3` と一致させ、`WAILS_LINUX_DEPS` とは常にセットで更新する
- macOS で「壊れているため開けません」が出たら、バイナリではなく署名（ad-hoc / notarize 漏れ）を疑う
- exe のバージョン情報は .NET の `VersionInfo` では空に見える（言語ニュートラル埋め込み）。確認はシェルプロパティ経由

## 既知の制約・注意

- **`ExecJS` は傍受ウィンドウ（claude.ai）では使えない**（`runtimeLoaded` が立たない）。ページへの注入は document-created 方式のみ
- そのため `refreshInterval` の変更は次回起動時に反映
- DOM セレクタ依存の脆さは無い（自前 DOM を描画するため）が、傍受は使用量 API のパス・レスポンス形状に依存する
- 完全透明時は背景次第で文字が読みづらくなることがある
