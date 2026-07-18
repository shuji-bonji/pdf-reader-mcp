# specs/08（M-8 = `extract_structured_text`）レビュー

- 実施日: 2026-07-18
- 対象: `Document-Note/mcps/PDFfamily/specs/08-structured-text-and-reflow.md`（Draft v0.1）
- 照合仕様: ISO 32000-2:2020 — すべて pdf-spec-mcp で原文取得
- 手法: 条文照合 ＋ **実測**（writer v0.13.0 で 2 ページのタグ付き日本語 PDF を生成し、走査方式を比較）

## 総評

**提案の方向は正しい。条文の引用も概ね正確**（§14.8.1 / §14.8.2.5 / §14.8.2.6.2 は原文どおり）。
ただし **§3 の「実装は `extract_tables` の一般化」は誤り**で、そのまま実装すると
**ツールの目的（logical content order）を達成できない**。実測で確認済み。

| 区分 | 件数 | 概要 |
|------|------|------|
| 🔴 High | 2 | 走査方式が logical content order を出せない（実証済み）／ ActualText と Alt の混同 |
| 🟡 Medium | 3 | 要素の `page` は単数にできない／CJK に元レイアウトの空白が混入（実証済み）／`Lbl` と `LBody` の未分離 |
| 🟢 Low | 2 | より直接的な条文根拠がある／出力の階層が失われる |

---

## High-1: 「`extract_tables` の一般化」では logical content order を出せない【実証済み】

**提案** (§3): 「実装は `extract_tables`（`validation-service.ts` / `pdfjs-service.ts`）の一般化」

**問題**: `extract_tables` は **`page.getStructTree()`（ページ単位 API）をページ順に併合**している
（`pdfjs-service.ts:602, 710`）。一方 §14.8.2.5 は logical content order をこう定義する:

> Logical content order – the ordering for semantic purposes – **shall be defined by a depth-first
> traversal of the document's logical structure hierarchy**.

**document の** 構造階層であって、ページごとの木ではない。しかも同項 NOTE 2 は明示する:

> • A logical object **can extend over more than one PDF page**, such as in the case of a headline
> spanning two pages in a facing pages layout.

**実証**: writer v0.13.0 で 2 ページのタグ付き日本語 PDF（見出し・表・リストを含む）を生成し比較:

| | A: StructTreeRoot 深さ優先（条文の定義） | B: ページ単位を併合（現行方式） |
|---|---|---|
| `Document` | **1 つ** | **2 つ**（ページごとに複製） |
| `L`（リスト） | **1 つ**（`LI` 2 個） | **2 つに分裂**（各 `LI` 1 個ずつ） |

**ページを跨ぐ単一の `L` が、2 つの別リストとして報告される。** 段落が改ページを跨げば同様に
`P` が 2 つに割れ、**リフロー後の文書に本文の途中で段落境界が生まれる**（内容の破損）。
pdfjs の構造ノードは要素の識別子を持たない（`role` + `children` のみ）ため、
**併合後にページ 1 の `L` とページ 2 の `L` が同一要素だと復元する手段が無い。**

**修正案（実現可能性を実証済み）**: **カタログの `StructTreeRoot` を pdf-lib で深さ優先に走査し、
MCID を pdfjs のテキストに橋渡しする。**

```
StructTreeRoot（pdf-lib）で真の論理順と要素の同一性を得る
        │  各 MCR の /Pg（ページの参照）+ /MCID
        ↓
pdfjs の marked-content id  =  p{/Pg のオブジェクト番号}R_mc{MCID}
        ↓
既存の buildIdToTextMap（id → テキスト）でテキストを引く
```

**実測した id 形式**（`p{objNum}R_mc{mcid}`）:

| StructTreeRoot 側 | pdfjs 側 |
|---|---|
| `MCID=38  /Pg=7 0 R` | `p7R_mc38` |
| `MCID=0   /Pg=30 0 R` | `p30R_mc0` |

この 2 つの MCR が**同一の `L` 要素の配下**にあることが、ページを跨ぐ証拠であり、
StructTreeRoot を歩けばそれが保たれる。素の node 約 80 行で以下を得た（正しい論理順・
ページ跨ぎの `L` が 1 つに統合されている）:

```
Document
  H1: 「四半期報告書」
  H2: 「第1節 概要」
  P:  「当四半期の売上は…」
  H2: 「第2節 財務」
  Table
    TR → TH「項目」/ TH「金額」
    TR → TD「売上」/ TD「100」
  H2: 「第3節 リスク」
  L
    LI: 「人員の確保」   ← ページ 1
    LI: 「為替の変動」   ← ページ 2  ★同じ L の配下に統合されている
  H2: 「第4節 見通し」
  P:  「次四半期も同水準を見込みます。」
```

**reader は pdf-lib と pdfjs の両方を持つ**ため、この構成は追加依存なしで成立する。
むしろ family の役割分担に忠実（構造は pdf-lib、テキストは pdfjs）。

**副次的な利得**: 同じ walker で **`inspect_tags` の疑似ノード問題（TASKS C-1）も解消できる**。
C-1 は「`validate_tagged` は deprecate するので放置でよい」と結論したが、
**`inspect_tags` は存続ツールであり同じ欠陥を持つ**（実際 2 ページの文書で `Root` を 2 つ返す）。
「構造ツリーの報告は事実であり reader の責務」（TASKS B-1）と言う以上、報告する木は
**合成物ではなく実物**であるべき。M-8 の walker はその手段になる。

## High-2: `ActualText` と `Alt` を同一視している

**提案** (§3): 「`ActualText` / `Alt` があればそれを優先（§14.9.4 / §14.9.3）」

**問題**: 条文は両者を**明確に区別**しており、混ぜると意味が壊れる。

| | 用途 | 条文 | 連続時の語区切り |
|---|---|---|---|
| `ActualText` | テキストにはなるが**表現が非標準**（合字・ハイフネーション） | 「shall be used as a **replacement, not a description**」「**character substitution**」 | 「**no word break** is present between them」 |
| `Alt` | **テキストにならない**もの（画像・数式） | 「alternate descriptions for images, formulas, or other items that **do not translate naturally into text**」「**whole word or phrase** substitution」 | 「**a word break** is present between them」 |

§14.9.4 NOTE 2 が念を押している:

> The treatment of ActualText as a **character replacement** is different from the treatment of Alt,
> which is treated as a **whole word or phrase substitution**.

**具体的な害**: `Figure` の `Alt="売上グラフ"` を `text` として出すと、**説明文が本文として**
リフロー後の文書に流し込まれる。Alt は「内容」ではなく「内容の説明」である。

**修正案**:

- `text` = `ActualText`（あれば）→ 無ければ抽出したグリフのテキスト。**ActualText は置換**
- `alt` = 別フィールドとして報告（提案の JSON 例は既に `"alt": null` を持っており、こちらは正しい。
  誤っているのは §3 の散文のみ）
- 連結時の語区切り規則が**逆**である点を実装に落とす（ActualText 連続 → 区切り無し、
  Alt 連続 → 区切りあり）

## Medium-1: 要素の `page` は単数にできない

**提案** (§3): `{ "role": "H1", "text": "…", "page": 1 }`

**問題**: High-1 と同根。§14.8.2.5 NOTE 2 が「A logical object can extend over more than one PDF
page」と明示しており、**実測でも `L` が 2 ページに跨った**。単一の `page` では表現できない。

**修正案**: `"pages": [1, 2]`（出現順）。単数が欲しい用途には先頭ページを別途与えるか、
利用側で `pages[0]` を取らせる。

## Medium-2: CJK に元レイアウトの空白が混入する【実証済み】

**実証**: 上記の走査で得た日本語の `P` にこうなる箇所がある:

```
「…埋め草を大量 に含みます。段落を重ねて改ページを起 こします。…」
                ↑ 原文に無い空白           ↑ 同じ
```

**原因**: `buildIdToTextMap` が `item.hasEOL ? ' ' : item.str`（`pdfjs-service.ts:793`）とし、
**元レイアウトの行末に空白を挿入している**。

**なぜ問題か**: §14.8.2.6.2 が空白の存在を **shall** で保証するのは
「any white-space characters that **would be present to separate words in a pure text
representation**」——**日本語には単語間の空白が無い**ので、この保証は空振りする。同項も
「a word is defined by **script and context**」と述べている。つまりこの空白は文書由来ではなく
**こちらが足している**。

しかもこれは specs/08 §1 が強調する原則（「リフロー = 元レイアウトの再現ではなく論理順序を
保った新規レイアウト。**元の折り返し規則は不要**」）に真っ向から反する。
**元の折り返し位置が本文に焼き付く。**

**現況**: reader は既に `compactCellText` に CJK 用の畳み込みを持つ（`pdfjs-service.ts:902`）が、
`(?:CJK ){2,}CJK` = **2 回以上の繰り返し**が要り、行末の**単発の空白は畳まれない**。
`extract_tables` で顕在化しなかったのはセルが折り返さないため。

**修正案**: `hasEOL` の扱いを CJK 対応にする（前後が CJK なら空白を入れない）。
**これは M-8 固有ではなく `extract_tables` にも既にある欠陥**なので、共通化して両方を直す。

## Medium-3: `Lbl` と `LBody` が分離されていない

**実証**: `LI` のテキストが `「• 人員の確保」` となり、**行頭記号が本文に混入**する。
`•` は `Lbl`（ラベル）の内容であって `LBody`（本文）ではない。

**なぜ問題か**: リフロー経路は Markdown を経て `create_markdown_pdf` に渡る。
Skill が `- ` を付け直すと **`- • 人員の確保`** になる。

**修正案**: 提案の JSON 例 `{ "role": "LI", "text": "人員の確保" }` は `Lbl` を含まない形なので
**意図は正しい**。`Lbl` を除外（または `label` として別フィールドに）することを明記する。
番号付きリストでは `Lbl` が「1.」等になるため、**捨てるか残すかは Skill 層の判断材料として
別フィールドで渡すのが安全**。

## Low-1: より直接的な条文根拠がある

**提案** (§1) は §14.8.1 の **reflow** を根拠にしているが、同じ NOTE にはもっと直接的な項目がある:

> Tagged PDF is intended for use by tools that perform operations such as:
> • **Extraction of text and graphics for pasting into other applications**
> • …
> • **Conversion to other common file formats (such as HTML, XML, and RTF) with document
>   structure preserved**

**「構造を保ったままの抽出・変換」は `extract_structured_text` そのもの**であり、
リフロー（下流の Skill/writer の仕事）より本ツールの説明に適する。
なお §14.8.1 のこれらは **NOTE（参考）**であり shall ではない点は正確に扱うべき
（「意図された用途として明記されている」は正しいが、「規格が要求している」ではない）。

## Low-2: 出力の階層が失われる

**提案** (§3) は `elements` を**フラットな配列**にしつつ、`Table` の `rows` と `L` の `items` だけ
入れ子にしている。基準が場当たり的で、実際の構造木は `Sect > H1 + P…` のように任意の深さを持つ。

**論点**: リフロー用途（Markdown 化）にはフラットで足りる。しかし
「構造ツリーの報告は reader の責務」（TASKS B-1）に照らすと、**階層を捨てるのは観測の欠落**。

**選択肢**:
1. フラット（リフロー特化・単純・Skill が使いやすい）
2. 入れ子（忠実・`inspect_tags` と同形・利用側が再帰を書く必要）
3. フラット + `depth` フィールド（折衷。順序と深さの両方が復元でき、実装も単純）

**推奨は 3**。実測スクリプトはこれで十分に読める出力を得た。

---

## 前提条件（§6）の現況 — ほぼ解消済み

| 課題 | specs/08 での位置づけ | 現況 |
|---|---|---|
| writer **B-10**（ページ操作が構造木を黙って破棄） | 🔴 最優先 | ✅ **v0.13.0 で完了**（B-10a/b） |
| reader **#12**（Biome 版の三者不整合） | 地ならし | ✅ **v0.7.0 で完了**（A-1・2.5.4 固定） |
| reader **#13 High-1**（Type0 埋め込み誤判定） | 同一ファイル・先に消化 | ✅ **v0.7.0 で完了**（D-1） |
| verify **#4**（AI 判定の非決定性） | §5-1 の分担判断 | ⬜ 未着手。ただし §5-1 が自ら
「構造木が『これは H1』と決めるので LLM の判断は介在しない」と論じており、**M-8 の障害ではない** |

**着手可能**。なお v0.7.0 で **D-9（`read_images` が 1 枚も抽出できない）**という
specs/08 の想定外の High も潰れており、`pdfjs-service.ts` の地ならしは想定より進んだ。

## 未決定事項（§5）への回答

1. **Skill か ルールエンジンか** → §5-1 の論（構造由来の情報に #4 の懸念は当たらない）に同意。
   **M-8 の設計判断としては不要**。ツールは観測を返すだけで判定しない
2. **再生成で失われるもの** → Skill 層の責務。**ただし M-8 側も `pages` を返すことで
   「元は何ページだったか」を Skill が説明に使える**（Medium-1 の副次的な利得）
3. **Skill の所在** → M-8 の実装には影響しない。**後回しでよい**
4. **実装順序** → 前提はすべて解消済み（上表）

## 実装前に決めるべきこと（本レビューが追加する論点）

| # | 論点 | 推奨 |
|---|---|---|
| 1 | **走査方式** | **StructTreeRoot 走査**（High-1）。`extract_tables` の一般化は不可 |
| 2 | 出力の階層 | フラット + `depth`（Low-2） |
| 3 | `ActualText` / `Alt` | 別フィールド。`text` は ActualText 優先（High-2） |
| 4 | `Lbl` | 別フィールド `label`（Medium-3） |
| 5 | `pages` | 配列（Medium-1） |
| 6 | CJK の `hasEOL` | 空白を入れない。**`extract_tables` と共通化**（Medium-2） |
| 7 | タグ無し文書 | 提案どおり **`isTagged: false` + 理由**を返し推測しない。§14.8.2.5 NOTE 1 が根拠 |
| 8 | **応答サイズ** | specs/08 に記載なし。全文を返すため大きな文書で膨らむ。
`truncateIfNeeded` の適用と、ページ範囲・ロール絞り込みの引数を検討 |
| 9 | **`inspect_tags` への波及** | 同じ walker で疑似ノードを解消できる（High-1 の副次）。
M-8 と同時にやるか分けるかは別途判断 |

## 実測ログ（要約）

1. writer v0.13.0 `create_markdown_pdf`（`tagged: true`）で 2 ページの日本語タグ付き PDF を生成
2. **A**: pdf-lib で `StructTreeRoot` を深さ優先走査 → `Document` 1 つ・`L` 1 つ（`LI` 2 個）
3. **B**: pdfjs の `page.getStructTree()` をページ順に併合 → `Document` 2 つ・**`L` 2 つに分裂**
4. `L` 配下の MCR は `MCID=38 /Pg=7 0 R` と `MCID=0 /Pg=30 0 R` = ページ跨ぎを直接確認
5. pdfjs の id 形式は `p{objNum}R_mc{mcid}` と実測 → `/Pg` + `/MCID` から**構成可能**
6. A + 橋渡しで構造付きテキストを取得。**ページ跨ぎの `L` が 1 つに統合された状態**で
   H1/H2/P/Table/L すべてにテキストが対応
7. 日本語 `P` に元レイアウト由来の空白混入を確認（Medium-2）／`LI` に `•` の混入を確認（Medium-3）

---

*条文の根拠はすべて pdf-spec-mcp（iso32000-2）から取得した原文による。*
*実測は writer v0.13.0 / reader v0.7.0 / pdfjs-dist（node_modules 実物）による。*
