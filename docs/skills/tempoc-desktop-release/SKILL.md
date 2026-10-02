---
name: tempoc-desktop-release
description: TEMPOCデスクトップ版のバージョン管理・ビルドアセット（build/config.yml, Taskfile, アイコン）・リリースワークフロー・macOS署名・exeのバージョン情報の詳細。desktop のバージョンを上げる、ビルド設定やアセットを変える、リリースや配布物の不具合を調べるときに使う。
---

# TEMPOC desktop のバージョン管理・リリース

常に守る制約だけを `desktop/AGENTS.md` の「バージョン管理・リリース」に要約してある。ここはそれを触るときに読む詳細。パスは特に断りがなければ `desktop/` からの相対。

`wails3` skill（`references/*.md`）への言及は、リポジトリ外にある Wails v3 全般の資料を指す。

## バージョンの同期（`_cmd/version.go`）

バージョンの**唯一の正は `desktop/version`**（テキスト1行）。`build/config.yml` の `info.version` と `frontend/package.json` の `version` はその写しで、**手で編集しない**。同期は `_cmd/version.go` が行う（`desktop/` から実行）:

```bash
go run ./_cmd/version.go 1.2.3   # 指定バージョンを全ファイルへ
go run ./_cmd/version.go -bump   # patch/minor/major を対話選択（Enter=patch）
go run ./_cmd/version.go         # version の現在値で他ファイルを再同期
go run ./_cmd/version.go -print  # 現在値を表示するだけ（CI 用）
```

`frontend/package-lock.json` の `version` は**同期対象に含めていない**。ロック内の依存パッケージのバージョン行と同じインデント（6スペースの `"version": "..."`）で並んでおり、行パターンで置換すると全依存のバージョンを書き潰すため。ビルド時の `npm install`（`npm ci` ではない）が package.json に合わせて自動で書き直すので実害はなく、アプリの中身にも影響しない。

`_cmd/` はアンダースコア始まりなので go ツールが `./...` から除外する。よってこのツールは `go build ./...` の対象外だが `go run ./_cmd/version.go` では動く。`main.go` の `//go:embed version` は **version ファイルが main.go と同じディレクトリにある必要がある**（ルートの `chrome-extension/version` は参照できない）。埋め込んだ値は起動ログ（`level=INFO msg=starting version=0.1.0`。開発ビルドのみ — `desktop/AGENTS.md` の「開発・ビルド」のログ方針参照）に出る。

## exe 名（`APP_NAME`）

exe 名は `Taskfile.yml` の `APP_NAME`（= `tempoc`）が決める。`config.yml` の `info:` には**バイナリ名を指定するキーが無い**ため（`name:` / `binary:` は存在しない）、`update build-assets` へは `-name` / `-binaryname` として渡される。よって `APP_NAME` を変えたら `wails3 task common:update:build-assets` → 再ビルドまでやらないと、生成済みアセット（NSIS の `INFO_PROJECTNAME`、Linux の `Exec`/`Icon`/`StartupWMClass`、darwin の `CFBundleExecutable`）が古い名前のまま残る。

⚠️ **`APP_NAME` の変更は WebView2 のユーザーデータフォルダ（`%APPDATA%\<exe名>\EBWebView`）を変える**。旧フォルダのセッションは引き継がれないため、改名後の初回起動では claude.ai が未ログイン状態になり、一度ログインし直すことになる（`desktop` → `tempoc` の改名時も同様）。この挙動は `tempoc-desktop-verify` スキルにも別名 exe のスモークテスト手段として記載がある。

## exe のメタデータ（`info:` → 各アセット）

`build/config.yml` の `info:` が一元ソース。値の対応と「ユーザーに何として見えるか」は `wails3` skill の `references/build-assets.md` を参照。**Windows のタスクバー／タスクマネージャの表示名は `description`（FileDescription）であって ProductName ではない**ため、`description` にはアプリの表示名を入れてある。

再生成は**必ず Taskfile 経由**で行う:

```bash
wails3 task common:update:build-assets   # -name/-binaryname/-config/-dir を APP_NAME 込みで渡してくれる
```

**素の `wails3 update build-assets` を叩いてはいけない** — フラグが無いと全項目がテンプレート既定値で上書きされ、`windows/wails.exe.manifest` の `com.github.secondarykey.tempoc.desktop`（`productIdentifier` 由来）も失われる。

## アイコン（`appicon.png` 一本。Assets.car は使わない）

アイコンの正は **`build/appicon.png`（TEMPOC 独自アイコン）だけ**。`common:generate:icons` がここから `darwin/icons.icns` と `windows/icon.ico` を作る。

⚠️ **`-iconcomposerinput` / `-macassetdir` を復活させてはいけない**（`build/Taskfile.yml` の `generate:icons`）。このフラグは Icon Composer 形式の `.icon` から `Assets.car`（アセットカタログ）を生成するが、**`Assets.car` が存在すると `update build-assets` が Info.plist に `CFBundleIconName` を書き込み**（`internal/commands/build-assets.go`）、macOS は**それを `CFBundleIconFile`（= `icons.icns`）より優先する**。テンプレート既定の `appicon.icon` は中身が **Wails のロゴ（`wails_icon_vector.svg`）のまま**だったため、macOS だけ TEMPOC ではなく Wails ロゴが表示されていた（2026-07 に `appicon.icon` と `Assets.car` を削除して解消）。

- Info.plist の `CFBundleIconName` は**テンプレート側で条件付き**（`{{- if .CFBundleIconName}}`）で、`Assets.car` が無ければ書かれない。よって `update build-assets` を再実行しても**この修正は巻き戻らない**
- Taskfile は `update build-assets` の再生成対象外（`updatable_build_assets` に含まれない）なので、`generate:icons` の編集も残る
- 副次効果として **`actool` は一切呼ばれなくなった**（`-iconcomposerinput` 指定時のみ実行されるため）。skill pitfalls #11 の macOS CI クラッシュ要因も消えている
- トレードオフ: **macOS 26 の Liquid Glass 階層アイコンには非対応**（従来形式）。対応したくなったら、Wails 既定ではなく **TEMPOC 用に作った `.icon` バンドル**を用意してからフラグを戻すこと

## ⚠️ macOS の .app バンドルは毎回作り直す（codesign の detritus エラー）

`build/darwin/Taskfile.yml` の `run`（= `wails3 dev` の起動段）と `create:app:bundle`（= `package`）は、テンプレート既定では**既存バンドルに上書きコピーするだけ**だった。そのため2回目以降は**すでに署名済みのバンドルを再署名**することになり、`codesign` が

```
replacing existing signature
<bundle>: resource fork, Finder information, or similar detritus not allowed
```

で **exit 1** し、`run` の最終行（アプリの起動）に到達せず**起動しなくなる**（`wails3 dev` はその後 Vite を起動するので、一見動いているように見えるのが厄介）。

対策として両タスクの先頭に **`rm -rf` でバンドルを消してから組み立て直す**のと、署名直前の **`xattr -cr`** を入れてある（`cp` は macOS で拡張属性を引き継ぐため）。**この2行を消さないこと。** 副次的に、生成されなくなったファイル（旧 `Assets.car` 等）がバンドル内に残り続ける問題も同時に防いでいる。`rm -rf` の対象は `bin/<name>.app` / `bin/<name>.dev.app` であって**ビルド成果物の `bin/<name>` 本体ではない**。

**`build/windows/msix/` だけは例外で、`wails3 init` 時にしか生成されず update でも再生成されない**（＝手で直すと恒久的に残る一方、`config.yml` や `APP_NAME` を変えても自動追従しない）。`app_manifest.xml` / `template.xml` の表示名・exe 名・`Version="0.1.0.0"` は手で同期させてある。**バージョン番号は `_cmd/version.go` の同期対象外なので、MSIX で配布するなら bump のたびに手で直すこと**。現状の既定パッケージ形式は NSIS（`wails3 task windows:package`）で MSIX は使っていない。

exe への焼き込みは `wails3 generate syso`（`windows:build` タスクが毎回実行）→ `.syso` を go build がリンク、という順で起こる。したがって `config.yml` を直しただけでは何も変わらず、`update build-assets` → 再ビルドまでやって初めて反映される。

## リリース（自動。タグは手で打たない）

タグの規則・次バージョンの決め方・2本のワークフローの流れは拡張と共通なので、ルートの `AGENTS.md` の Versioning に一度だけ書いてある。ここはデスクトップ固有の部分:

- **minor/major を上げるときは `go run ./_cmd/version.go 0.3.0` して commit する**（`desktop/version` を直接書き換えない。写しのファイルも揃える必要があるため）
- `versionup-desktop.yml` は bump のときに `go run ./_cmd/version.go` と `wails3 task common:update:build-assets` を実行し、再生成されたアセットも一緒にコミットする
- `release-desktop.yml` の中身: `verify`（タグ/version/info.json 一致チェック）→ `build`（`windows-latest` / `macos-latest` / `ubuntu-latest` のマトリクスで各 OS ネイティブビルド）→ `release`（3成果物を1つの **draft** リリースへ添付）。成果物は Windows=`tempoc-desktop-<version>-windows-amd64.zip`（`windows:build` の `tempoc.exe`）、macOS=`…-darwin-arm64.zip`（`darwin:package` または署名 secrets がある場合は `darwin:sign:notarize` の `.app` を ditto 圧縮。下記「macOS の署名」参照。`macos-latest`=Apple Silicon のネイティブ arm64。Intel は非対応 — universal 化するなら amd64 の CGO クロスが要る）、Linux=`…-linux-amd64.tar.gz`（`linux:build` の裸バイナリ）。**macOS ランナーは `macos-latest`**（以前は `macos-15` 固定。macos-26 で `failed to run actool` になったためだが、原因は Xcode ではなく存在しない `appicon.icon` を渡していたこと＝wails3 skill pitfalls #11 で、上記「アイコン」のとおり今は actool 自体が呼ばれないので固定する理由がない。macOS のビルドが急に壊れたら、まず `macos-latest` の指す版が変わっていないか見る）。Linux ビルドは `WAILS_LINUX_DEPS`（GTK4/WebKitGTK）が必要

CLI のバージョンは `.github/variables` の `WAILS_VERSION` に固定。**`go.mod` の `wails/v3` と一致させること**（CLI が bindings と .syso を生成するため、プレリリース間のズレは壊れる）。

⚠️ **Linux で wails/v3 を import する物をコンパイルするには GTK4/WebKitGTK の開発パッケージが要る**。`internal/operatingsystem` が `#cgo linux pkg-config: gtk4 webkitgtk-6.0` を宣言しているため、**GUI をビルドしない `versionup-desktop` でも `go install .../cmd/wails3` の時点で失敗する**（`Package gtk4 was not found`）。パッケージ名は `.github/variables` の `WAILS_LINUX_DEPS` に `WAILS_VERSION` と並べて置いてある — **この2つは常にセットで更新すること**。alpha.84 で既定が GTK3/WebKit2（`libgtk-3-dev` / `webkit2gtk-4.1-dev`）から GTK4/WebKitGTK 6.0 に変わった前例がある（`wails3` skill の `references/pitfalls.md` の 6）。

## ⚠️ macOS の署名（未設定なら「壊れているため開けません」になる）

`darwin:package` が最後に打つのは **ad-hoc 署名**（`codesign --sign -`）で、**ビルドしたマシンでしか通らない**。GitHub Releases からダウンロードすると macOS が `com.apple.quarantine` を付け、Gatekeeper が ad-hoc かつ未 notarize の `.app` を拒否して

> 「"tempoc"は壊れているため開けません。ゴミ箱に入れる必要があります。」

と出す。**バイナリは壊れていない**（`wails3` skill の `references/macos-distribution.md` §1）。このメッセージが出たら真っ先に署名を疑うこと。

`release-desktop.yml` は **secrets が揃っているときだけ Developer ID 署名 + notarize + staple** を行い、無ければ ad-hoc にフォールバックする（証明書が無い間もリリースを止めないため）。判定は `verify` ジョブの `macos_signing` output に一本化してあり、これは **macOS レグと `release` ジョブの両方が同じ答えを要る**ため（署名されていない回だけリリースノートに `xattr` の回避手順を出す）。必要な secrets:

| Secret | 内容 |
|---|---|
| `MACOS_CERT_P12` | Developer ID Application 証明書（`.p12`）の base64 |
| `MACOS_CERT_PASSWORD` | `.p12` 書き出し時のパスワード |
| `MACOS_SIGN_IDENTITY` | `Developer ID Application: name (TEAMID)` |
| `MACOS_NOTARY_APPLE_ID` / `MACOS_NOTARY_TEAM_ID` / `MACOS_NOTARY_PASSWORD` | notarytool の資格情報（password は **app-specific password**） |

⚠️ **`build/darwin/Taskfile.yml` の `sign` / `sign:notarize` は `SIGN_IDENTITY` / `KEYCHAIN_PROFILE` を task 変数で受け取る**ように変更してある（テンプレート既定は `-- --identity ...` だった）。**`wails3 task` は CLI_ARGS を実装しておらず**、`--` で解析を打ち切って `KEY=VALUE` だけを変数にするため（`internal/commands/task.go`）、既定のままでは `{{.CLI_ARGS}}` が常に空に展開されて `wails3 tool sign` が `--identity is required` で落ちる。値は**呼び出しごとに渡す**こと（Taskfile に直書きしない）。Taskfile は `updatable_build_assets` に含まれないのでこの変更は `update build-assets` で巻き戻らない。

CI は署名後に `codesign -dv` / `stapler validate` / `spctl -a -t exec` まで検証してからアーカイブする。**`codesign` が通っても `spctl` が reject することがある**（notarize 漏れ）ので、確認は必ず `spctl` まで。

release 側の先頭には **タグ / `desktop/version` / `build/windows/info.json` の3者一致チェック**がある。exe のバージョンはタグではなく `info.json`（`config.yml` 由来）から焼かれるため、手で bump して `update build-assets` を忘れると中身が旧版のまま配布されうる。ズレていれば直し方を示してツールチェイン導入前に落ちる。

## ⚠️ exe のバージョン情報の確認方法

wails3 の syso はバージョンリソースを**言語ニュートラル（`0000`）**で埋め込む。このため .NET 経由（`(Get-Item x.exe).VersionInfo` / `[System.Diagnostics.FileVersionInfo]`）では**文字列が全て空に見えるが、壊れているわけではない**（FixedFileInfo の `FileMajorPart` 等だけは読める）。エクスプローラ・タスクバーが使うシェルプロパティでは正しく読めるので、検証はシェル経由で行う:

```powershell
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace("<絶対パス>\desktop\bin")
$item = $folder.ParseName("tempoc.exe")
$folder.GetDetailsOf($item, 34)   # File description
$folder.GetDetailsOf($item, 306)  # Product version
```

さらに Windows は FileDescription を exe のフルパス単位でキャッシュする（MuiCache / PCA）ため、更新しても古い表示名が残る。詳細と対処は `wails3` skill の `references/pitfalls.md` の 14 を参照。
