---
name: tempoc-desktop-ui
description: TEMPOCデスクトップ版のメインウィンドウの使用量バーの表示仕様（レイアウト、ツールチップ、数値の表記、weekly_scoped副バー、Usage creditsバー、ウィンドウ高さ）と設定キーの一覧。バーの見た目や設定項目を変える・追加するときに使う。
---

# TEMPOC desktop の表示仕様と設定キー

設計上の判断（色分けの規則、ドラフト方式、「消さずに無効化」など）は `desktop/AGENTS.md` にある。パスは `desktop/` からの相対。

## 使用量バー（`UsageBar`）の表示

### レイアウト

上段（`usage-bar-head`）は **ラベル｜使用率** の 2 カラム。使用率のすぐ左に日時が並ぶと「日付 xx%」に見えて何の％か紛らわしいため、**リセット日時は下段（`usage-bar-foot`）に置く**。下段は「時間の行」で **`{日付}にリセット`（左）｜`あと{残り時間}`（右）** の 2 セル（flex space-between。`resetsAt` / `remaining` は i18n テンプレート。左右で「リセット」の語を分担するため right は `でリセット` を含まない）。バー本体は「塗り＝使用率」「白い縦マーカー＝時間経過率」。

### ツールチップ（`title`）

`使用量｜リセット日付｜経過%｜残り` を改行区切りでまとめた `title` を各バーに付ける（`buildTip(util)` で生成、全サイズモード共通）。経過%は独立表示を持たずこのツールチップに集約。**リセット日付/経過/残りはタイムライン共有なので主バーと副バーで違うのは使用量の行だけ**。主バーは `tooltip`（=`buildTip(util)`）、**weekly_scoped 副バーは `secTooltip`（=`buildTip(secUtil)`）で自分の使用量を表示**する。

- ノーマル/スモール: `.usage-bar` カードに主 `tooltip`、副バーの `usage-bar-head--sub` と `usage-bar-track-wrap` に `secTooltip` を付けて内側で上書き（ホバーで副バーは Scoped 値、それ以外は主バー値）。マーカー・フッターセルに個別 `title` は付けない
- コンパクト: 各行（`usage-bar-compact`）に自分のツールチップ（主行=`tooltip`、副行=`secTooltip`）。**ラベルの省略時 `title` は付けない**ため、行のどこ（ラベル含む）をホバーしてもこの値が出る

### 数値の表記

- **使用率**: `utilization` は API 上つねに整数（`percent`）なので `formatUtil()` で `100%` のように整数表示する（`decimalPlaces` / `percentFormat` は適用しない）
- **経過%**: 計算値なので `decimalPlaces` / `percentFormat` を適用する（`formatPercent()`）
- **残り時間**: 残り1分未満は**秒でカウントダウン**する（`formatRemaining`）。`Intl.DurationFormat` は 0 の単位を省くため、日/時/分だけを渡すと最後の1分は空文字になり「あと」「left」だけが残ってしまう。この間だけ `{ seconds }` を渡し、`durationFallback` も日/時/分がすべて 0 なら秒だけを返す

### weekly_scoped の副バー

**Weekly limit カード（`seven_day`）の中に副バーとしてネスト**する（`UsageBar` の `secondary` prop）。タイムライン（リセット日時・経過マーカー・残り時間）は主バーと共有し、副バーはラベル・使用率・色のみ独立。表示は `showDay7 && showWeeklyScoped` かつデータ存在時のみ。5時間バーは独立カードのまま。

### Usage credits バー（`kind: 'credits'`）

他のバーと同じ `UsageBar` で描くが、データ源が金額なので前処理が違う（`MainWindow` 内で算出）。

- **金額は使用率セルに入れる**: 右側の値セルが `$13.63/50.00 | 27%` になる（ラベルは他のバーと同じ素のウィンドウ名）。`UsageBar` の `utilText` prop で `formatUtil()` の代わりに描画する。`formatCredits()` が最小単位の整数を `decimal_places` で実額に直し、`Intl.NumberFormat` で UI ロケール整形する。通貨記号は**左の消費額だけ**に付け、右の上限は素の数値（記号の重複を避ける）
- 値セルの列幅は既定 4rem（"100%" 用）では足りないので、`utilText` があるカードに `usage-bar--wide-util` が付き **`--util-col: 18rem`**（コンパクトは `--compact-util-col: 10rem`）に広げる。他のバーの列幅には影響しない
- 時間軸は月単位なので、`WINDOW_MS` の定数引きではなく `windowStart()` が「終端から1か月戻す」を担当する（月の長さが可変なため。`Date.UTC` が month `-1` を前年12月に正規化するので1月も特別扱い不要）。**表示は他のバーと同じくユーザーのロケール/タイムゾーン**なので、JST では「8/1 9:00 にリセット」と出る
- 月替わり直後は消費額が次回取得まで古いまま（バーの時間軸だけ先に新しい月へ切り替わる）。5分の自動更新で追いつく

### ウィンドウの高さ

高さは表示中のバーに合わせて自動で決まる。`.usage-bars` コンテナの高さを `ResizeObserver`（`measureRef`）で測り、周囲の固定部分（`#root` のパディング + タイトルバー + `.app` のパディング。サイズモードごとに `CHROME_PX`）を足した値にする。下限は `MIN_WINDOW_H`（`main.go` の `MinHeight` と揃える）。高さの変化は `SetSize` を毎フレーム呼んでアニメーションさせ、終わったら `SetMinSize` / `SetMaxSize` で高さを固定する（ユーザーが下端をドラッグできるのは幅だけ）。

エラー帯などバーと一緒に出るものは `.usage-bars` の**内側**に置くこと。外に出すと測定に入らず、そのぶん見切れる。

## 設定キー一覧

定義は `settings/settings.go`（既定値は `Default()`）。拡張と同一のキー（`showDay7`/`showHour5`、`day7Danger`/`day7Warning`、`day7ColorEnabled`、`hour5*`、`showRemainDay7`/`showRemainHour5`、`decimalPlaces`、`durationStyle`、`percentFormat`、`refreshInterval`、`utilizationWarning`/`utilizationDanger`）に加え、デスクトップ独自:

| キー | 既定 | 説明 |
|---|---|---|
| `locale` | `""`(Auto) | **UI 言語**と日時・残り時間の表記ロケール。値は Claude 公式のロケールコード（一覧は `frontend/src/i18n.ts` の `SUPPORTED_LOCALES`）。空は `navigator.language` を最寄りのサポートコードへ解決（`ja` → `ja-JP`、非対応言語 → `en-US`）。**UI 文言と Intl 日時整形の両方に同じ解決済みコードを使う**ため言語と日付書式がズレない。設定ウィンドウの Language セレクタは選択した瞬間に設定ウィンドウ自身へプレビューされ、メインへの反映は Apply 時 |
| `theme` | `"system"` | UI テーマ: `system` / `light` / `dark`。`system` は `prefers-color-scheme` で OS 設定に追従（OS 側の切り替えもライブ反映）。`theme.ts` の `applyTheme()` が `<html>` に `data-theme="light\|dark"` を付与し、`style.css` の CSS 変数（`:root` = ダーク既定、`[data-theme="light"]` で上書き）が切り替わる。バー色（`COLORS`）も `var(--color-*)` 参照でテーマ追従。メイン・設定ウィンドウは別 JS コンテキストのため各自 `applyTheme()` を呼ぶ（設定ウィンドウは保存値で描画し、Apply 時に反映） |
| `sizeMode` | `"normal"` | 表示密度: `normal` / `small` / `compact`。バー・文字・パディングの大きさを変え、`compact` では各ウィンドウを1行に畳む（General セクションのセレクタ） |
| `transparent` | `false` | ウィンドウ透明の On/Off（設定ウィンドウ General のチェックボックス） |
| `alwaysOnTop` | `false` | 最前面表示の On/Off（タイトルバーのピン。永続化・起動時復元） |
| `showWeeklyScoped` | `true` | weekly_scoped バーの表示 |
| `weeklyScopedWarning` / `weeklyScopedDanger` | `0` / `10` | weekly_scoped の色閾値 |
| `weeklyScopedColorEnabled` | `true` | weekly_scoped の色分け有効 |
| `showRemainWeeklyScoped` | `true` | weekly_scoped の残り時間表示 |
| `weeklyScopedLabel` | `""` | weekly_scoped 副バーのラベル（設定ウィンドウで変更可）。空は UI 言語の既定ラベル（`i18n.ts` の `weeklyScopedFallback`）に従う |
| `showCredits` | `false` | Usage credits バーの表示（**既定オフ**。クレジット未使用のユーザーが大半で、内容も使用量ではなく金額のため） |
| `creditsOnlyWhenNeeded` | `false` | Usage credits を「必要な時のみ表示」。5時間 or 7日が 100% のときだけバーを出す。設定 UI 上は Show のサブ項目で、Show がオフの間は `disabled` |
| `creditsWarning` / `creditsDanger` | `0` / `10` | Usage credits の色閾値 |
| `creditsColorEnabled` | `true` | Usage credits の色分け有効 |
| `showRemainCredits` | `true` | Usage credits の残り時間表示 |

設定ウィンドウ（`SettingsWindow.tsx` の `SettingsView` コンポーネント）は General / Formatting / 5-Hour / 7-Day / Weekly (scoped) / Usage credits / Utilization Threshold の各セクション + dual-range スライダー + Claude interceptor toggle、フッターに Apply/Close ボタンを持つ。weekly_scoped は 5h/7d と同じ設定に加え Label（名称）入力を持ち、Usage credits は同じ4項目（ラベルは金額入りの自動生成なので Label 入力なし）。
