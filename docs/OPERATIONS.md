# SCPJ API 運用・開発ガイド（内部向け）

このドキュメントはシステム管理者・開発者向けです。
API利用者向けの情報は [README.md](../README.md) を参照してください。

---

## システム構成

```
【SCPJスプレッドシート】
         ↓ データを読み込む (npm run generate / 自動実行)
【GitHub Pages】→ 外部からJSON形式でアクセス可能
         ↑ 空欄を補完・差異チェック (npm run batch / 毎日自動実行)
【J-STAGE API】
```

- **データ配信**: SCPJシートのジャーナルデータをJSON変換し、GitHub Pagesで公開
- **データ補完バッチ**: 毎日深夜0時（JST）に自動実行。J-STAGEのデータで空欄を補完し、差異を検出・通知

---

## 前提条件・事前に用意するもの

| 必要なもの | 説明 | 入手方法 |
|---|---|---|
| **サービスアカウントキー（JSONファイル）** | Googleスプレッドシートを自動操作するための認証情報 | Google Cloud管理者に発行を依頼 |
| **変数管理スプレッドシートのID** | configシート・mappingシートが入ったスプレッドシート | 管理者から共有してもらう |
| **SCPJスプレッドシートへの編集権限** | バッチが空欄を書き込むため「編集者」権限が必要 | スプレッドシートオーナーに依頼 |
| **GitHubリポジトリへのアクセス権** | Actions・Secretsの設定に必要 | リポジトリ管理者に依頼 |
| **Node.js 20以上** | ローカルで実行する場合のみ必要 | [nodejs.org](https://nodejs.org/) からインストール |

> **サービスアカウントキーとは？**
> Googleスプレッドシートをプログラムから自動操作するための「ロボット専用パスワード」です。
> JSONファイル形式で発行されます。**このファイルは絶対に他人に見せないでください。**

---

## セットアップ手順

### ステップ1：スプレッドシートの準備（管理者作業）

1. **変数管理スプレッドシート**（configシート・mappingシート）にサービスアカウントを「編集者」として共有
2. **SCPJスプレッドシート**にも同じサービスアカウントを「編集者」として共有
3. configシートに以下の値を入力（A列=キー名、B列=値）:

   | キー | 値の例 | 説明 |
   |---|---|---|
   | `SCPJ_SHEET_ID` | `1BXn...` | SCPJスプレッドシートのID ※1 |
   | `SCPJ_SHEET_NAME` | `data` | SCPJシートのシート名 |
   | `TEST_SHEET_ID` | `1BXn...` | テスト用スプレッドシートのID |
   | `TEST_SHEET_NAME` | `data` | テスト用シートのシート名 |
   | `USE_TEST_MODE` | `FALSE` | テストモード。最初は `TRUE` で動作確認推奨 |
   | `MATCH_KEY_SCPJ` | `ISSN-L,EISSN,PISSN` | J-STAGE照合に使うISSN列名（左から優先） |
   | `LAST_BATCH_RUN` | （空欄でOK） | バッチが自動更新します |
   | `REPORT_EMAIL_TO` | `admin@example.com` | 差異通知メールの送信先 |
   | `REPORT_EMAIL_FROM` | `noreply@example.com` | 差異通知メールの送信元 |

   > **※1 スプレッドシートIDの確認方法:**
   > URLの `/spreadsheets/d/` と `/edit` の間にある文字列です。
   > 例: `https://docs.google.com/spreadsheets/d/`**`1BXnU7whCp...`**`/edit`

### ステップ2：GitHub Secretsの登録（管理者作業）

GitHubリポジトリの **Settings → Secrets and variables → Actions** から以下を登録します:

| Secret名 | 必須/任意 | 内容 |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | **必須** | サービスアカウントJSONキーのテキスト全文 |
| `CONFIG_SHEET_ID` | **必須** | 変数管理スプレッドシートのID |
| `SENDGRID_API_KEY` | 任意 | SendGridのAPIキー（差異メール通知を使う場合のみ） |

> **GitHub Secretsとは？**
> APIキーやパスワードなどの秘密情報を安全に保管する仕組みです。
> 一度登録すると値は表示されなくなりますが、GitHub Actionsの自動実行で使用されます。

### ステップ3：ローカル実行環境の構築（任意）

ローカルPCで動作確認したい場合のみ必要です。

```bash
# 1. リポジトリをクローン
git clone https://github.com/JPCOAR/scpj-api.git
cd scpj-api

# 2. パッケージをインストール
npm install

# 3. .env ファイルを作成（サンプルをコピーして編集）
cp .env.example .env
# .env をエディタで開き、GOOGLE_SERVICE_ACCOUNT_KEY と CONFIG_SHEET_ID を入力
```

### ステップ4：接続確認

```bash
npm run check-config
```

configシートの内容がコンソールに表示されれば、セットアップ完了です。

---

## コマンド一覧

| コマンド | いつ使うか | 実行するとどうなるか |
|---|---|---|
| `npm run check-config` | セットアップ後の疎通確認 | configシートに接続し、設定値を表示する |
| `npm run generate` | 手動でJSONを更新したいとき | SCPJシートを読み込みGitHub Pages用JSONを生成する |
| `npm run batch` | 手動でバッチを実行したいとき | J-STAGE APIからデータを取得しSCPJシートを補完する |

> **注意:** `npm run batch` は全3,000件以上のジャーナルにJ-STAGE APIを呼び出すため、完了まで約60分かかります。

---

## 運用・定常作業

### 自動実行スケジュール

| ワークフロー | 実行タイミング | 処理内容 |
|---|---|---|
| **SCPJ Batch** | 毎日 深夜0時（JST）/ 手動実行可 | ①バッチ処理 → ②静的JSON生成 → ③GitHub Pagesデプロイ |
| **Deploy Static JSON** | 手動実行のみ | 静的JSON生成 → GitHub Pagesデプロイ（バッチなし） |

### 正常終了の確認方法

1. GitHubリポジトリの **Actions タブ** を開く
2. 最新の実行が ✅（緑のチェック）になっていれば成功
3. ログをクリックして「Run batch」ステップで以下を確認:
   - `バッチ完了 / 処理: XXXX 件 / 補完: XX 件 / 差異: XX 件`
   - 差異がある場合は内訳もログに表示されます

### 手動でバッチを実行したい場合

1. GitHubリポジトリの **Actions タブ** を開く
2. 左メニューから **SCPJ Batch** をクリック
3. 右上の **Run workflow** → **Run workflow** で実行

### バッチの動作モード（USE_TEST_MODE）

configシートの `USE_TEST_MODE` の値によって、バッチの動作が切り替わります。

| USE_TEST_MODE | 動作 | 書き込み先 |
|---|---|---|
| `TRUE`（補完モード） | SCPJシートの**空欄のみ**にJ-STAGEの値を書き込む | SCPJシート（本番） |
| `FALSE`（差分チェックモード） | J-STAGEと差異がある行を**テストシートに追記**する | テストシート |

- **補完モード**: 欠損データを埋める。本番シートが直接更新されます
- **差分チェックモード**: J-STAGEの最新値とSCPJの差異を検出し、テストシートに「修正案」として追記。確認・承認してから本番に取り込む運用を想定

> 通常運用では `USE_TEST_MODE=FALSE`（差分チェックモード）を使用します。

---

## mappingシートリファレンス

### 列の意味

| 列 | ヘッダー | 入力内容 |
|---|---|---|
| A | id | 管理用ID（例: `map_020`）。連番で追加してください |
| B | scpjColumn | SCPJシートの1行目にある英語列名（例: `Journal_Title_En`） |
| C | source | データソース（現在は `JSTAGE` のみ対応） |
| D | sourcePath | J-STAGEレスポンスのフィールドパス（下記参照） |
| E | transform | 変換ルール。不要な場合は `なし` と入力 |
| F | enabled | `TRUE` で有効化。まず `FALSE` で追加して動作確認するのがおすすめ |
| G | notes | メモ（自由記入） |
| H | overwrite | `TRUE` で既存値も上書き。`FALSE` または空欄で空欄のみ補完 |

### F列・H列の組み合わせ

| F列 | H列 | 動作 |
|---|---|---|
| `FALSE` | （どちらでも） | **無効**: J-STAGEからの補完を行わない |
| `TRUE` | `FALSE` または空 | **補完のみ**: 空欄の場合だけ書き込む（補完モード時） |
| `TRUE` | `TRUE` | **上書き検出**: 差異があればテストシートに追記（差分チェックモード時） |

### D列（sourcePath）に使用できる値

```
material_title.en   誌名（英語）
material_title.ja   誌名（日本語）
publisher.name.en   発行者名（英語）
publisher.name.ja   発行者名（日本語）
publisher.url.ja    発行者URL
cdjournal           J-STAGEジャーナルコード（例: hpi1972）
prism:issn          Print ISSN
prism:eIssn         Electronic ISSN
```

### OAフィールドの有効化手順（将来対応）

J-STAGE OAフィールド名が確定したら:
1. mappingシート map_016〜019 の D列を実フィールド名に更新
2. F列を `TRUE` に変更
3. `src/batch/jstage.js` の返却オブジェクトに当該フィールドを追加

---

## トラブルシューティング

### バッチが失敗した場合

1. GitHub Actions の **Actions タブ** で失敗したジョブをクリック
2. 赤くなったステップを展開し、エラーメッセージを確認

**よくあるエラーと対処法:**

| エラーメッセージ | 原因 | 対処法 |
|---|---|---|
| `環境変数 CONFIG_SHEET_ID が設定されていません` | GitHub Secretsに `CONFIG_SHEET_ID` が未登録 | GitHub Secrets を確認・登録する |
| `SCPJ に列 "ISSN-L" が見つかりません` | configシートの `MATCH_KEY_SCPJ` に書いた列名がSCPJシートにない | SCPJシートの1行目の列名と一致させる |
| `mapping シートが見つかりません` | 変数管理SSにmappingシートがない | mappingシートを作成する（なければバッチは0件処理で継続） |
| Google APIの認証エラー | サービスアカウントキーが無効、またはスプレッドシートに共有されていない | キーを再発行するか、スプレッドシートの共有設定を確認する |

### バッチは成功しているが補完が0件の場合

- mappingシートの F列が `TRUE` になっているか確認してください
- SCPJシートの列名（B列）が正しいか確認してください
- J-STAGEにそのISSNが登録されていない可能性があります（約44%は未登録）

### GitHub PagesのJSONが古い場合

Actions タブから **Deploy Static JSON** を手動実行してください。

---

## 注意事項・セキュリティ

> **絶対にやってはいけないこと**
>
> - `GOOGLE_SERVICE_ACCOUNT_KEY` のJSON内容をメールやSlackで共有しない
> - サービスアカウントキーのJSONファイル（`*.json`）をGitにコミットしない
> - `SENDGRID_API_KEY` を第三者に共有しない

- `USE_TEST_MODE=TRUE`（補完モード）では本番SCPJシートの**空欄のみ**に書き込みます。既存の値は変更されません
- `USE_TEST_MODE=FALSE`（差分チェックモード）では本番シートを変更せず、差分をテストシートに追記します

---

## ブランチ運用ルール

### ブランチ構成

| ブランチ | 用途 | マージ先 |
|---|---|---|
| `main` | 本番稼働中の安定版。**直接コミット禁止** | — |
| `feature/<名称>` | 機能追加（例: `feature/jstage-oa-fields`） | `main` へPR |
| `fix/<名称>` | バグ修正（例: `fix/issn-validation`） | `main` へPR |
| `hotfix/<名称>` | 本番緊急対応（例: `hotfix/batch-timeout`） | `main` へPR |

### PR・マージのルール

- `main` への直接 push は禁止（Branch Protection Rule で設定する）
- マージには **最低1名のレビュー承認** が必要
- マージ後は `workflow_dispatch` で **手動バッチ実行し動作確認** してから自動スケジュール運用に戻す

### コミットメッセージ規約

`<type>: <概要>` の形式を使用します。

| type | 用途 |
|---|---|
| `feat` | 新機能追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `refactor` | 動作を変えないコード整理 |
| `perf` | パフォーマンス改善 |
| `chore` | 依存関係更新・設定ファイル変更など |

例: `fix: J-STAGE から取得した ISSN のハイフンを除去`

### J-STAGE API改修時の手順（3/25 予定）

1. `feature/jstage-api-v2` ブランチを `main` から作成
2. `src/batch/jstage.js` を修正・ローカルで動作確認
3. PR → `main`（レビュー1名以上）
4. マージ後、`SCPJ Batch` を手動実行して結果を確認

---

## ディレクトリ構成

```
scpj-api/
├── src/
│   ├── api/
│   │   ├── generate.js        # 静的JSON生成（SCPJシート → docs/data/）
│   │   ├── retrieve.js        # フィルタ・ページネーション処理
│   │   ├── retrieve_by_id.js  # ID検索処理
│   │   └── object_ids.js      # ID一覧生成
│   ├── batch/
│   │   ├── index.js           # バッチ処理メイン
│   │   ├── jstage.js          # J-STAGE API連携
│   │   ├── diff.js            # 差異チェック・補完ロジック
│   │   ├── report.js          # SendGrid メール送信
│   │   ├── sheets.js          # Google Sheets API操作
│   │   └── opf.js             # HTTPリトライ付きfetchユーティリティ
│   └── utils/
│       ├── config.js          # configシート読み込み（単体実行で疎通確認可）
│       ├── mapping.js         # mappingシート読み込み・フィールド解決
│       └── normalize.js       # 列名→APIキー変換・ISSN正規化
├── docs/
│   ├── data/                  # GitHub Pages配信ファイル（自動生成・編集不要）
│   └── OPERATIONS.md          # このファイル
├── .github/workflows/
│   ├── batch.yml              # 毎日自動実行バッチ
│   └── deploy.yml             # 静的JSON手動デプロイ
├── .env.example               # ローカル実行時の環境変数サンプル
└── package.json
```

> **`docs/data/` について**: GitHub Actionsが自動生成します。手動で編集しないでください。

---

## SCPJシートの構造（重要）

| 行 | 内容 | 備考 |
|---|---|---|
| **1行目** | 英語列名（`Journal_ID`, `ISSN-L` など） | バッチが列を特定するために使用 |
| **2行目** | 日本語ラベル（「ジャーナルID」など） | バッチ処理では読み飛ばされます |
| **3行目以降** | ジャーナルデータ（`J000001`〜） | バッチの補完対象 |

---

## 依存パッケージ

| パッケージ | 用途 |
|---|---|
| `googleapis` | Google Sheets API（スプレッドシートの読み書き） |
| `xml2js` | J-STAGE APIのXMLレスポンスを解析 |

---

## 改訂履歴

| 日付 | 変更内容 |
|---|---|
| 2026-03-23 | README/OPERATIONSを分割。ブランチ運用ルールを追加 |
| 2026-03-13 | バッチをUSE_TEST_MODEによる2モード分岐に再設計（補完モード / 差分チェックモード） |
| 2026-03-13 | ISSNのハイフン差異を正しく検出・是正するよう修正 |
| 2026-03-13 | テストシート追記行に空欄補完値（complements）も反映するよう修正 |
| 2026-03-13 | J-STAGE APIの全巻号エントリを走査してprism:issnを確実に取得するよう改善 |
| 2026-03-13 | テストシートへの追記位置を明示化（入力済み範囲の直後に追記） |
| 2026-03-12 | J-STAGE連携に `prism:issn` / `prism:eIssn`（PISSN・EISSN）フィールドを追加 |
| 2026-03-12 | J-STAGE共通フィールド補完・上書きフラグ（mapping H列）を実装 |
| 2026-03-11 | ISSNルックアップをハイフンあり・なし両対応に対応 |
| 2026-03-11 | `by_id` / `by_issn` による静的ファイル分割でID/ISSNルックアップを高速化 |
| 2026-03-11 | OPF API接続を削除しJ-STAGEのみの構成に変更 |
| 2026-03-10 | 初版作成（SCPJ API & J-STAGE連携システム） |
