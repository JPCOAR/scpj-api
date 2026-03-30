# SCPJ API

SCPJが管理する日本の学術雑誌のオープンアクセスポリシー情報をJSON形式で提供するAPIです。
毎日自動更新されます。

---

## エンドポイント

**ベースURL:** `https://jpcoar.github.io/scpj-api/data`

| エンドポイント | 説明 |
|---|---|
| `/all.json` | 全件データ（`{ "items": [...] }` 形式） |
| `/index.json` | journal_id 一覧 |
| `/by_id/{journal_id}.json` | journal_id で1件取得（例: `J000001`） |
| `/by_issn/{issn}.json` | ISSNで1件取得（ハイフンあり・なし両対応） |

### 使用例

```bash
# journal_id で1件取得
curl https://jpcoar.github.io/scpj-api/data/by_id/J000001.json

# ISSN で取得（ハイフンあり・なし両対応）
curl https://jpcoar.github.io/scpj-api/data/by_issn/1234-5678.json
curl https://jpcoar.github.io/scpj-api/data/by_issn/12345678.json

# 全件取得
curl https://jpcoar.github.io/scpj-api/data/all.json
```

---

## レスポンス構造

### `by_id/{journal_id}.json` / `by_issn/{issn}.json`

1件のジャーナルオブジェクトをそのまま返します。

```json
{
  "journal_id": "J000001",
  "journal_title": "古代学",
  "journal_title_en": "",
  "issn_l": "",
  "pissn": "00459232",
  "eissn": "",
  "oa_type": "",
  "published_archivability": "",
  "updated_at": "2025/03/21",
  "..."
}
```

### `all.json`

```json
{
  "items": [
    { "journal_id": "J000001", "..." },
    { "journal_id": "J000002", "..." }
  ]
}
```

---

## データフィールド

空文字列 `""` は未登録・未確認を意味します。

### 基本情報

| フィールド | 説明 |
|---|---|
| `journal_id` | SCPJ固有のジャーナルID（例: `J000001`） |
| `journal_title` | 誌名（日本語） |
| `journal_title_alias` | 誌名別称・略称 |
| `journal_title_en` | 誌名（英語） |
| `journal_url` | ジャーナル公式URL |
| `issn_l` | ISSN-L（Linking ISSN） |
| `pissn` | 印刷版ISSN（ハイフンなし8桁） |
| `eissn` | 電子版ISSN（ハイフンなし8桁） |
| `doaj` | DOAJ登録状況 |
| `oa_type` | OAタイプ（Gold / Diamond / Hybrid 等） |
| `oa_type_notes` | OAタイプ補足説明 |
| `policy_url` | 著作権・OAポリシーページのURL |
| `non_embargo_oa` | エンバーゴなしOA可否 |
| `applicability` | SCPJポリシーの適用状況 |
| `updated_at` | SCPJによるデータ更新日（`YYYY/MM/DD`形式） |
| `sheet_updated_at` | スプレッドシート最終更新日 |

### 学会情報

| フィールド | 説明 |
|---|---|
| `society_id` | 学会ID（SCPJ固有、例: `S000001`） |
| `society_name` | 学会名（日本語） |
| `society_name_en` | 学会名（英語） |
| `society_url` | 学会公式URL |
| `society_contact_url` | 学会への問い合わせURL |
| `meikan_url` | 日本学術会議 学術団体名鑑URL |

### 掲載版 OA ポリシー（`published_*`）

出版社が発行した掲載版PDFに関するポリシーです。

| フィールド | 説明 |
|---|---|
| `published_copyright_owner` | 著作権者（著者 / 学会 等） |
| `published_licence` | ライセンス（CC-BY 等） |
| `published_archivability` | アーカイブ・公開可否 |
| `published_location_ir` | 機関リポジトリへの掲載可否 |
| `published_location_author` | 著者ウェブサイトへの掲載可否 |
| `published_location_funder` | ファンダーリポジトリへの掲載可否 |
| `published_location_non_commercial` | 非商用リポジトリへの掲載可否 |
| `published_location_others` | その他掲載先 |
| `published_embargo_general_months` | 一般エンバーゴ期間（月数） |
| `published_embargo_funded_months` | 助成研究向けエンバーゴ期間（月数） |
| `published_terms_copyright` | 著作権表示条件 |
| `published_terms_by` | 帰属表示条件 |
| `published_terms_link` | 元論文へのリンク条件 |
| `published_terms_notes` | その他条件の補足 |

### 受理後原稿 OA ポリシー（`accepted_*`）

査読を経て受理された原稿（著者最終稿）に関するポリシーです。
フィールド構成は掲載版（`published_*`）と同一です。

| フィールド | 説明 |
|---|---|
| `accepted_copyright_owner` | 著作権者 |
| `accepted_licence` | ライセンス |
| `accepted_archivability` | アーカイブ・公開可否 |
| `accepted_location_ir` | 機関リポジトリへの掲載可否 |
| `accepted_location_author` | 著者ウェブサイトへの掲載可否 |
| `accepted_location_funder` | ファンダーリポジトリへの掲載可否 |
| `accepted_location_non_commercial` | 非商用リポジトリへの掲載可否 |
| `accepted_location_others` | その他掲載先 |
| `accepted_embargo_general_months` | 一般エンバーゴ期間（月数） |
| `accepted_embargo_funded_months` | 助成研究向けエンバーゴ期間（月数） |
| `accepted_terms_copyright` | 著作権表示条件 |
| `accepted_terms_by` | 帰属表示条件 |
| `accepted_terms_link` | 元論文へのリンク条件 |
| `accepted_terms_notes` | その他条件の補足 |

### 投稿中原稿 OA ポリシー（`submitted_*`）

査読前の投稿中原稿（プレプリント）に関するポリシーです。

| フィールド | 説明 |
|---|---|
| `submitted_archivability` | アーカイブ・公開可否 |
| `submitted_location_ir` | 機関リポジトリへの掲載可否 |
| `submitted_location_author` | 著者ウェブサイトへの掲載可否 |
| `submitted_location_funder` | ファンダーリポジトリへの掲載可否 |
| `submitted_location_non_commercial` | 非商用リポジトリへの掲載可否 |
| `submitted_location_others` | その他掲載先 |
| `submitted_terms_notes` | 条件の補足 |

---

## 更新頻度・データソース

- **更新頻度**: 毎日深夜0時（JST）に自動更新
- **データソース**:
  - [SCPJ](https://jpcoar.org/support/scpj/) が管理するスプレッドシート
  - [J-STAGE](https://www.jstage.jst.go.jp/) API（一部フィールドの自動補完）

---

## 運用・開発者向け情報

内部向けのセットアップ手順・運用ガイドは [docs/OPERATIONS.md](docs/OPERATIONS.md) を参照してください。
