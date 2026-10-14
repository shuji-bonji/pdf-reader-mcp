# inspect-structure（差分）

## ADDED Requirements

### Requirement: SPEC-READER-INSPECT-STRUCTURE-009 Markdown の Object Statistics は Unreadable の行を 0 のときも出す

Markdown 出力の `## Object Statistics` は、`- **Unreadable**: <数>` の行を `objectStats.unreadable` が `0` のときも出す（SHALL）。行の位置は `- **Streams**:` の次、`- **By COS type**` の前とする（SHALL）。JSON 出力の `objectStats.unreadable` と同じ値を出し、読めなかったものが無いことを「行が無い」ではなく「0」で示す（SHALL）。

#### Scenario: unreadable が 0 でも行がある
- **WHEN** `objectStats.unreadable` が `0` の解析結果を Markdown にする
- **THEN** `- **Unreadable**: 0` の行があり、`- **Streams**:` の行の直後にある

#### Scenario: unreadable が 1 以上なら数を出す
- **WHEN** `objectStats.unreadable` が `3` の解析結果を Markdown にする
- **THEN** `- **Unreadable**: 3` の行がある
