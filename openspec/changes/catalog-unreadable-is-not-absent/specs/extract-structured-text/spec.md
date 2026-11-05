## ADDED Requirements

### Requirement: SPEC-READER-EXTRACT-STRUCTURED-TEXT-002 catalog を読めない文書では構造木の読み取りを失敗として申告する

trailer の `/Root` が指す catalog（ISO 32000-2 §7.7.2）を読めないときは、構造木の読み取りを失敗（`code: "INVALID_PDF"`）として扱い、`isTagged: false` と空の `elements` を返さない（SHALL）。文字の観測が成功していれば成功の応答の `scope.textExtraction` を `failed` にし、`isTagged` と `elements` を `null` にする（SHALL）。

#### Scenario: Root が指すオブジェクトが無い

- **WHEN** `/Root` が存在しないオブジェクトを指す文書を渡す
- **THEN** 応答に `isTagged: false` が無い（成功の応答なら `isTagged` は `null` で `scope.textExtraction.status` は `failed`、エラー応答なら `code` は `INVALID_PDF`）
