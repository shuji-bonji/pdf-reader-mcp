# pdf-reader-mcp E2E テスト ユースケース・利用シナリオ

## 概要

pdf-spec-mcp のテスト品質レベルに合わせ、**サービス層の直接呼び出し**で
全15ツール × 複数シナリオのE2Eテストを実施する。

---

## UC-1: 基本PDF読み取り (Tier 1)

### 1.1 ページ数取得 (`get_page_count`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| PC-1 | 3ページPDFのページ数 | 3 |
| PC-2 | 空PDFのページ数 | 1 |
| PC-3 | 注釈付きPDFのページ数 | 2 |
| PC-4 | 多フォントPDFのページ数 | 2 |
| PC-5 | 存在しないパス | エラースロー |

### 1.2 メタデータ取得 (`get_metadata`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| MD-1 | simple.pdf のメタデータ | title="Test PDF Document", author="pdf-reader-mcp" |
| MD-2 | empty.pdf のメタデータ | title=null, pageCount=1 |
| MD-3 | annotated.pdf のメタデータ | title="Annotated Test PDF", hasSignatures=true |
| MD-4 | メタデータなしPDF | title/author/subject すべて null |
| MD-5 | pageCount の正確性 | 各フィクスチャで正確 |
| MD-6 | fileSize > 0 | 全フィクスチャで true |

### 1.3 テキスト抽出 (`read_text`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| RT-1 | simple.pdf 全ページ | 3ページ分のテキスト |
| RT-2 | simple.pdf ページ指定 "1" | page=1 のみ |
| RT-3 | simple.pdf ページ範囲 "1-2" | 2ページ分 |
| RT-4 | simple.pdf 複合指定 "1,3" | page 1, 3 のみ |
| RT-5 | empty.pdf | テキストが空 |
| RT-6 | Y座標順序の保証 | "Hello PDF World" が最初 |
| RT-7 | 範囲外ページ | エラーまたは空 |

### 1.4 テキスト検索 (`search_text`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| ST-1 | "Hello" 検索 | page=1 にマッチ |
| ST-2 | "PDF" 検索 (複数マッチ) | 複数ページにマッチ |
| ST-3 | 大文字小文字無視 | "hello" でもマッチ |
| ST-4 | 存在しないクエリ | matches=[] |
| ST-5 | ページ指定検索 "2" | page=2 のみで検索 |
| ST-6 | コンテキスト文字数指定 | contextBefore/After が適切な長さ |
| ST-7 | max_results=1 | 最大1件 |

### 1.5 画像抽出 (`read_images`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| IM-1 | comprehensive_1.pdf | detectedCount > 0 |
| IM-2 | simple.pdf (画像なし) | detectedCount = 0 |
| IM-3 | 抽出画像のプロパティ | width, height, colorSpace, dataBase64 存在 |
| IM-4 | ページ指定抽出 | 指定ページのみ |

### 1.6 サマリー (`summarize`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| SM-1 | simple.pdf | metadata.title, hasText=true, textPreview 非空 |
| SM-2 | empty.pdf | hasText=false |
| SM-3 | comprehensive_1.pdf | imageCount > 0 |

---

## UC-2: 構造解析 (Tier 2)

### 2.1 内部構造 (`inspect_structure`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| IS-1 | simple.pdf | catalog.length > 0, pageTree.totalPages=3 |
| IS-2 | objectStats | totalObjects > 0, streamCount >= 0 |
| IS-3 | pdfVersion 検出 | null でない |
| IS-4 | mediaBoxSamples | A4サイズ (595x842 ± 誤差) |
| IS-5 | 暗号化フラグ | isEncrypted=false |

### 2.2 タグ構造 (`inspect_tags`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| IT-1 | tagged.pdf | isTagged=true, rootTag 非null |
| IT-2 | simple.pdf (非タグ) | isTagged=false |
| IT-3 | roleCounts | Document, P 等のカウント |
| IT-4 | maxDepth | >= 1 |
| IT-5 | totalElements | > 0 |

### 2.3 フォント解析 (`inspect_fonts`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| IF-1 | simple.pdf | Helvetica を含む |
| IF-2 | multi-font.pdf | 3種以上のフォント |
| IF-3 | フォントプロパティ | name, type, pagesUsed が正確 |
| IF-4 | 全ページスキャン | pagesScanned = 総ページ数 |

### 2.4 注釈解析 (`inspect_annotations`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| IA-1 | annotated.pdf | totalAnnotations >= 4 |
| IA-2 | Link 注釈 | hasLinks=true, bySubtype.Link > 0 |
| IA-3 | Widget (フォーム) | hasForms=true |
| IA-4 | Text 注釈 | hasMarkup=true, contents 非null |
| IA-5 | simple.pdf (注釈なし) | totalAnnotations=0 |
| IA-6 | ページ別集計 | byPage[1], byPage[2] 正確 |

### 2.5 署名解析 (`inspect_signatures`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| SG-1 | annotated.pdf | totalFields=1, fieldName="SignatureField1" |
| SG-2 | 未署名フィールド | isSigned=false |
| SG-3 | simple.pdf (署名なし) | totalFields=0 |
| SG-4 | note フィールド | 検証非対応の注意文 |

---

## UC-3: バリデーション & 比較 (Tier 3)

### 3.1 タグ検証 (`validate_tagged`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| VT-1 | tagged.pdf | isTagged=true, totalChecks=8, issues にerrorなし |
| VT-2 | simple.pdf (非タグ) | isTagged=false, failed > 0, TAG-001 error |
| VT-3 | 見出し階層チェック | TAG-004 の検出 |
| VT-4 | summary 生成 | 非空の要約文 |

### 3.2 メタデータ検証 (`validate_metadata`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| VM-1 | simple.pdf | totalChecks=10, title/author ありで passed 多 |
| VM-2 | no-metadata.pdf | failed > 0 (META-001), warnings 多 |
| VM-3 | 各チェックコード | META-001〜META-010 の全コード存在 |
| VM-4 | metadata フラグ | hasTitle, hasAuthor 等の boolean 正確 |

### 3.3 構造比較 (`compare_structure`)

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| CS-1 | simple vs simple | 全プロパティ match |
| CS-2 | simple vs empty | differ 多数 (ページ数等) |
| CS-3 | フォント比較 | onlyInFile1, onlyInFile2, inBoth 正確 |
| CS-4 | summary 生成 | 差異数を含む要約 |

---

## UC-4: 横断的関心事

### 4.1 エラーハンドリング

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| EH-1 | 存在しないファイルパス | エラースロー (File not found) |
| EH-2 | 空文字パス | バリデーションエラー |
| EH-3 | 相対パス | パスバリデーションエラー |
| EH-4 | ".." を含むパス | セキュリティエラー |
| EH-5 | .txt ファイル (非PDF拡張子) | 拡張子バリデーションエラー |
| EH-6 | 壊れたファイル (空バイト) | PDF解析エラー |

### 4.2 パフォーマンスベースライン

| ID | シナリオ | 期待結果 |
|----|---------|---------|
| PF-1 | getMetadata (コールド) | < 2000ms |
| PF-2 | extractText 3ページ | < 3000ms |
| PF-3 | searchText | < 2000ms |
| PF-4 | analyzeStructure | < 2000ms |
| PF-5 | analyzeFonts | < 3000ms |
| PF-6 | validateTagged | < 5000ms |
| PF-7 | validateMetadata | < 3000ms |
| PF-8 | compareStructure | < 5000ms |
| PF-9 | ベースライン回帰 (±20%) | 前回比で劣化なし |

---

## テストフィクスチャ一覧

| ファイル | ページ数 | 特徴 |
|---------|---------|------|
| simple.pdf | 3 | メタデータ完備、検索可能テキスト |
| empty.pdf | 1 | 空白ページ |
| annotated.pdf | 2 | Link/Text注釈、Widget(Sig/Tx)、AcroForm |
| comprehensive_1.pdf | 4 | 画像含む複合PDF |
| tagged.pdf | 2 | タグ付きPDF (Document/P/H1) ← NEW |
| multi-font.pdf | 2 | 複数フォント使用 ← NEW |
| no-metadata.pdf | 1 | メタデータ未設定 ← NEW |
| corrupted.pdf | - | 壊れたPDF (非PDFバイト列) ← NEW |
