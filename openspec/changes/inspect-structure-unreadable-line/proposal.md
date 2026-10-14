---
approved: 2026-10-15
pr: 32
implementation: required
targets: [inspect-structure]
---

# Proposal

## Why

`inspect_structure` の Markdown 出力は、読めなかった間接オブジェクトの数（`objectStats.unreadable`）を、0 のときは行ごと出しません。JSON 出力は常に `unreadable` の欄を持ち、既存の受入テスト IS-2d も「0 は観測した答えであって、観測していないのではない」として欄が在ることを固定しています。Markdown だけが「欠けたときだけ現れる行」になっていて、同じ観測が出力形式で違う顔をしています（family の型 `formatScopeLines` は、全部読めたときも行を出します）。

PDF family への OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31` §6）のパイロットとして、この小さな変更で「提案 → 仕様 → 実装 → archive → 記録」を 1 本の PR で通します。

## What Changes

- `inspect_structure` の Markdown 出力の `## Object Statistics` に、`- **Unreadable**: <数>` の行を `unreadable` が 0 のときも出す。
- JSON 出力・`objectStats` の数え方・他の行の並びは変えない。

### 変わる振る舞い

- Markdown の `## Object Statistics` が、`Total Objects`・`Streams`・`Unreadable`・`By COS type`（・`By /Type`）の順で、`Unreadable` を常に含む。

### 変わらない振る舞い

- JSON 出力（`objectStats.unreadable` は従来から常にある）。
- `unreadable` が 1 以上のときの Markdown の行の形（`- **Unreadable**: 3`）。
- `inspect_structure` の他の節（Catalog Entries / Page Tree / Properties / Note）。

### 対象外

- `unreadable` の内訳（どのオブジェクト番号が読めなかったか）を出すこと。
- 他ツール（`inspect_catalog` の `(N unreadable)` など）の表記の統一。

### 人が判断すること

- この行を常に出すか（「0 のときは出さない」ほうが読みやすいという判断もあり得る）。承認は proposal.md の front matter に書く。
- 初版起こし（`openspec/specs/inspect-structure/spec.md` の 001〜008）が既存テストの範囲を正しく写しているか。

## Capabilities

### New Capabilities

- `inspect-structure`: `inspect_structure` ツールの応答（目録・ページ木・オブジェクトの数え上げ・版・暗号化の有無）と Markdown 表示。初版はこの変更で、既存テスト（`tests/e2e/04-tier2-structure.test.ts` の IS-\*、`tests/tier1/structure-service.test.ts`）が固定している振る舞いを 001〜008 として起こす（期待値は変えない）。

### Modified Capabilities

- なし（初版の 001〜008 はこの変更で起こし、009 を ADDED として足す）。

## Impact

- `src/utils/formatter.ts` の `formatStructureMarkdown`（1 か所の `if` を外す）。
- `tests/tier1/utils.test.ts` に Markdown の受入テストを足す。既存テストは名前に仕様 ID を足すだけ。
- 破壊的変更ではない（行が 1 本増えるだけ）。CHANGELOG と版（patch）。
