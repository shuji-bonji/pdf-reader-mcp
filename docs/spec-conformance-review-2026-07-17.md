# pdf-reader-mcp 仕様適合レビュー（pdf-spec-mcp 照合）

- 実施日: 2026-07-17
- 対象: pdf-reader-mcp v0.6.3（src/ 全15ツール + services 3ファイル）
- 照合仕様: ISO 32000-2:2020 (EC3) / ISO 14289-1:2014 (PDF/UA-1) — いずれも pdf-spec-mcp で原文取得
- 手法: 静的照合（条項 ⇔ 実装）＋ 動的検証（pdf-writer-mcp 生成のタグ付きPDFで実ツール実行、正規表現の単体実行、PDFバイナリの展開確認）

## 総評

15ツール中、tier1（read_text / search_text / get_page_count / get_metadata / summarize / read_url / read_images）は座標ベースの抽出が主体で仕様逸脱はほぼなし（read_images を除く）。tier2/3 の仕様依存部分は概ね正しい設計だが、**High 2件・Medium 3件・Low 3件**の逸脱を確認した。うち2件は実PDFで誤動作を実証済み。

| 区分 | 件数 | 概要 |
|------|------|------|
| High | 2 | Type0フォントの埋め込み誤判定（実証済み）、ImageKind 誤マッピング |
| Medium | 3 | PDF日付正規表現バグ（実証済み）、markup注釈の分類誤り、PDF/UA メタデータ検査が Info 辞書依存 |
| Low | 3 | Figure の Alt 未検査、見出し順序未検査、/Version 優先規則 |

---

## High-1: inspect_fonts — Type0（CID）フォントの埋め込み判定が常に false 【実証済み】

**実装** (`src/services/pdflib-service.ts` `analyzeFontsWithPdfLibImpl`): ページリソースの Font 辞書（Type0 の場合はコンポジットフォント辞書そのもの）に対して `FontDescriptor` の有無を調べ、`FontFile`/`FontFile2`/`FontFile3` で埋め込み判定している。

**仕様**: Type0 フォント辞書（ISO 32000-2 Table 119）には FontDescriptor エントリが存在しない。FontDescriptor は **DescendantFonts の CIDFont 辞書**側にあり、CIDFont 辞書では「(Required; shall be an indirect reference)」（ISO 32000-2 §9.7.4.1 Table 116）。

**実証**: pdf-writer-mcp v0.8.0 で NotoSansJP（Type0 / Identity-H / CIDFontType2）を埋め込んだ PDF を生成し、qpdf でオブジェクトストリームを展開して `/FontFile2` の存在（=埋め込み済み）を確認したうえで inspect_fonts を実行:

```json
{ "name": "NotoSansJP-Regular-2708", "type": "Type0",
  "encoding": "Identity-H", "isEmbedded": false }   // ← 誤り（実際は埋め込み済み）
```

**影響**: 日本語 PDF はほぼすべて Type0 フォントであり、「PDF/A・PDF/X 向けの埋め込み確認」というツールの主要ユースケース（ツール説明に明記）で誤判定する。

**修正案**: `Subtype == Type0` の場合は `DescendantFonts[0]` を解決し、その CIDFont 辞書の FontDescriptor を参照する。

## High-2: read_images — pdfjs ImageKind の誤マッピング

**実装** (`src/services/pdfjs-service.ts` `extractImages`):

```ts
const colorSpace = imgData.kind === 1 ? 'RGB' : imgData.kind === 2 ? 'RGBA' : 'Grayscale';
bitsPerComponent: 8,
```

**正** (pdfjs-dist `ImageKind`、node_modules 実物で確認): `GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3`。

つまり kind=1 は Grayscale(1bpp)、kind=2 が RGB、kind=3 が RGBA。現行実装は3値ともずれており、`bitsPerComponent: 8` 固定も kind=1（1bpp）では誤り。これは PDF 仕様（§8.9 の ColorSpace/BitsPerComponent）を報告する値が pdfjs API の誤読で崩れているもの。

## Medium-1: isValidPdfDate — 文字クラスの範囲指定バグ ＋ 有効形式の拒否 【実証済み】

**実装** (`src/services/validation-service.ts`):

```ts
/^D:\d{4}(...([+-Z](\d{2}'\d{2}'?)?)?...)?$/
```

**仕様** (ISO 32000-2 §7.9.4): 形式は `D:YYYYMMDDHHmmSSOHH'mm`（PDF 2.0 では末尾アポストロフィなし。1.7 形式の末尾 `'` 許容は妥当な寛容）。

- 「O は PLUS SIGN (+), HYPHEN-MINUS (-), LATIN CAPITAL LETTER Z のいずれか」
- 「APOSTROPHE は HH フィールドが存在する場合のみ」「mm オフセットは APOSTROPHE が存在する場合のみ」→ `HH'`（分なし）は有効

**バグ1**: `[+-Z]` は正規表現では `+`(U+002B)〜`Z`(U+005A) の**範囲**となり、`,-./0-9:;<=>?@A-Z` をすべて受理する。
**バグ2**: `(\d{2}'\d{2}'?)?` は HH と mm を不可分にしており、有効な `D:...-09'` を拒否する。

**実証**（サンドボックスで実行）:

| 入力 | 仕様上 | 実装の判定 |
|------|--------|-----------|
| `D:20241231235959+09'00` | 有効 (2.0形式) | ✅ true |
| `D:20241231235959A09'00` | 無効 (O=A) | ❌ true |
| `D:202412312359595` | 無効 (O=数字) | ❌ true |
| `D:20241231235959-09'` | 有効 (mm省略) | ❌ false |

**修正案**: `[+\-Z](\d{2}'(\d{2}'?)?)?`（さらに厳密には `Z` 時のオフセット扱い、月01–12等の値域検査も検討）。

## Medium-2: inspect_annotations — markup 注釈の分類が Table 172 / §12.5.6.2 と不一致

**実装** (`pdfjs-service.ts` `analyzeAnnotations` の `markupSubtypes`): `Popup` を markup に含め、`FileAttachment`・`Sound`・`Projection` を含めていない。

**仕様** (ISO 32000-2 §12.5.6.2): markup 注釈は free text, text, line, square, circle, polygon, polyline, highlight, underline, squiggly, strikeout, rubber stamp, caret, ink, **file attachment**, **sound**, **projection**（＋redaction）。一方、

> "The remaining annotation types are not considered markup annotations: • The popup annotation type shall not appear by itself; it shall be associated with a markup annotation…"

と **Popup は markup ではない**と明記されている。

**修正案**: `Popup` を除外し、`FileAttachment` / `Sound` / `Projection` を追加。

## Medium-3: validate_metadata — PDF/UA 要件の検査対象が Info 辞書のみ

**実装**: `getMetadata()`（pdfjs `getMetadata().info` = **Info 辞書**）の Title 有無を「PDF/UA・PDF/A に必須」として error 判定。XMP・ViewerPreferences は未検査。

**仕様** (PDF/UA-1 §7.1):

> "The Metadata stream in the document's catalog dictionary shall contain a **dc:title** entry … A document information dictionary may be present in a conforming file and an ISO 14289-1 conforming reader **shall ignore it**."
> "The ViewerPreferences dictionary … shall be present and shall contain at least the key **DisplayDocTitle** with a value of **true**."
> "Files claiming conformance … shall have a **Suspects** value of false."

つまり PDF/UA の根拠でタイトルを検査するなら見るべきは **XMP の dc:title** であり、Info 辞書は根拠にならない（PDF 2.0 では Info 辞書自体が CreationDate/ModDate を除き非推奨 — ISO 32000-2 §14.3.3）。DisplayDocTitle・Suspects も必須要件だが未検査。

なお動的検証では、pdf-writer 生成 PDF に `/ViewerPreferences /DisplayDocTitle true` と XMP が存在するのに、validate_metadata はどちらにも言及しなかった（検査していないため）。

**修正案**: pdfjs `getMetadata().metadata`（XMP）から `dc:title` を読む。カタログの ViewerPreferences/DisplayDocTitle、MarkInfo/Suspects チェックを追加（META-011/012 として）。Info Title の有無は「一般的ベストプラクティス」に降格。

## Low-1: validate_tagged TAG-005 — Figure の Alt/ActualText 未検査

**仕様** (PDF/UA-1 §7.3): "Figure tags **shall** include an alternative representation or replacement text…"

**実装**: Figure タグ数と画像数の比較のみで、`/Alt` の有無は見ていない（ファイル冒頭コメントの "Figure tags have content (potential alt text)" は実態と乖離）。pdf.js の `getStructTree()` はノードに `alt` プロパティを公開しているため実装可能。

## Low-2: validate_tagged TAG-004 — 見出し検査が「存在集合」ベース

**仕様** (PDF/UA-1 §7.4.2): "If any heading tags are used, **H1 shall be the first**." / "…such a sequence shall proceed in strict numerical order and shall not skip an intervening heading level."（§7.4.4: 文書は strongly / weakly structured の**どちらか一方**、すなわち H と H1..Hn の混在不可）

**実装**: roleCounts に存在するレベルの集合だけを見ており、(a) 文書内の**出現順**（H1 が最初か、降下時の飛び級か）は判定できない。(b) H と H1..Hn の混在も未検査（generic H があると無条件 pass）。集合ベースの飛び級検出自体は近似として妥当なので、severity=warning の扱いは適切。

## Low-3: analyzeStructure — /Version をヘッダ版数と比較せず無条件優先

**仕様** (ISO 32000-2 §7.7.2 Table 29 Version): カタログの Version は「ファイルヘッダの版より**後の版である場合**の適合版数」。ヘッダの方が後、またはエントリ不在ならヘッダ版数に従う。

**実装**: catalog /Version があれば無条件でそれを返す。実害は小さいが、比較して大きい方を採る方が正確。

---

## 適合を確認した点（主要）

| 実装箇所 | 仕様 | 判定 |
|----------|------|------|
| isTagged = `MarkInfo/Marked === true` | ISO 32000-2 §14.7.2 / §7.7.2 | ✅ |
| サブセット判定 `^[A-Z]{6}\+` | §9.9.2 "The tag shall consist of exactly six uppercase letters" + `+` | ✅ 正確 |
| 埋め込み判定キー FontFile/FontFile2/FontFile3 | §9.8.2 Table 121 | ✅（探索場所のみ High-1 の問題）|
| 署名: FT==Sig、V 有無で署名済み、Name/M/Location/Reason/ContactInfo/Filter/SubFilter 抽出 | §12.7.5.5 / §12.8.1 Table 255 | ✅（暗号検証をしない旨の note 明示も適切 — pdf-verify-mcp との役割分担どおり）|
| 日付検証が PDF 2.0 形式（末尾 `'` なし）を受理 | §7.9.4（EC3 で末尾 `'` 削除）| ✅（1.7形式の許容も妥当な寛容）|
| TH 欠如を warning | PDF/UA-1 §7.5 "Tables **should** include headers" | ✅ severity 適切 |
| extract_tables の Artifact 除外 | PDF/UA-1 §7.1（artifact は実コンテンツ外）| ✅ |
| Table/THead/TBody/TFoot/TR/TH/TD の走査、TR 直下許容 | ISO 32000-2 §14.8.4 標準構造型 | ✅ |
| checkSignatures の先頭5ページ制限 | — | ✅ 制限をコード/コメントに明記し inspect_signatures へ誘導（誠実な設計）|
| Document ルートタグ欠如を warning 止まり | PDF/UA-1 は Document ルートを必須とせず（必須化は PDF/UA-2）| ✅ |

## 動的検証ログ（要約）

1. pdf-writer-mcp v0.8.0 で `tagged: true` の日本語 PDF を生成（H1/H2/H3、表、NotoSansJP）。
2. `validate_tagged`: 8/8 pass — 実際のタグ構成（H1/H2/H3、Table/TR/TH/TD）と整合 ✅（※ Markdown の `####` は writer 側が H3 に正規化しており、飛び級ケースは今回動的に再現せず）
3. `validate_metadata`: 8/10 pass — Info 辞書ベースの判定として一貫。XMP/DisplayDocTitle はファイルに存在するが未検査（Medium-3）。
4. `inspect_fonts`: `isEmbedded: false` — qpdf 展開で `/FontFile2` 存在を確認済みのため誤判定（High-1）。
5. `isValidPdfDate` 正規表現の単体実行 — 上表のとおり誤受理2件・誤拒否1件（Medium-1）。

## 推奨対応順

1. High-1（Type0 埋め込み判定）— 日本語 PDF での主要ユースケースに直撃。DescendantFonts 解決を追加。
2. High-2（ImageKind）— 3行修正で直る。
3. Medium-1（日付正規表現）— `[+\-Z]` へ1文字修正＋mm 省略許容。テストケースは本レポートの表を流用可。
4. Medium-2（markup 分類）— セット定義の修正のみ。
5. Medium-3 / Low-1 — validate 系の PDF/UA 検査強化（dc:title, DisplayDocTitle, Suspects, Figure/Alt）。veraPDF（pdf-verify-mcp）との役割分担上、「簡易プリフライト」の位置づけを README に明記するのも選択肢。

---

*照合根拠はすべて pdf-spec-mcp（iso32000-2 EC3 / pdfua1）から取得した原文による。*
