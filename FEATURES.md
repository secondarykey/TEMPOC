# New Features

新規の機能を追加します。
現在はChromeExtensionとして使用量の表示に対して、５時間、１週間の経過情報を表示していますが、新機能ではデスクトップとしてその表示を行います。

- 使用量のサイトにアクセスし、API通信を監視し使用量を取得
- 認証が必要な状況の場合、ユーザに認証画面(Claudeのサイト)をブラウザに表示する
- ログイン後使用量を取得し、画面に反映する

## 使用量サイト

https://claude.ai/new#settings/usage

処理できない場合、以下にリダイレクト(403)

https://claude.ai/login?from=logout

ログインはユーザが行う

### 使用量API

https://claude.ai/api/organizations/{organization_id?}/usage

戻り値等は既存のChromeExtensionなどを参考にしてください。

## プロトタイプ

一旦は以下を行って、再起動などでセッションが持続するかを確認する実装を行います。
構築としては Wails3 を利用した機能で基盤をすでにdesktopに構築している状態です。

最終的には、プログレスバー表示を行いますが、一旦は傍受したAPIの値を表示してみましょう。

