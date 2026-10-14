# Tasks

## 1. 初版起こし（spec-init 相当・期待値は変えない）

- [x] 1.1 `openspec/specs/inspect-structure/spec.md` に 001〜008 を、既存テストが固定している振る舞いから起こす（`introduced_by: inspect-structure-unreadable-line`）
- [x] 1.2 既存テスト名に仕様 ID を足す（`tests/e2e/04-tier2-structure.test.ts` の IS-*、`tests/tier1/structure-service.test.ts` の `resolvePdfVersion`）。期待値は変えない

## 2. 受入テスト（先に落ちることを確かめる）

- [x] 2.1 `tests/tier1/utils.test.ts` に `describe('formatStructureMarkdown')` を足し、`it('SPEC-READER-INSPECT-STRUCTURE-009 unreadable が 0 でも行がある')` と `it('SPEC-READER-INSPECT-STRUCTURE-009 unreadable が 1 以上なら数を出す')` を書く
- [x] 2.2 `npx vitest run tests/tier1/utils.test.ts` で、0 の側だけが落ちることを確かめる

## 3. 実装

- [x] 3.1 `src/utils/formatter.ts` の `formatStructureMarkdown` で `if (analysis.objectStats.unreadable > 0)` を外し、`Unreadable` の行を常に出す
- [x] 3.2 `npm test` と `npm run check` と `npm run typecheck` が通る

## 4. 版と記録

- [ ] 4.1 `CHANGELOG.md`（英語）に書く（済み）。版は人がマージ後に `npm version patch`（フックが plugin.json と server.json も揃える）で 0.16.1 にする
- [x] 4.2 `openspec/changes/inspect-structure-unreadable-line/record.md` を計画 §8 の書式で書く（版・かかった時間・人が判断した箇所・仕様と実装のずれ・読み返した回数）

## 5. 承認と取り込み（人が判断する）

- [ ] 5.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 5.2 `npx openspec archive inspect-structure-unreadable-line --yes` で `openspec/specs/inspect-structure/spec.md` に 009 を取り込む
- [ ] 5.3 `npx openspec validate --all && npx spec-ids check` が通る
