# record: inspect-structure-unreadable-line

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）の Phase 1、パイロット 1 件目の記録。書式は計画 §8。数字は手で測った。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-reader-mcp 0.16.0 → 0.16.1 / Claude（claude.ai の Cowork、モデル claude-fable-5-1）/ 2026-10-15（JST） |
| 仕様を書いた時間 | 約 25 分（03:45 に着手、04:10 に `openspec validate --all` と `spec-ids check` が緑）。内訳: spec-init で起こした既存ツール 1 つ（`inspect-structure`、001〜008、既存テスト 12 件に ID を付与）に約 15 分、差分 009 と proposal / design / tasks に約 10 分 |
| 人が判断した箇所 | (1) パイロットの対象の差し替え。計画は Issue #16 / #17 を予定していたが、どちらも 0.9.0（2026-07-19）で修正・クローズ済みだった（計画時に読んだ Issue 一覧が古かった）。open の Issue は 0 件で、残っていた不整合（Markdown の `Unreadable` 行）に替えた。(2) `approved` と `pr`（E）はこの記録の時点では未記入 |
| 仕様と実装のずれ | 0 件（差分 009 は 1 か所の `if` を外すだけで、受入テストは先に 0 の側だけ落ち、実装後に全 502 件が通った） |
| エージェントが仕様に無い振る舞いを実装した件数 | 0 件。ただし仕様の外で 1 件直した: `openspec/config.yaml` の `rules` の項目に `approved: と pr: は` の形があり、YAML の入れ子の写像と読まれて `openspec instructions` が「could not parse」と警告し、`context` と `rules` を丸ごと捨てていた（導入 PR #31 では気づいていない）。項目を引用符で囲んで直した |
| 実装後に仕様を読み返した回数 | 0 回（同じセッション内で完結） |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| やめるときに残るもの | `openspec/specs/inspect-structure/spec.md` は front matter（`spec_id` / `kind` / `introduced_by`）と `### Requirement: SPEC-…` の見出しを持つので、`specs/current/inspect-structure/spec.md` に置き直せば spec-ids の specs レイアウトでそのまま検査できる。archive 後の `openspec/changes/archive/2026-10-15-inspect-structure-unreadable-line/` は `specs/releases/<tag>/inspect-structure-unreadable-line/` に写せる |

## 計画 §9 で確かめたこと

| # | 結果 |
| --- | --- |
| 2 | `/opsx:propose` は使わず、`npx openspec instructions proposal --change …` の出力（`config.yaml` の `context` と `rules` が `<project_context>` / `<rules>` として入る）を読んで手で書いた。`rules.specs` の見出しの形は守れた。`config.yaml` を直す前は `rules` が注入されていなかった（上記） |
| 3 | proposal.md の先頭の front matter は `openspec validate --all` で通る（テンプレートは手で書く分には上書きしない） |
| 7 | 既存テスト名への ID 付与だけの変更で、`npm test`（502 件）は通った。`ci.yml` の緑は PR で確かめる |
| 8 | 日本語の Scenario 名をテスト名にして、`vitest run -t "unreadable が 0 でも行がある"` で 1 件に絞れた |

## 置き場の注意

- `openspec new change` は `openspec/changes/<slug>/.openspec.yaml`（schema 名と作成日時）を作る（1.14.1）。archive でそのまま残る。仕様ではない。
