# SCPJ データレビュー GAS アプリ

バッチ（`USE_TEST_MODE=FALSE` の差分チェックモード）がレビューシートに追記した
「J-STAGE 差分の修正案」をレビューし、SCPJ 本番シートへの反映可否を判断するための
Google Apps Script アプリケーションです。

- **形態**: スタンドアロン Web アプリ（`doGet` + HTML サービス）
- **管理**: [clasp](https://github.com/google/clasp) v3 でローカル開発 → `clasp push`
- **設定**: 変数管理スプレッドシートの `config` シートをバッチ側と共有（唯一の設定ソース）

---

## ディレクトリ構成

```
gas/
├── package.json          # clasp・型定義（本体 npm プロジェクトとは独立）
├── .clasp.json           # scriptId 等（ローカル専用・Git 管理外）
├── .clasp.json.example   # 上記のテンプレート
├── .claspignore          # push 対象外パターン
├── jsconfig.json         # エディタ補完用（@types/google-apps-script）
└── src/                  # ← clasp の rootDir。ここだけが GAS にアップロードされる
    ├── appsscript.json   # マニフェスト（タイムゾーン・スコープ・Web アプリ設定）
    ├── Code.js           # doGet / include / 動作確認用エントリ
    ├── Config.js         # config シート読み込み・スクリプトプロパティ
    ├── Columns.js        # レビューシート列定義（バッチ側と同期が必要）
    ├── ReviewService.js  # シート読み取り・接続確認ロジック
    ├── index.html        # 画面本体
    └── styles.html       # スタイル
```

> **重要**: `src/Columns.js` の `REVIEW_SHEET_COLUMNS` は
> バッチ側 `src/batch/index.js` の同名定数と**同一の並び**である必要があります。
> 片方だけ変更すると差分行の読み取り位置がずれます。

---

## セットアップ手順

### 1. 依存パッケージのインストール

```bash
npm install --prefix gas
```

### 2. 職場アカウントで clasp にログイン

対象スプレッドシートは**職場権限の Google アカウント**でのみアクセスできます。
個人アカウントの認証情報と混ざらないよう、clasp の名前付きプロファイル `scpj` を使います
（全 npm スクリプトが `clasp --user scpj` 付きで実行されます）。

```bash
npm run gas:login
```

ブラウザが開くので、**必ず職場アカウントを選択**してください。
既定のブラウザが個人アカウントでログイン済みだと自動的にそちらが選ばれることがあります。
アカウント選択画面が出ない場合はシークレットウィンドウで実行してください。

認証後、対象アカウントを確認します。

```bash
npm run gas:whoami
```

> **事前に必要な設定**: 職場アカウントでログインした状態で
> [script.google.com/home/usersettings](https://script.google.com/home/usersettings) を開き、
> **Google Apps Script API を「オン」**にしてください。オフのままだと `clasp push` が失敗します。

### 3. Apps Script プロジェクトを用意する

Apps Script プロジェクトは**職場アカウント側に作成**する必要があります
（個人アカウントで作ると対象スプレッドシートにアクセスできません）。

**新規作成する場合**（`gas/` ディレクトリで実行）:

```bash
npx clasp --user scpj create-script --title "SCPJ データレビュー" --type standalone --rootDir src
```

**既存のスクリプトに接続する場合**は `.clasp.json.example` をコピーして `scriptId` を記入:

```bash
cp gas/.clasp.json.example gas/.clasp.json
```

`scriptId` は Apps Script エディタの URL
`https://script.google.com/.../projects/`**`<scriptId>`**`/edit` から取得できます。

### 4. コードをアップロード

```bash
npm run gas:push
```

### 5. スクリプトプロパティを登録

Apps Script エディタの **「プロジェクトの設定 → スクリプト プロパティ」** から
以下を手動で登録します。

| プロパティ | 値 |
|---|---|
| `CONFIG_SHEET_ID` | 変数管理スプレッドシート（config / mapping シートが入っているもの）の ID |

> **コードに ID を書かないこと。** このリポジトリは外部公開されているため、
> スプレッドシート ID をソースに含めるとコミット履歴に残ります。
> 登録状況は `showScriptProperties()` を実行して確認できます（値は伏せ字で表示されます）。

### 6. サービスアカウントではなく実行ユーザーの権限で動く点に注意

この Web アプリは Google アカウントの権限でスプレッドシートを読み書きします。
デプロイするアカウントに、以下のスプレッドシートの**編集者権限**が必要です。

- 変数管理スプレッドシート（config シート）
- レビューシート
- SCPJ 本番スプレッドシート

### 7. 接続確認

Apps Script エディタで `runHealthCheck()` を実行し、ログの各項目が `"status": "OK"` になれば成功です
（`WARN` は未設定の任意項目、`NG` は失敗）。
Web アプリとしてデプロイ後は、画面の「接続確認を実行」ボタンからも同じ検査ができます。

---

## Web アプリのデプロイ

```bash
npm run gas:deploy
```

または Apps Script エディタの「デプロイ → 新しいデプロイ → 種類: ウェブアプリ」。

`src/appsscript.json` の `webapp` 設定は次のとおりです。運用方針に応じて変更してください。

| 設定 | 現在値 | 意味 |
|---|---|---|
| `executeAs` | `USER_DEPLOYING` | デプロイした人の権限で実行。レビュー担当者にシート権限を配らなくて済む |
| `access` | `ANYONE` | Google アカウントでログイン済みの誰でもアクセス可能（URL を知っている人） |

> `access: ANYONE` は URL を知る誰もが開ける状態です。組織内限定にする場合は
> `DOMAIN`（同一 Google Workspace ドメインのみ）に変更してください。
> また `executeAs: USER_DEPLOYING` の場合、ドメイン外ユーザーでは
> `Session.getActiveUser().getEmail()` が空になり、レビュー実施者を記録できません。

---

## コマンド一覧

リポジトリルートから実行できます（内部で `npm --prefix gas` を呼びます）。

| コマンド | 内容 |
|---|---|
| `npm run gas:login` | clasp の Google 認証（職場アカウント / `scpj` プロファイル） |
| `npm run gas:whoami` | 認証中のアカウントを確認 |
| `npm run gas:push` | `gas/src/` を Apps Script にアップロード |
| `npm run gas:push:force` | 同上（マニフェスト変更を含む場合はこちら） |
| `npm run gas:pull` | Apps Script 側の変更をローカルに取り込む |
| `npm run gas:open` | ブラウザで Apps Script エディタを開く |
| `npm run gas:logs` | 実行ログをストリーム表示 |
| `npm run gas:deploy` | Web アプリの新規デプロイを作成 |

`gas/` ディレクトリ内では `npm run push` のように短い名前でも実行できます。

---

## トラブルシューティング（職場アカウント / SSO 環境）

| 症状 | 原因 | 対処 |
|---|---|---|
| `clasp login` 後に「このアプリはブロックされました」 | Workspace 管理者がサードパーティ OAuth アプリを制限しており、clasp の既定 OAuth クライアントが未承認 | 管理者に clasp のクライアントID承認を依頼するか、職場 GCP プロジェクトで OAuth クライアントを作り `npx clasp --user scpj login --creds <client_secret.json>` を使う |
| `User has not enabled the Apps Script API` | 職場アカウントで Apps Script API がオフ | [script.google.com/home/usersettings](https://script.google.com/home/usersettings) で「オン」にする |
| ログイン後 `npm run gas:whoami` が個人アカウントを表示 | ブラウザの既定ログインが個人アカウント | `npm --prefix gas run logout` してからシークレットウィンドウで再ログイン |
| ブラウザが開けない環境 | リダイレクト用ローカルサーバが使えない | `npx clasp --user scpj login --no-localhost` で認証コードを手入力 |
| Web アプリのデプロイで `ANYONE` が選べない | 管理者ポリシーで組織外公開が禁止されている | `src/appsscript.json` の `access` を `DOMAIN` に変更する |

## Git 運用上の注意

- `gas/.clasp.json` は Git 管理外（`scriptId` は環境ごとに異なるため）
- clasp の認証情報 `~/.clasprc.json` は**絶対にコミットしない**
- ブランチ運用は [docs/OPERATIONS.md](../docs/OPERATIONS.md) のルールに従う
