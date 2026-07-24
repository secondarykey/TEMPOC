# multios.md — 傍受の macOS / Linux 対応

> TEMPOC デスクトップ版の claude.ai 使用量傍受を Windows 以外でも動かすための
> 調査結果と実装メモ。前提は [`CLAUDE.md`](CLAUDE.md)（「使用量の傍受の仕組み」節）と
> `.claude/skills/wails3/references/external-page-automation.md`（Windows/WebView2 前提と明記）。

## ステータス

| プラットフォーム | ビルド | 傍受ブリッジ | 実機確認 |
|---|---|---|---|
| Windows (WebView2) | ✅ CI | ✅ 従来どおり（無変更） | ✅ 従来どおり |
| macOS (WKWebView) | ✅ CI (`macos-15`, arm64) | ✅ 実装済み | ✅ **確認済み**（`wails3 dev` で傍受・表示とも動作） |
| Linux (WebKitGTK) | ✅ CI + WSL2 実機ビルド | ✅ 実装済み（mac と同一経路） | 🟡 **ブリッジ実証済み・UI 表示確認済み**（WSL2/Ubuntu 24.04）。ログイン後の使用量表示は未確認 |

Linux の傍受ブリッジは WSL2 上で**ログにより実証済み**（`inject: fetch patched` → `wails:runtime:ready` → `refetch: unauthorized (403)` → `login required` が Go 側まで到達）。`window.webkit.messageHandlers.external` 経由の実装が正しく機能している。

実装は **`inject.js` の送信口の抽象化1点のみ**で、Go 側の変更は不要だった（理由は下記）。

## Wails alpha2.114 の調査結果（実コードで確認済み）

`WAILS_VERSION`（`.github/variables`）= `v3.0.0-alpha2.114` のソースを読んで確定した事実。
**alpha 更新で変わりうるので、上げたら再確認すること。**

### (1) ページ → Go の送信口：ハンドラ名は `external`

Wails は WKWebView / WebKitGTK の両方に **`external`** という名前のスクリプトメッセージ
ハンドラを登録している:

- macOS: `[userContentController addScriptMessageHandler:delegate name:@"external"]`
  （`pkg/application/webview_window_darwin.go:120`）
- Linux: `webkit_user_content_manager_register_script_message_handler(manager, "external", nil)`
  （`pkg/application/linux_cgo.go:1211`）

→ ページ側は **`window.webkit.messageHandlers.external.postMessage(payload)`**。
`didReceiveScriptMessage` は body が `NSString` ならそのまま使う（`webview_window_darwin.m:332`）ので、
**WebView2 と同じく文字列を渡せばよい**。JSON 化の仕方も含めペイロードは全 OS 共通。

### (2) 受信・ルーティング・ExecJS ゲートは「共通コード」

プラットフォーム分岐は無く、Windows と同じ経路を通る。**だから Go 側は無改修で済んだ**:

- `wails:` プレフィクスで内部処理と `RawMessageHandler` に振り分け → `application.go:775-780`
- `wails:runtime:ready` で `runtimeLoaded = true` → `webview_window.go:777-780`
- `ExecJS` は `runtimeLoaded` ゲート付き → `webview_window.go:610-615`

→ **ExecJS 解錠の生文字列ハンドシェイクは mac/Linux でも必要**。`inject.js` はこれも
同じ `sendToHost()` 経由で送るようにした。

### (3) `OriginInfo.Origin` は Windows も mac も「フル URL」

- macOS: `[url absoluteString]`（`webview_window_darwin.m:332` → `application_darwin.go:396-410`）
- Windows: WebView2 の `Source`（`webview_window_windows.go:2243`）

どちらもフル URL なので、`main.go` のオリジン検証（`strings.Contains(origin, "claude.ai")` と、
`location` の `strings.HasPrefix(msg.Msg, origin)` によるなりすまし防止）は**そのまま成立する**。
検証ロジックの変更は不要かつ**してはいけない**（セキュリティの要）。

### (4) ⚠️ 注入タイミングだけは Windows と違う（document-END）

ここが唯一の設計上の差分で、**要注意点**。

- **Windows**: `HTML` モード + `JS` → WebView2 の `AddScriptToExecuteOnDocumentCreated`。
  **document-START**（claude.ai 自身の JS より前）で走り、全ナビゲーションで永続。
- **macOS**: `options.JS` は document-start ユーザースクリプトとして登録**されない**。
  `WebViewDidFinishNavigation` のリスナ内で `execJS(options.JS)` されるだけ
  （`webview_window_darwin.go:1573-1576`）= **document-END**。

  ただし `OnWindowEvent` は永続リスナ（`webview_window.go:837-850`）で、
  `didFinishNavigation` は毎ナビゲーションで発火する（`webview_window_darwin.m:788`）ため、
  **bootstrap HTML → `location.replace` → claude.ai の遷移後にもきちんと再実行される**。

**影響**: claude.ai の JS が先に走るので、**サイト自身の初回 usage リクエストを
fetch パッチが取り逃す可能性がある**。ただし `inject.js` には元々
`setTimeout(window.__tempocRefetch, 1500)` の能動取得があり、再注入時も
`__tempocPatched` 分岐から `__tempocRefetch()` を呼ぶので、**初回データは能動取得で埋まる**想定。
以後の更新はサイトの更新ボタン経由（`__tempocClickRefresh`）で従来どおり。

→ もし実機で「初回に出ない／たまに出ない」なら、まずこのタイミング差を疑う。
document-start 注入が必要になったら、Wails に WKUserScript
（`WKUserScript(injectionTime: .atDocumentStart, forMainFrameOnly: false)`）対応を
入れる／パッチする方向になる。

## 実装内容

`inject.js` の送信口を feature detection で切り替えるだけ（[`inject.js`](inject.js) 冒頭の `sendToHost`）:

```js
function sendToHost(payload) {
  try {
    if (window.chrome && window.chrome.webview) {   // Windows: WebView2
      window.chrome.webview.postMessage(payload);
      return true;
    }
    var handlers = window.webkit && window.webkit.messageHandlers;
    if (handlers && handlers.external) {            // macOS / Linux: webkit
      handlers.external.postMessage(payload);
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}
```

- `post(obj)` は `sendToHost(JSON.stringify(obj))`、解錠ハンドシェイクは
  `sendToHost("wails:runtime:ready")`。
- **WebView2 を先に判定**しているので Windows の挙動は一切変わらない。
- fetch パッチ・`__tempocRefetch`・`findRefreshButton`・`watchAuthTransition`・
  アドレスバー等の監視ロジックは**全て無変更**（WebView 非依存）。

## テスト

`desktop/inject.test.mjs`（`node:test` + `node:vm`。**依存パッケージ無し**）:

```bash
cd desktop && node --test
```

`inject.js` を各プラットフォーム相当のスタブ環境（WebView2 のみ / webkit のみ / 両方 / どちらも無し）で
実行し、送信口の選択とペイロードを検証する。特に:

- **WebView2 優先**（両方ある場合に webkit を使わない）= Windows 無影響の担保
- 両環境で**ペイロード列が完全一致**すること（プロトコルが分岐しない担保）
- 生文字列 `wails:runtime:ready` が JSON 化されずに送られること

> 現状 CI では実行していない（frontend にテスト基盤が無く、この1ファイルだけ `node --test`）。
> 回帰検知したいならワークフローに `node --test` の1ステップを足すのが最小。

## 実機確認の観点（macOS / Linux）

1. claude.ai にログイン済みの状態で起動 → **使用量バーが出るか**（= `tempoc:usage` が届くか）。
2. 出ない場合の切り分け:
   - 傍受ウィンドウを表示（設定の Claude interceptor トグル）して Web Inspector で
     `window.webkit.messageHandlers.external` が存在するか、`__tempocPatched` が立っているか。
   - `-log debug` 付き起動で `inject.js` からの `debug` 中継（`slog.Debug`）を見る。
     ログは実行ディレクトリの `YYYY-MM-DD.log`（[`CLAUDE.md`](CLAUDE.md) のログ方針参照）。
   - `debug` は届くのに `usage` が来ない → 上記 (4) の注入タイミング差を疑う。
3. 手動更新ボタン（タイトルバー）が効くか = ExecJS 解錠が成立しているか。
4. ⚠️ 既存の検証レシピ `.claude/skills/tempoc-desktop-verify` は **WebView2 の CDP 前提**で
   mac/Linux には使えない。mac は Safari の Web Inspector、Linux は WebKitGTK inspector を使う。

## WSL2 で Linux 版を確認する手順（実施・検証済み）

Windows 機だけで Linux の UI + 傍受を確認する手順。**2026-07-24 に実際に通した内容**で、ビルド・UI 表示・傍受ブリッジまで到達している。

> ⚠️ **WSL は「Ubuntu のデスクトップ画面」を出さない。** WSLg は Linux の GUI アプリを個別の Windows ウィンドウとして表示する（シームレス統合）。ターミナルから GUI アプリを起動すると、ウィンドウが 1 枚 Windows 上に現れるのが正しい挙動。

### 1. WSL2 + Ubuntu 24.04

**24.04 必須**。GTK4 + WebKitGTK 6.0 が要る（22.04 は webkit2gtk-4.1 = GTK3 世代で `libwebkitgtk-6.0` が無い）。実測で `libgtk-4-dev` 4.14.5 / `libwebkitgtk-6.0-dev` 2.52.3 が入る。

```powershell
wsl --install                    # WSL 本体。要再起動
wsl --install -d Ubuntu-24.04    # 再起動後にディストロを明示指定して導入
```

⚠️ `wsl --install` は **WSL 本体だけ入れて再起動待ちになる**ことがある。再起動後に `wsl -l -v` で確認し、ディストロが無ければ上記 2 行目を実行する。ディストロ名は `Ubuntu` ではなく **`Ubuntu-24.04` を明示**すること（`Ubuntu` は将来 26.04 を指しうる）。

WSLg（GUI）は Windows 11 なら標準同梱。`wsl --version` に `WSLg バージョン` が出れば入っている。

### 2. リポジトリは WSL 側のファイルシステムに置く

⚠️ **`/mnt/d/...` の Windows 側で直接ビルドしない**。極端に遅く、パーミッションと inotify（`wails3 dev` のファイル監視）で問題が出る。WSL のホーム配下に clone すること。Windows 側 worktree の `node_modules` ジャンクションも WSL からは使えないので、`npm install` はやり直しになる。

```bash
git clone <repo> ~/TEMPOC && cd ~/TEMPOC
```

### 3. 依存パッケージとツールチェイン

パッケージ名は `.github/variables` の `WAILS_LINUX_DEPS` が正（CI と同一に保つこと）:

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libgtk-4-dev libwebkitgtk-6.0-dev
```

Go は **1.25 以上**（`desktop/go.mod`）、Node は **22**（CI と揃える）。apt の Go は古いことがあるので公式 tarball 推奨。wails3 CLI は**必ずピン留め版**を入れる（`go.mod` の wails/v3 と一致させる。ズレると bindings 生成が壊れる）:

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha2.114
export PATH="$PATH:$(go env GOPATH)/bin"
```

### 4. ビルドして起動

```bash
cd desktop
wails3 task linux:build     # bin/tempoc
./bin/tempoc
```

`wails3 dev` でもよいが、下記の環境変数を効かせたい／`-log debug` を渡したいので、**まずは直接起動**が切り分けやすい。

### 5. 🔥 ウィンドウが出ないとき：まず `wsl --shutdown`

**これが実際の原因だった。** WSLg のセッションは壊れた状態でスタックすることがあり、そうなると **GUI アプリが一切表示されなくなる**。厄介なのは、この状態が「それらしい別の原因」に見えるエラーを大量に出すこと:

```
libEGL warning: MESA-LOADER: failed to retrieve device information
MESA: error: ZINK: failed to choose pdev
libEGL warning: egl: failed to create dri2 screen
Fontconfig error: "/etc/fonts/fonts.conf", line 86: out of memory
```

GPU ドライバやフォント設定を疑いたくなるが**どれも真因ではない**（`/dev/dxg`・`/usr/lib/wsl/lib/libd3d12.so`・`d3d12_dri.so` は揃っており、`fc-list` も正常に 200 件超を返す）。

```powershell
wsl --shutdown     # Windows 側で実行。数十秒待ってから再度 wsl を起動する
```

これで復帰した。**ウィンドウが出ない＝まず WSL を再起動**、を最初に試すこと。

#### 切り分けは軽い順に（TEMPOC から始めない）

TEMPOC 固有の問題と決めつけないため、必ずこの順で確認する:

| コマンド | 意味 |
|---|---|
| `xeyes` | X11(XWayland) だけの極小アプリ。**出なければ WSLg 全滅** → `wsl --shutdown` |
| `gtk4-widget-factory` | 標準 GTK4 アプリ（`apt install gtk-4-examples`）。出なければ GTK4 側の問題で TEMPOC は無関係 |
| `~/run-tempoc.sh` | ここまで通って初めて TEMPOC を疑う |

実際、切り分け中に `gtk4-widget-factory` が TEMPOC と**全く同じ EGL/MESA エラー**を出したことで、TEMPOC 無罪がすぐ確定した。

#### レンダリング系の環境変数

WSLg 復帰後も描画が怪しい場合の保険。上記の壊れたセッションが原因のときは**これらを足しても直らない**ので、先に `wsl --shutdown` を試すこと。

```bash
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
```

⚠️ `GDK_BACKEND=x11` は**避ける**。XWayland 経由にすると WebKit の WebProcess が落ちてアプリごと終了した（`Error releasing name org.wails.tempoc.Sandboxed.WebProcess-...: The connection is closed`）。Wayland のままにすること。

**それでも駄目なら WSL は諦める**。実機 Linux か GPU の使える VM に切り替えた方が早い。ここで粘っても TEMPOC 側の問題ではない。

### 6. 傍受が動いているかの確認

UI が出たら:

1. claude.ai にログイン（傍受ウィンドウを表示して操作する必要がある）
2. **使用量バーが出れば成功**（= `tempoc:usage` が届いている）
3. 出ない場合は `-log debug` でログを取る（実行ディレクトリの `YYYY-MM-DD.log` に出る）:

```bash
./bin/tempoc -log debug
```

- `inject.js` からの `debug` 中継が出ていれば **ブリッジは生きている** → 使用量だけ来ないなら上記「注入タイミング（document-END）」を疑う
- `debug` すら出ないなら `window.webkit.messageHandlers.external` に届いていない → Wails のバージョン差を疑う

WebKitGTK には remote inspector があり `WEBKIT_INSPECTOR_SERVER=127.0.0.1:2999` で有効化できるが、**CDP ではなく WebKit 独自プロトコル**なので Chrome からは繋がらない（同じ WSL 内の Epiphany 等 WebKit 系ブラウザが要る）。`-log debug` の方が手軽。

### 7. Linux 固有の差分（トラブル時の容疑者）

Linux だけ `RegisterHook(events.Linux.WindowLoadFinished, ...)` で **Wails のランタイム core JS（`window._wails`）を全ページに注入**している（`webview_window_linux.go:382-389`）。Windows/macOS には無い挙動で claude.ai にも入る。基本無害だが、挙動差が出たらここを思い出すこと。

## 関連

- [`CLAUDE.md`](CLAUDE.md) — 傍受設計の詳細
- [`inject.js`](inject.js) / [`inject.test.mjs`](inject.test.mjs) — 実装とテスト
- [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml) — 3 OS のビルド
- `.claude/skills/wails3/references/external-page-automation.md` — Windows 版3点セットの原典
