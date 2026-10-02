---
name: tempoc-desktop-verify
description: TEMPOCデスクトップ版（Wails v3）の実機検証レシピ。ビルドしたexeをCDP（WebView2リモートデバッグ）で駆動し、画面操作なしにDOMクリック・状態観察・ネイティブウィンドウ可視性の確認を行う。デスクトップ版の変更を実際のアプリで確かめるときに使う。
---

# TEMPOC desktop の実機検証（CDP 駆動）

**Windows（WebView2）前提**。macOS/Linux での検証は `desktop/multios.md` を参照。パスはリポジトリのルートからの相対。

GUI アプリだが、スクリーン操作なしで検証できる。WebView2 のリモートデバッグポートを開け、
CDP の `Runtime.evaluate` で実 UI の DOM をクリック・観察する。

## 手順

1. **CDP ポートを一時的に開ける**（環境変数 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` は
   **Wails が意図的に無効化する**ため効かない — `webviewloader/native_module.go` の
   `preventEnvAndRegistryOverrides`）。`main.go` の `application.Options` に一時パッチ:

   ```go
   Windows: application.WindowsOptions{
       AdditionalBrowserArgs: []string{"--remote-debugging-port=9223"},
   },
   ```
   **検証後に必ず戻す**（コミット禁止）。

2. **ビルド & 起動**（dist が古ければ先に `cd frontend && npm run build`）:
   ```powershell
   cd desktop; go build -o bin/tempoc-verify.exe .
   Start-Process .\bin\tempoc-verify.exe -WorkingDirectory .\bin
   ```

3. **ターゲット列挙**: `http://127.0.0.1:9223/json/list`
   - メイン: `http://wails.localhost/`
   - 設定: `http://wails.localhost/?window=settings`
   - 傍受: `https://claude.ai/...`

4. **DOM 駆動**: Node 22+ ならグローバル `WebSocket` で足りる。
   `Runtime.evaluate`（`returnByValue: true`）で `document.querySelector(...).click()` や
   状態読み取り。URL 照合はメインと設定が前方一致で衝突するので完全一致で。

5. **ネイティブウィンドウの可視性**（Show/Hide の確認は DOM では見えない）:
   PowerShell + `EnumWindows`/`IsWindowVisible` P/Invoke で対象 PID のトップレベル
   ウィンドウを列挙する（タイトル: `TEMPOC` / `TEMPOC Settings` / `... TEMPOC interceptor`）。

## 落とし穴

- **settings.json はユーザーの実ファイル**（`%APPDATA%\TEMPOC\settings.json`、exe 名に
  依存しない）。検証で書き換わるので**必ずバックアップ→復元**する。
- WebView2 のユーザーデータフォルダは exe 名由来（`%APPDATA%\tempoc-verify.exe\EBWebView`）。
  別名 exe は claude.ai 未ログイン状態で起動する → auth-required 経路のスモークに使える。
  ログイン必要な検証（weekly_scoped 表示等）はこの方法ではできない。
- **settings.json を PowerShell で書き換えるときは BOM なしで書く**。PS 5.1 の `Out-File -Encoding utf8` は BOM を付け、Go の `json.Unmarshal` が `invalid character 'ï'` で失敗する → `Get()` が拒否されてフロントは既定値のまま（バーが1本も出ない）。`[System.IO.File]::WriteAllText($p, $json, (New-Object System.Text.UTF8Encoding($false)))` を使う
- **ログイン無しでバー描画を検証する**には、CDP からメインウィンドウに偽の usage を流す: `window._wails.dispatchWailsEvent({name:'tempoc:usage', data:{...}})`。傍受ウィンドウがログインページにいると `auth-required` が再発火して表示が戻るので、ディスパッチと DOM 読み取りは同じ `Runtime.evaluate` 内で続けて行う
- 前回の WebView2 ブラウザプロセスが残っていると新しい引数が無視される。
  exe kill 後 2〜3 秒待ってから再起動する。
- 検証後のクリーンアップ: main.go のパッチ除去・exe 削除・settings.json 復元。

## ウィンドウ移動・位置の検証

- 位置の読み取りは各ページで `window.screenX / screenY`（Frameless はクライアント領域＝ウィンドウ矩形なので Wails の `Position()` と一致。DIP、100% スケール環境で確認）。
- **CDP の `Browser.setWindowBounds` は使えない**: WebView2 では「ブラウザウィンドウ」が Wails ウィンドウ内の子ウィジェットを指すため、ネイティブウィンドウは動かず WebView が親の中でずれるだけ。
- ネイティブウィンドウを動かすには Win32 `SetWindowPos` を使う（P/Invoke。タイトル完全一致で EnumWindows → SetWindowPos）。
- `%APPDATA%\TEMPOC\windowstate.json` はウィンドウ位置の永続化ファイル。検証で書き換わるので終了後に削除（または退避→復元）する。
