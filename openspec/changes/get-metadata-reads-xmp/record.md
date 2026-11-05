# record: get-metadata-reads-xmp

計画 §8 の書式。時刻は JST。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids（`npx spec-ids`）/ pdf-reader-mcp 0.19.0 → 0.20.0 の予定（版は人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-05 |
| PR の切り方 | 4 件の変更を 1 本（計画 §6.3）。ブランチ `fix/reader-0.20.0`。提案の commit（15:55）の前に、人がチャットで方針を選んだ（15:50）。`approved`・`pr` の記入と archive は PR を出した後に行う |
| きっかけ | #42（pdf-agent-stack#47 の試用 E4 の UC03、所見 F-26） |
| 仕様を書いた時間 | 約 10 分（按分。§14.3.3 と Table 349 を pdf-spec-mcp で確かめた時間を含む） |
| 実装した時間 | 約 10 分（16:34〜16:37 の commit まで。検体の組み立て関数と受入テストを含む） |
| 人が判断した箇所 | (1) 版で優先を変える（PDF 2.0 以降は XMP、1.x は文書情報辞書）。(2) 項目ごとの出どころと食い違いを返す。(3) 日付は書かれた形のまま返す |
| 仕様と実装のずれ | 0 件 |
| エージェントが仕様に無い振る舞いを実装した件数 | 1 件。空の値（`Title ()` など）は無いものとして扱い、出どころにも食い違いにも数えない（pdfjs の `info` が空文字を返すのを `asStringOrNull` が既に `null` にしていた振る舞いを、XMP 側にもそろえた） |
| 実装後に仕様を読み返した回数 | 0 回 |
| テスト | `tests/e2e/22-get-metadata-xmp.test.ts`（10 件）。変更前の `src/` で 10 件とも落ちた（最後の 1 件は `metadataSources` が無いので落ちる） |
| 維持の手間 | 0 |

## 分かったこと

1. **pdfjs の XMP の解析は使えなかった。** `getMetadata().metadata` は `dc:title` の `rdf:Alt` を区切りなしでつなぎ（「請求書 INV-2026-0915Invoice」）、属性の形の `xmp:CreatorTool` を読まない。reader の `xmp-service.ts` の読み方（名前空間を URI で引く・属性と要素の両方を見る）を伸ばした。
2. **pdfjs の `PDFFormatVersion` は、catalog の `/Version` があればヘッダーより古くてもそれを返す**（§7.2.2 は「ヘッダーより新しければ」）。版で優先を決める判定はこの値を使っている。design.md に書いた。
3. **§14.3.3 は PDF 2.0 でも `CreationDate`・`ModDate` を非推奨にしていない。** 2 項目も XMP を先にしたが、2 項目だけ文書情報辞書を先にする案もあると proposal に書いた。
