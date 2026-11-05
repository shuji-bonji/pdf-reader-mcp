## ADDED Requirements

### Requirement: SPEC-READER-RENDER-PAGE-002 成功応答に描画した範囲を申告する

`render_page` の成功応答の本文の最初に、family 共通の見出し `## Scope of this reading` の節を置き、頼まれたページ、描画したページ、描画しなかったページとその理由を書く（SHALL）。全ページを描画できたときも、この節を出す（SHALL）。画像の返し方は変えない。

#### Scenario: 全ページを描画したときも射程の節を出す

- **WHEN** 1 ページの文書の 1 ページ目の描画を頼み、描画できる
- **THEN** 本文に `## Scope of this reading` があり、頼まれたページ 1 と描画したページ 1 を書いている

#### Scenario: 描画しなかったページを射程の節に書く

- **WHEN** 応答の予算を越えて、頼まれたページの一部を描画しない
- **THEN** 射程の節に、描画しなかったページの番号と理由がある
