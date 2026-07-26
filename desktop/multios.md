# multios.md — 傍受の macOS / Linux 対応

> TEMPOC デスクトップ版の claude.ai 使用量傍受を Windows 以外でも動かすための
> 調査結果と実装メモ。前提は [`CLAUDE.md`](CLAUDE.md)（「使用量の傍受の仕組み」節）と
> `.claude/skills/wails3/references/external-page-automation.md`（Windows/WebView2 前提と明記）。

## ステータス

| プラットフォーム | ビルド | 傍受ブリッジ | 実機確認 |
|---|---|---|---|
| Windows (WebView2) | ✅ CI | ✅ 従来どおり（無変更） | ✅ 従来どおり |
| macOS (WKWebView) | ✅ CI (`macos-15`, arm64) | ✅ 実装済み | ✅ **確認済み**（`wails3 dev` で傍受・表示とも動作） |
| Linux (WebKitGTK) | ✅ CI + 実機ビルド | ✅ 実装済み（mac と同一経路） | ✅ **全機能確認済み**（実機 Ubuntu）。ビルド・描画・claude.ai ログイン・使用量表示・傍受すべて動作 |

Linux の傍受ブリッジは `window.webkit.messageHandlers.external` 経由で正しく機能する。**実機 Ubuntu でログインから使用量表示まで動作を確認済み**（ただし起動には下記「既知の制約」の 2 つ — 非特権 user namespace の有効化と `GSK_RENDERER=gl` — が要る）。WSL2 では claude.ai の Cloudflare 検査を通過できず使用量表示まで到達しなかったが、実機では問題なかった。

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

**それでも駄目なら WSL は諦める**。実際、WSL2 では claude.ai の Cloudflare 検査を通過できず使用量表示まで到達しなかった一方、**GPU の使える実機 Ubuntu では全機能が動いた**（要件は下記「起動要件・既知の制約」の 1・2）。描画が怪しい時点で実機に切り替えた方が早い。ここで粘っても TEMPOC 側の問題ではない。

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

## Linux の起動要件・既知の制約（実機で確認済み）

実機 Ubuntu で**全機能が動いた**が、素の状態では起動しない。次の 2 つが要る。

### 1. 🔴 非特権 user namespace を有効化する（無いとクラッシュ）

WebKitGTK は Web コンテンツを **bubblewrap（`bwrap`）サンドボックス**内で動かす。**Ubuntu 24.04 は
非特権 user namespace を AppArmor で既定オフにしている**ため、`bwrap` が uid map を作れず
サンドボックスが起動できない。すると WebProcess が立ち上がらず、Wails が起動時に呼ぶ
`webkit_web_view_evaluate_javascript`（`setResizable` の ExecJS）が死んだ WebProcess を叩いて
**SIGTRAP でプロセスごと落ちる**:

```
bwrap: setting up uid map: Permission denied
ERROR: Failed to fully launch dbus-proxy: 子プロセスがコード 1 で終了しました
SIGTRAP: trace trap  ... signal arrived during cgo execution
  → webkit_web_view_evaluate_javascript → setResizable → run (webview_window_linux.go)
```

⚠️ **この SIGTRAP スタックトレースに惑わされないこと。** クラッシュ地点は `evaluate_javascript`
だが**原因ではない**（死んだ WebProcess を叩いた結果）。真因は先頭 2 行の `bwrap` 失敗。

確認と対処:

```bash
unshare --user --map-root-user true && echo OK || echo BLOCKED   # BLOCKED なら該当
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0     # 一時的に有効化
# 恒久化:
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-tempoc-userns.conf
```

これは `wails3 dev` 固有ではなく**ビルド済みバイナリでも同じ**（実行時の WebProcess 起動で起きる）。
Wails 側はサンドボックスに触れていない（`linux_cgo.go` に sandbox 制御なし）ので、WebKitGTK の
既定挙動 × システムの userns 制限がぶつかっているだけ。**セキュリティ的には保護を 1 段下げる**
設定なので、開発機での検証用途と割り切ること。Chrome/Flatpak 等も同じ仕組みを使う。

🚫 **ラッパー sh（起動スクリプト）では回避できない。** これは環境変数ではなく
**カーネル/AppArmor の設定**で、変更に root（sudo）が要る。ユーザー権限で走る起動スクリプトからは
どうやっても変えられない。回避の道と、それぞれの難点:

| 方法 | 実現性 | 難点 |
|---|---|---|
| インストール後に一度だけ `sudo sysctl ...`（現方針） | ⭕ 確実 | ユーザーに手動作業が要る |
| `.deb` の postinstall（root で走る）で `sysctl.d` に書く | 技術的には可能 | **パッケージが勝手にシステムのセキュリティ設定を緩める**のは行儀が悪い。やるなら「設定を書き換える」のではなく「必要なコマンドを表示する」に留める |
| WebKit のサンドボックスを無効化 | ❌ 現状不可 | Wails がレバーを出しておらず（上記のとおり sandbox 制御なし）、この WebKitGTK バージョンに信頼できる無効化 env も無い。**Wails 本体へのコード改修が必要**になる |

補足: Ubuntu の `bwrap` は setuid 版ではなく userns 前提なので、そこからの回避も効かない。
また**この制限は Ubuntu 24.04+ / 一部 Debian 特有**で、userns を許可している他ディストロや
古い環境では最初から不要（＝全 Linux 一律の要件ではない）。

### 2. 🟡 `GSK_RENDERER=gl` を指定する（無いと画面が真っ白）

起動しても**ウィンドウが何も描画されない**ことがある。GTK4 の既定 GPU レンダラが古い/不完全な
ドライバ（実機は Intel Haswell、`MESA-INTEL: Haswell Vulkan support is incomplete`）で描画に
失敗するため。

実測では **`GSK_RENDERER=gl` で解決**した。意外なことに**ソフトウェアレンダラの
`GSK_RENDERER=cairo` では駄目**だった（cairo → 真っ白のまま、gl → 正常描画）。ハードウェアや
ドライバで最適値は変わるので、`gl` → `cairo` → `ngl` の順で試すとよい。

```bash
GSK_RENDERER=gl wails3 dev            # or ./bin/tempoc
```

これも環境変数だけで、TEMPOC のコード変更は不要。`GSK_RENDERER` は GTK4 自身が読む
（Wails は上書きしない。`GDK_BACKEND` だけは未設定時に x11 を入れる場合があるが GSK_RENDERER には触れない）。

⚠️ **ラッパー sh で `GSK_RENDERER=gl` を固定するのは非推奨。** 環境変数なので起動スクリプト
（`exec env GSK_RENDERER=gl tempoc "$@"`）で包むこと自体は可能だが、**最適なレンダラは
ハードウェア/ドライバ依存**で、全ユーザーに `gl` を強制すると**既定で問題なく描画できている環境を
こちらが壊す**恐れがある（今回の Haswell は「既定=✗ / cairo=✗ / gl=⭕」という特殊例で、新しめの
GPU は既定のままで動くことが多い）。「白画面か」をスクリプトが自動判定するのも事実上不可能なので、
**確実な自動選択はできない**。方針としては**既定では何も設定せず、白画面時の回避策として文書化する
だけ**にする（少数の古い GPU 環境だけ手動で `GSK_RENDERER` を設定してもらう）。どうしても固定するなら
`gl` は 4.14 以前の既定で互換性は比較的高いが、最適である保証はないと割り切ること。

> ⚠️ WSL2（GPU 無し・Mesa が d3d12 を初期化できず ZINK にフォールバックして失敗する環境）では、
> どのレンダラ設定でもまともに描画できず、claude.ai の Cloudflare 検査も通過できなかった
> （API が 403 を返し続ける。**この 403 を「未ログイン」と読み違えないこと** — 未ログインなら
> 通常 401 か空の 200 で、`__tempocRefetch` はその前提で分岐する）。**実機の GPU があれば問題なく
> ログイン・表示できる**ので、検証は GPU の使える実機で行うこと。ボット検査を迂回する小細工は
> しないこと（環境不足のシグナルとして扱う）。

### 3. cookie が永続化されない見込み（ログインが再起動で消える）

Wails の Linux 実装は `webkit_network_session_get_default()` を使うだけで、
**`webkit_cookie_manager_set_persistent_storage()` を呼んでいない**（`linux_cgo.go:1205` 付近）。
WebKitGTK は明示指定が無いと cookie を SQLite に永続化しないため、**アプリを再起動すると
claude.ai のログインが消える**と考えられる。

Windows は WebView2 のユーザーデータフォルダ（`%APPDATA%\tempoc\EBWebView`）に永続化されるので、
これは実質的な機能差。Linux 対応を進めるなら対処が要る（1 が解決して初めて表面化する課題）。

## Linux の配布・必要ライブラリ（現状 tar.gz / 将来 deb）

### 必要ライブラリの「正」はどこにあるか

Linux バイナリは**動的リンク**で、GTK4/WebKitGTK を**同梱しない**（`ldd bin/tempoc` で `libgtk-4.so.1`
`libwebkitgtk-6.0.so.4` 等がシステムの `/lib/x86_64-linux-gnu/...` を指す）。よって実行環境に
ランタイムが要る。**必要ライブラリの正は [`build/linux/nfpm/nfpm.yaml`](build/linux/nfpm/nfpm.yaml)
の `depends`**（ディストロ別に整備済み）:

| ディストロ | ランタイムパッケージ |
|---|---|
| Ubuntu 24.04+ / Debian 13+ | `libgtk-4-1` `libwebkitgtk-6.0-4` |
| Fedora / RHEL 系 | `gtk4` `webkitgtk6.0` |
| Arch | `gtk4` `webkitgtk-6.0` |

実際に何がリンクされているかは `ldd bin/tempoc` が一次情報。ユーザー向けの案内は
[`README.md`](README.md) の「Linux runtime requirements」に転記してある（README と nfpm.yaml が
食い違わないよう、変更時は両方直すこと）。ビルド時は `-dev` 付き（`WAILS_LINUX_DEPS`、
`.github/variables`）、実行時は `-dev` 無し、の対応も忘れない。

### 現状のリリース: tar.gz（裸バイナリ）

`release-desktop.yml` は Linux 成果物を **`…-linux-amd64.tar.gz`（`linux:build` の裸バイナリ）**
として出す。ライブラリは同梱されないので、**ユーザーが上表のランタイムを自分で入れる**前提。
加えて起動要件（userns / `GSK_RENDERER`）は tar.gz でも回避されない（上記「起動要件」参照）。

### 後日 deb 化する場合

Wails テンプレートに **deb/rpm/AppImage/AUR のパッケージ機構が既に用意されている**:

- `wails3 task linux:package` が **AppImage + deb + rpm + aur を一括生成**（個別タスクもある:
  `linux:create:deb` 等）。deb/rpm は nfpm、AppImage は linuxdeploy を使う。
- **deb/rpm（nfpm）は同梱ではなく依存宣言**。`.deb` 自体に GTK は入らないが、`nfpm.yaml` の
  `depends` により **`apt install ./tempoc.deb` で `libgtk-4-1`/`libwebkitgtk-6.0-4` が自動で入る**。
  Ubuntu 配布ならこれが一番素直（設定は完成済み。`version`/`arch`/`maintainer` は生成時に埋まる）。
- **AppImage は概ね同梱**（linuxdeploy が依存 `.so` をバンドル）。ただし ⚠️ WebKitGTK は本体 `.so`
  だけでなく別プロセス実行ファイル（`WebKitNetworkProcess`/`WebKitWebProcess`）や GStreamer/GIO
  モジュールも要り、素の linuxdeploy では取りこぼして実行時に落ちることがある（WebKit 用プラグインが
  要る場合あり）。加えて `build.sh` が linuxdeploy を **GitHub から wget** するので CI にネットワーク
  依存が増える。実機検証が要る。

⚠️ **パッケージ化しても userns と `GSK_RENDERER` は解決しない。** これらは同梱ライブラリの話ではなく
GPU ドライバ/カーネル設定の話なので、deb でも AppImage でも残る（deb の postinstall で userns を
書き換えるのは行儀が悪い＝「必要コマンドを表示」に留める。上記「起動要件 1」の表参照）。

**CI への組み込み方針（未実施）**: まず低リスクな **deb だけ** を `release-desktop.yml` の Linux レグに
足す（nfpm はネット不要・設定済み）。AppImage はネット wget と WebKit バンドルの検証コストがあるので
後回しが無難。tar.gz と deb の併存でよい。

## 関連

- [`CLAUDE.md`](CLAUDE.md) — 傍受設計の詳細
- [`inject.js`](inject.js) / [`inject.test.mjs`](inject.test.mjs) — 実装とテスト
- [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml) — 3 OS のビルド
- `.claude/skills/wails3/references/external-page-automation.md` — Windows 版3点セットの原典
