# multios.md — 傍受を macOS / Linux で動かすための移植ガイド

> このファイルは、TEMPOC デスクトップ版の **claude.ai 使用量傍受を Windows 以外でも
> 機能させる**作業を担当するセッション向けのメモ。CI は既に mac(arm64)/Linux の
> ビルド成果物を出しているが（`.github/workflows/release-desktop.yml`）、**傍受ブリッジが
> WebView2 固有なので、それらのバイナリは起動しても使用量が表示されない**。
> このドキュメントは「なぜ動かないか」と「どこを直せば動くか」をまとめる。
>
> 前提知識は [`CLAUDE.md`](CLAUDE.md)（特に「使用量の傍受の仕組み」節）と、
> リポジトリの `.claude/skills/wails3/references/external-page-automation.md`
> （**Windows/WebView2 専用**と明記されている）を先に読むこと。

## 現状の到達点

- ✅ `release-desktop.yml` は `windows-latest` / `macos-15` / `ubuntu-latest` の
  マトリクスで各 OS ネイティブビルド → 3成果物を draft リリースへ添付する。
- ✅ mac/Linux でも **Go はコンパイルされ、ウィンドウは起動する**（自前 UI・設定・
  ウィンドウ状態などは動く見込み）。
- ❌ **claude.ai から使用量データが Go に届かない** → メインウィンドウは空のまま。
  原因は下記「WebView2 固有の3点」がいずれも `window.chrome.webview` 前提であること。

## 動かない理由：WebView2 固有の3点セット

傍受は「注入 → ページ→Go 送信 → Go→ページ実行」の3点が噛み合って初めて動く
（skill の `external-page-automation.md` の 1/2/3 に対応）。3点とも WebView2 固有 API に
依存している。

### (1) document-start でのスクリプト注入

- **現状**: `claude.win` を **HTML モード**で生成し（[`main.go:386-394`](main.go)、
  `HTML: claudeBootstrapHTML` + `JS: resolvedInjectJS`）、Wails が WebView2 の
  `AddScriptToExecuteOnDocumentCreated`（= `chromium.Init(script)`）として登録する。
  `claudeBootstrapHTML`（[`main.go:100`](main.go)）が `location.replace` で claude.ai へ
  遷移し、登録済みスクリプトが document-start で走る。
- **mac/Linux で確認すべきこと**: Wails v3 alpha が `WebviewWindowOptions.JS`（HTML モード）を
  **WKWebView / WebKitGTK でも document-start のユーザースクリプトとして登録するか**。
  - WKWebView 相当: `WKUserScript(injectionTime: .atDocumentStart, forMainFrameOnly: false)`
  - WebKitGTK 相当: `WebKitUserContentManager` に `webkit_user_script_new(... AT_DOCUMENT_START ...)`
  - Wails 側の実装は `pkg/application/webview_window_darwin.go` /
    `..._linux.go`（あるいは各プラットフォームの `webview_window_*` / `webkit` ラッパ）を
    grep して、`options.JS` / `options.HTML` がどう扱われるか確認する。**Windows だけ
    分岐して他は無視**なら、ここが第一の欠落。

### (2) ページ → Go の送信（最重要の欠落）

- **現状**: inject.js の `post()`（[`inject.js:2-10`](inject.js)）が
  `window.chrome.webview.postMessage(JSON.stringify(obj))` でホストへ送る。Go 側は
  `application.Options.RawMessageHandler`（[`main.go:266`](main.go)）で受信し、
  `originInfo.Origin` に `claude.ai` が含まれるか検証してから `usage` / `auth-required` /
  `location` / `debug` を処理する。
- **mac/Linux で `window.chrome.webview` は `undefined`** → `post()` は無言で no-op
  （`if (window.chrome && window.chrome.webview)` ガードで握り潰される）。**これが
  「使用量が出ない」直接の原因**。
- **確認すべきこと**:
  1. `RawMessageHandler` が mac/Linux でも **第三者ページ（Wails ランタイム非注入）からの
     メッセージを受け取るか**。受け取るなら、ページ側が呼ぶべき JS API 名は何か。
     - WKWebView: `window.webkit.messageHandlers.<name>.postMessage(...)`（`<name>` は
       Wails が登録するハンドラ名。Wails ソースで確認）
     - WebKitGTK: 同じく `window.webkit.messageHandlers.<name>.postMessage(...)`
  2. `OriginInfo.Origin` が mac/Linux でも埋まるか（オリジン検証が成立するか）。埋まらない
     場合は検証ロジックの代替が必要。

### (3) Go → ページ の実行（ExecJS）と runtimeLoaded 解錠

- **現状**: 手動更新（[`main.go:538`](main.go)）とログイン後の usage 再オープン
  （[`main.go:529`](main.go)）で `claude.win.ExecJS(...)` を使う。ExecJS は
  `runtimeLoaded == true` でしか実行されないが、claude.ai は Wails ハンドシェイクを
  送らない。そこで inject.js が document-start で **生文字列 `"wails:runtime:ready"` を
  `window.chrome.webview.postMessage`**（[`inject.js:30-36`](inject.js)）して解錠している。
- **mac/Linux で確認すべきこと**:
  - ExecJS 自体が各プラットフォームで実装されているか、その `runtimeLoaded` ゲートの
    有無・解錠方法。Windows と同じ生文字列トリックが効くのか、そもそもゲートが無いのか、
    別 API（例: WKWebView の `evaluateJavaScript`）に Wails がどうつないでいるか。
  - この (3) は自動更新（`__tempocClickRefresh`）・手動更新・ログイン後復帰に効く。
    最悪 (1)(2) だけ直せば **受動傍受（fetch パッチ）** は動くので、(3) は次段でよい。

## 推奨アプローチ：ブリッジを抽象化する

`inject.js` を WebView 実装に依存しない形にするのが本筋。プラットフォーム分岐を
**JS 側の feature detection に寄せ**、Go 側は受信ハンドラを各プラットフォームで
用意する。

1. **送信の抽象化（inject.js）**: `post()` を、利用可能なブリッジを実行時に選ぶ実装にする。
   ```js
   function hostPost(payload) {
     if (window.chrome && window.chrome.webview) {          // WebView2
       window.chrome.webview.postMessage(payload);
     } else if (window.webkit && window.webkit.messageHandlers
                && window.webkit.messageHandlers.<name>) {   // WKWebView / WebKitGTK
       window.webkit.messageHandlers.<name>.postMessage(payload);
     }
   }
   ```
   `<name>` と、JSON 文字列を渡すのか オブジェクトを渡すのかは **Wails の各プラットフォーム
   実装に合わせる**（WebView2 は文字列、webkit 系はオブジェクトのことが多い — 要確認）。
   `"wails:runtime:ready"` 解錠メッセージも同じ経路に通す（Windows 以外で不要／別手段なら
   分岐）。
2. **受信の確認（main.go）**: `RawMessageHandler` が全プラットフォームで発火するなら Go 側は
   ほぼ無改修でよい。発火しない／API が違うなら、プラットフォーム別のメッセージ受信を
   `_cmd`/`main` 側で吸収する（`internal/` に Wails を持ち込まない方針は維持）。
3. **注入の確認（main.go）**: (1) が Windows 限定なら、Wails のバージョンアップ待ち or
   Wails へパッチ、あるいは各プラットフォームのユーザースクリプト API を叩く薄い層を足す。

## 最初にやること（スパイク）

コードを書く前に、**Wails v3（`.github/variables` の `WAILS_VERSION` 固定版）の
mac/Linux 実装を読んで**次を確定させる。ここが不明なままだと設計が空回りする。

- [ ] `WebviewWindowOptions.JS`（HTML モード）は WKWebView / WebKitGTK で document-start
      注入になるか？（Wails ソースの該当プラットフォームファイルを grep）
- [ ] 第三者ページ→Go の受信経路（`RawMessageHandler` 発火の有無、JS 側 API 名、
      ペイロード型、`OriginInfo.Origin` の充足）
- [ ] `ExecJS` の `runtimeLoaded` ゲートは mac/Linux でどう振る舞うか（解錠要否）

まず最小確認として、claude.ai を載せる前に **極小 HTML + `JS:` で「document-start に走って
ホストへ1発 postMessage する」だけ**のスパイクを mac/Linux 実機（or CI）で回し、
`RawMessageHandler` にメッセージが届くかを見るのが速い。届けば (2) の API 名が判明する。

## 検証

- 受動傍受が動いたかは、claude.ai ログイン状態で起動し **`tempoc:usage` イベントが
  フロントに届く（使用量バーが出る）**ことで判定する。
- ⚠️ 既存の実機検証レシピ `.claude/skills/tempoc-desktop-verify` は **WebView2 の CDP
  リモートデバッグ前提**で、そのままでは mac/Linux に使えない。mac(WKWebView)/Linux
  (WebKitGTK) 向けの検証手段（Web Inspector / GTK の inspector 等）は別途必要。
- オリジン検証（`originInfo.Origin` の `claude.ai` チェック、`location` だけ他オリジン許可）は
  セキュリティ上の要なので、プラットフォームを跨いでも**必ず維持**する（[`main.go:277-292`](main.go)）。

## 影響を受けない（プラットフォーム非依存で流用できる）部分

- inject.js の DOM ロジック全般：fetch パッチ、`__tempocRefetch`、`findRefreshButton` /
  `__tempocClickRefresh`、`watchAuthTransition`、アドレスバーオーバーレイ、1秒ティック。
  **送受信の口（(2)(3)）だけ**が WebView2 依存で、中身の監視ロジックはそのまま使える。
- Go 側の使用量→フロント配信（`app.Event.Emit("tempoc:usage", ...)`）、設定、ウィンドウ状態、
  i18n、UI。これらは WebView 種別に依存しない。

## 関連

- [`CLAUDE.md`](CLAUDE.md) — 傍受設計の詳細（本ドキュメントの前提）
- `.claude/skills/wails3/references/external-page-automation.md` — Windows 版の3点セットの原典
  （mac/Linux は手段が異なると明記）
- [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml) — mac/Linux
  ビルドを出している CI。傍受が移植できたらこのドキュメントの前提（非機能）も更新すること
