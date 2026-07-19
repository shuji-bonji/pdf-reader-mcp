# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-07-19

> spec ⇄ reader 相互チェック（2026-07-19。`Document-Note/mcps/PDFfamily/reviews/` の 2 レポート）で
> 発見された 4 件（Issue #14〜#17）の一括対応。

### Changed

- **🔴 `extract_tables` を StructTreeRoot 走査に載せ替え** ([#14](https://github.com/shuji-bonji/pdf-reader-mcp/issues/14)・破壊的変更)。
  従来はページごとの `page.getStructTree()` を併合していたため、**ページを跨ぐ Table 要素が
  ページ単位の断片に分裂**し、Figure しか載っていないページには「ヘッダ 1 セル・中身空」の
  **幻テーブル**が生まれていました（ISO 32000-2 EC3 の pp.383–388 で実測: 実体 4 表に対し 8 表を報告。
  0.8.0 の C-1 で `inspect_tags` から取り除いたのと同じ failure mode で、本ツールの主要ユースケース
  = 新旧対照表はほぼ確実にページを跨ぎます）。M-8 と同じ walker（`struct-tree-service`）に載せ替え、
  跨ぎ Table は `pages: [383, 384, 385, 386]` のような **1 つの表**として返します。
  - **出力が変わります**: `tables[].page`（数値）→ **`tables[].pages`（配列）**。`index` はページ内
    連番から**文書全体の論理順連番**に変更（`pages` フィルタに関わらず同じ表は同じ index）。
    Markdown の見出しも `## Page N — Table M` → `## Table M — Page(s) …`。
  - 副次的な改善: セルの `/ActualText` を解決するようになりました（§14.9.4。旧経路は生グリフ）。
  - 実測: ISO PDF pp.383–388 が 8 表 → **5 表**（幻 3 つが消え、Table 126 の跨ぎ断片が 1 表に）。
  - 回帰フィクスチャ `spanning-table.pdf`（ページ跨ぎ Table 単体）と ET-6〜ET-8 を追加。
    `create-e2e-fixtures.ts` は引数で単一フィクスチャのみ生成できるようにしました
    （既存フィクスチャの再生成・再コミットを避けるため）。

### Fixed

- **`search_text` / `read_text` の ActualText 非対応を明示し、空振り時に案内を返すように**
  ([#15](https://github.com/shuji-bonji/pdf-reader-mcp/issues/15))。両ツールは生グリフを見るため、
  `/ActualText` 置換（§14.9.4「shall be used as a replacement」）で運ばれる語は**ビューアに見えていても
  ヒットしません**（`extract_structured_text` は「Difficult」を返すのに `search_text("Difficult")` は
  0 件 — 同一サーバ内で答えが割れていました）。グリフ置換の解決は pdfjs の textContent が
  ActualText を公開しないため本リリースでは行わず、(1) 両 description に生グリフである旨と
  `extract_structured_text` への案内を明記し、(2) **タグ付き文書で 0 件のとき `note` を返す**ように
  しました（「無い」と「見えない」の区別を呼び出し側に渡す）。`isTaggedPdf()` を追加。
  read_text の description が M-8 登場前のまま `extract_tables` しか案内していなかった点も更新
  （Issue #15 同梱の R-6）。
- **`extract_structured_text` の Markdown で表セル内の `|` を GFM エスケープ**
  ([#16](https://github.com/shuji-bonji/pdf-reader-mcp/issues/16))。ISO PDF Table 126 の `−|𝑦|` などで
  列が壊れていました。`extract_tables` は抽出時にエスケープ済みで、同一リポジトリ内で挙動が
  割れていたもの。M-8 側は**表示時のみ**エスケープし、JSON は生テキストのまま（層の分離を保つ）。
- **`extract_structured_text` の Markdown の `pages` 表示を連続範囲に圧縮**
  ([#17](https://github.com/shuji-bonji/pdf-reader-mcp/issues/17))。`join('–')` で全列挙していたため、
  文書全域に跨る `Document` 要素が 1000 個超のページ番号を並べ、応答が数十 KB 膨張して
  truncate を圧迫していました。`1–3, 7, 9–10` 形式に変更（表示のみ。JSON の配列は不変）。
  副次効果として、構造木に載らないページが欠番として一目で見えます。

## [0.8.0] - 2026-07-18

### Added

- **`extract_structured_text`（新ツール・M-8）** — タグ付き PDF のテキストを**論理コンテンツ順**で、各断片に構造タイプ（`H1` / `P` / `Table` …）のラベルを付けて返します。「H1 の文字列は何か」に答えるツールで、これは `read_text`（座標順のフラット）・`inspect_tags`（構造のみ・テキストなし）・`extract_tables`（表のみ）のいずれも返せませんでした。仕様: `Document-Note/mcps/PDFfamily/specs/08` v0.2 ／ レビュー: `docs/m8-spec-review-2026-07-18.md`。
  - **走査はカタログの `StructTreeRoot` を深さ優先**で行います（ISO 32000-2 §14.8.2.5 の logical content order の定義そのもの）。**`page.getStructTree()` のページ単位併合ではありません** — §14.8.2.5 NOTE 2 が「A logical object can extend over more than one PDF page」と明示するとおり、併合方式は**ページを跨ぐ要素を分裂させる**（段落が改ページで 2 つに割れ、リフロー後の本文の途中に段落境界が生まれる）。構造は pdf-lib、テキストは pdfjs（MCR の `/Pg` + `/MCID` を pdfjs の marked-content id に変換）で解決します。
  - 出力は**フラット + `depth`**（深さ優先 pre-order + depth で木を一意に復元。Markdown 化が単純ループになり、truncate がどこで切っても壊れない）。**`Table` のみ `rows`** を持ちます（2 次元は `depth` で表せないため）。
  - **`ActualText` はグリフを置換**（§14.9.4「a replacement, not a description」）、**`Alt` は `alt` に分離**し本文に混ぜません（§14.9.3 = 内容ではなく説明）。**`Lbl`（箇条書き記号）は `label` に分離**。**Artifact は除外**（§14.8.2.5 NOTE 3）。
  - **日本語対応**: pdfjs は元レイアウトの改行を出しますが、日本語は単語間に空白が無いため（§14.8.2.6.2「a word is defined by script and context」）、**CJK 文字間の改行を空白にしません**。writer が 1 行 1 marked-content で出力する PDF では改行が要素の**境界**に落ちるため、改行の解決は id を結合した後に行います。引数 `pages` / `roles` で絞り込め（範囲にかかる要素は丸ごと返す）、全体に truncate を適用します。タグ無し文書は推測せず `isTagged: false` と理由を返します。

### Changed

- **🔴 `inspect_tags` を `StructTreeRoot` 走査に変更** (C-1・破壊的変更)。従来は `page.getStructTree()` をページ順に併合し、**疑似 `StructTreeRoot` ノードの下にページごとの木を並べて**いました。そのため 2 ページの文書で **`Root` と `Document` を 2 つずつ**返し、ページを跨ぐ要素を分裂させていました。これは併合の産物であって文書の構造ではありません。family の境界ルールで `inspect_tags` を残す根拠は「**構造ツリーの報告は事実であり reader の責務**」ですが、**報告する木が合成物では「事実」になりません**。M-8 と同じ walker に載せ替え、`Document` は 1 つ・ページを跨ぐ要素はまるごと報告します。
  - **出力が変わります**（疑似 `Root` が消え、`Document` が 1 つに、ページ跨ぎ要素が統合）。`inspect_tags` を消費する側は確認してください。
  - 副次的に、`StructElem` はあるが marked content の無い文書（構造だけの PDF）でも構造木を返せるようになりました（旧 pdfjs 経由は空を返していました）。

## [0.7.0] - 2026-07-18

> **仕様適合レビュー (`docs/spec-conformance-review-2026-07-17.md`) で挙がった逸脱の一括修正**。
> ISO 32000-2 / PDF/UA-1 の**原文と照合**して直しています (根拠は各項目に条項番号付きで併記)。
>
> **バグ修正のみで新ツール・API 変更はありませんが、出力は実質的に変わります** — `read_images` は
> 「常に 0 枚」から正常動作に、`inspect_fonts` は日本語 PDF での答えが反転し、`validate_metadata` は
> 今まで通していた不正な日付を warning にします。そのため patch ではなく minor としました。
>
> **共通の教訓**: High 3 件はいずれも「**そのケースを踏むフィクスチャが無かった**」ために
> 長期間検出されませんでした (既存フィクスチャは全て `StandardFonts` で Type0 の PDF が 1 つも無く、
> 画像テストは `if (extractedCount > 0)` で本体ごとスキップされていました)。テストは 250 件緑・
> `typecheck` も `check` も緑のまま、tier1 ツールが 1 枚も画像を返していませんでした。

### Fixed

- **`inspect_fonts` が Type0 (CID) フォントの埋め込みを常に `false` と誤判定していた問題を修正** (仕様適合レビュー High-1)。Type0 フォント辞書には `FontDescriptor` が存在せず (ISO 32000-2 Table 119)、実体は `DescendantFonts` の CIDFont 辞書側にあります (Table 115 で "Required; shall be an indirect reference")。にもかかわらず Type0 辞書自体を見ていたため、記述子が見つからず常に「非埋め込み」と報告していました。`Subtype == Type0` の場合は `DescendantFonts[0]` を解決してその CIDFont の `FontDescriptor` を参照するよう修正 (§9.7.6.2 「In PDF, the font number shall be 0」/ Table 119 「a one-element array」より、index 0 が唯一の descendant)。
  - **影響**: **日本語 PDF はほぼすべて Type0** であり、「PDF/A・PDF/X 向けの埋め込み確認」という本ツールの主要ユースケースで誤答していました。NotoSansJP を埋め込んだ PDF が `isEmbedded: false` を返していた実証済みのバグです。
  - 記述子に到達できない不正な Type0 フォント (`DescendantFonts` の欠落・空配列) は `false` を報告します。埋め込みを主張する根拠が無いためです。
- **🔴 `read_images` が画像を 1 枚も抽出できなかった問題を修正** (D-9・実機試用で発見)。**tier1 ツールが実質不動でした**。
  - **原因 (2 つ)**:
    1. 画像のデコード結果は worker から**非同期に**届くため、`getOperatorList()` 直後に同期形式の `page.objs.get(name)` を呼ぶと `Requesting object that isn't resolved yet` を投げます。これを `catch {}` が飲み込んで `skippedCount` に計上していたため、**すべての PDF で `extractedCount: 0`** になっていました。コールバック形式 `get(name, callback)` で解決を待つよう修正 (届かない画像に備えてタイムアウト 10 秒)。
    2. **ページ間で共有された画像は `page.objs` ではなく `page.commonObjs` に入ります**。pdfjs はそれを `g_` 接頭辞付きの名前で示します (例: `g_d0_img_p2_1`)。`objs` 側だけを見ていると**永久に解決せず**、①の修正だけではタイムアウトまで待って取りこぼしていました。pdfjs 自身の `getObject` と同じ規則 (`name.startsWith('g_') ? commonObjs : objs`) で分岐するよう修正。`comprehensive_1.pdf` の抽出は **10 秒 → 52ms**、取りこぼしていた 1 枚も回収して 2/2 になりました。
  - **あわせて誤ったエラーメッセージを是正**。「The images may use an encoding format that is not directly accessible」と**ファイル側の性質のように断言**していましたが、実際は本サーバのバグで、pdfjs が問題なくデコードできる通常の PNG でも同じ文言が出ていました。原因を推測で断定しない文言に変更しています。
  - **なぜ気付かれなかったか**: 唯一プロパティを検証する E2E テスト (IM-3) の本体が `if (result.extractedCount > 0)` で囲まれており、**0 件なので本体ごとスキップされ空振りで緑**でした。これが High-2 (下記) も同時に隠していました。ガードを外し、抽出できること自体を表明する形に変更しています。
  - 既存の `comprehensive_1.pdf` も 0 枚 → 1 枚に回復しました。
- **`read_images` の pdfjs `ImageKind` 誤マッピングを修正** (仕様適合レビュー High-2)。`1 = RGB / 2 = RGBA / それ以外 = Grayscale` としていましたが、正しくは **`1 = GRAYSCALE_1BPP` / `2 = RGB_24BPP` / `3 = RGBA_32BPP`** で、3 値すべてがずれていました。あわせて `bitsPerComponent: 8` の固定値も修正 — Grayscale (1bpp) では **1** を報告します。マジックナンバーの直書きをやめ `ImageKind` を pdfjs から import するようにしたため、同種の取り違えが再発しません。未知の kind は `colorSpace: 'Unknown'` を報告します。
  - `colorSpace` / `bitsPerComponent` は pdfjs が正規化した**デコード後バッファ**の性質であり、画像 XObject の生の `/ColorSpace` エントリではありません (型定義にも明記)。
  - 新フィクスチャ `image-kinds.pdf` (RGB / RGBA / 1bpp グレースケールを 1 枚ずつ) で 3 種すべてを実データ検証。1bpp の 8×8 画像がちょうど 8 バイトになることまで確認しています (IM-7)。

- **`isValidPdfDate` の PDF 日付判定を修正** (仕様適合レビュー Medium-1・D-3)。ISO 32000-2 §7.9.4 と照合し、**誤受理 10 件・誤拒否 2 件**を是正しました。
  - **バグ1: `[+-Z]` が文字クラスでなく範囲だった**。正規表現では `+`(U+002B)〜`Z`(U+005A) の範囲と解釈され、`,-./0-9:;<=>?@A-Z` をすべてタイムゾーン記号として受理していました (`D:20241231235959A09'00` が「有効な日付」)。§7.9.4 が許すのは PLUS SIGN / HYPHEN-MINUS / LATIN CAPITAL LETTER Z の 3 文字のみです。
  - **バグ2: オフセットの `HH` と `mm` が不可分だった**。`(\d{2}'\d{2}'?)?` としていたため、有効な `D:20241231235959-09'` (分の省略) を拒否していました。§7.9.4 は「The minute offset field (mm) shall only be present if the APOSTROPHE … is present」と規定しており、mm は独立して省略可能です。
  - **あわせて値域検査を追加**。旧実装は全フィールドが `\d{2}` で、**月13・日00・時24・分60・秒60 をすべて「有効」と報告**していました。§7.9.4 の各定義 (MM 01–12 / DD 01–31 / HH 00–23 / mm・SS 00–59) に従います。
  - **条文の EXAMPLE との不整合を発見し、EXAMPLE 側を採用**。§7.9.4 の `D:199812231952-08'00` (「December 23, 1998, at 7:52 PM」) は **SS を省略したままオフセットを付けており**、同じ項の「all other fields may be present but only if all of their preceding fields are also present」と矛盾します。ISO 32000-1:2008 §7.9.4 に**同一の規定文と同一の EXAMPLE** があることを確認したため版差ではなく長年の規格側の不備と判断し、**SS の省略のみ例外として受理**します (規格自身の EXAMPLE を warning にするのは不合理なため)。それ以外は規定文どおり。
  - 正規表現を条文のフィールド定義から組み立て直し、各行に根拠を併記しました。単体テスト 34 件を追加 (`tests/tier1/validation-service.test.ts`) — レビューの実証表・条文の EXAMPLE・NOTE 2 (1.7 の末尾 `'`)・NOTE 3 (`Z` + オフセット) を含みます。

- **`inspect_annotations` の markup 注釈の分類を修正** (仕様適合レビュー Medium-2・D-4)。ISO 32000-2 **Table 171 の "Markup" 列**（規定・全型を網羅）をそのまま転記する形に改めました。手で組んだ集合が 4 型を取り違えていました。
  - **`Popup` を markup から除外**。§12.5.6.2 は「The remaining annotation types are **not** considered markup annotations: • The popup annotation type shall not appear by itself; it shall be associated with a markup annotation…」と明示しています。popup は他の注釈のテキストを表示する**容器**であって markup ではありません。
  - **`FileAttachment` / `Sound` / `Projection` を追加**（Table 171 はいずれも "Yes"。旧実装では漏れており、これらだけを持つページが `hasMarkup: false` と報告されていました）。`Sound` は PDF 2.0 で deprecated、`Projection` は PDF 2.0 の新規ですが、どちらも markup です。
  - 単体テスト 33 件 — **Table 171 の全 28 型を網羅**し、型が増えたら気付けるガードを含みます。
- **`inspect_structure` の PDF 版数の判定を修正** (仕様適合レビュー Low-3・D-8)。カタログの `/Version` があれば無条件に採用していましたが、**ヘッダとカタログの後の版**を採るのが正です。
  - ISO 32000-2 **Table 29** は カタログの `Version` を条件付きと規定しています — 「the document conforms to … **if later than the version specified in the file's header**. **If the header specifies a later version, or if this entry is absent, the document shall conform to the version specified in the header.**」。このエントリは増分更新で版を**上げる**ためのもの (§7.5.6) で、下げるためのものではありません。
  - ヘッダが `%PDF-1.7` でカタログが `/1.4` の場合、旧実装は `1.4` と報告していました。同版の場合もヘッダに従います（カタログは "later" ではないため）。不正な値のカタログエントリは「後の版を指定している」と示せないためヘッダが優先されます。
  - minor は**数値比較**にしました（文字列比較では `1.10 < 1.7` となり誤ります）。単体テスト 8 件。

### Deprecated

- **`validate_tagged` / `validate_metadata` を非推奨化** (M-2)。description に予告を追記しました。**動作は変更しておらず、削除は次のメジャーで行います**。
  - **理由**: PDF family の責務境界は「**ISO 規格に照らした合否を返すなら pdf-verify-mcp、観測を返すだけなら pdf-reader-mcp**」。この 2 ツールは pdf-verify-mcp が存在しなかった時代の実装で、この規則の例外でした。pdf-verify-mcp **v0.6.0 (2026-07-16) で PDF/UA 判定が実装済み**です。
  - **移管先**: `validate_conformance` (`flavour: "pdfua-1"` / `"pdfua-2"`)。単なる移植ではなく**上位互換**です — Figure の `/Alt`・`/ActualText` を個数でなく実在で検証し、Link の `/Contents` を検証し、StructTreeRoot を catalog から直接検査し、ISO 14289 の条項を付し、veraPDF があれば委譲します。
  - **`inspect_tags` は残します**。構造ツリーの報告は「事実」であり reader の責務です。また pdf-verify-mcp は pdfjs を持たないため、構造ツリーそのものの調査は本サーバでしかできません。
  - あわせて `validate_metadata` の description から **誤った規格上の主張を除去**しました。「Title presence (required for PDF/UA, PDF/A)」としていましたが、PDF/UA-1 §7.1 が要求するのは **XMP の `dc:title`** であり、本ツールが見ている Info 辞書は根拠になりません (同項は適合リーダが Info 辞書を "shall ignore" と規定。ISO 32000-2 §14.3.3 も CreationDate/ModDate を除き Info 辞書を非推奨としています)。`DisplayDocTitle`・`Suspects` も未検査である旨を明記しました。**非推奨化により、これらは修正せず移管先に委ねます** (仕様適合レビュー Medium-3 / Low-1 / Low-2 に対する回答)。

### Documentation

- **README (en/ja) の設定例に `@latest` を付けました** (A-2)。`npx -y <pkg>` の `-y` は**インストール確認を省くだけで、更新確認はしません**。`@latest` が無いと npx は最初に取得した版をキャッシュから使い続けるため、**新版を publish しても利用者に届きません**。pdf-writer-mcp で実際に発生した問題で (npm に 0.5.0 があるのに npx は 0.4.0 を使い続けた)、`read_images` が直る今回は特に届かないと意味がないため対応しました。キャッシュの注意書き (`rm -rf ~/.npm/_npx`) も添えています。

### Build

- **biome を `2.5.4` に固定** (A-1)。`package.json` が `^2.3.14`・実体が `2.5.3`・`biome.json` の `$schema` が `2.3.14` と三者バラバラでした。biome は **minor 更新で整形結果が変わる**ため、キャレット指定だと手元の `npm install` が CI より先に進み、**誰も触っていないファイルに format 差分が出ます**。pdf-verify-mcp で実際に発生した問題です (2026-07-16)。これで pdf-writer-mcp / pdf-verify-mcp と揃い、PDF family 全体が 2.5.4 固定になりました。

## [0.6.3] - 2026-07-14

### Added

- **Claude Code plugin 対応** — `.claude-plugin/plugin.json` を追加。Claude Code の plugin として直接インストールできるようになりました。`mcpServers` エントリは `npx -y @shuji-bonji/pdf-reader-mcp@latest` を起動します。shuji 製 MCP 群 (epsg-mcp / houki-egov-mcp / pdf-spec-mcp / pdf-verify-mcp 等) の plugin.json と同じ構造に揃えてあります。
- **README に PDF family セクションを追加** (README.md / README.ja.md) — `pdf-spec-mcp` (仕様知識) / `pdf-reader-mcp` (構造の読取・検査) / `pdf-verify-mcp` (真正性検証) の役割分担を明示。`inspect_signatures` が署名の**構造**のみを検査し、**暗号学的**な署名検証・信頼/失効評価・PDF/A 準拠検証は `pdf-verify-mcp` の担当であることを追記しました。

### Fixed

- **`SERVER_VERSION` の version drift を解消**。0.6.2 リリース時に `src/constants.ts` の `SERVER_VERSION` が `0.6.1` のまま取り残されており、MCP handshake の `serverInfo.version` と `read_url` の `User-Agent` が実際のパッケージバージョンより古い値を報告していました。`createRequire` で `package.json` から動的に読むように変更し (shuji-mcp-patterns Pattern B: ESM での動的バージョン取得)、以後リリースのたびに手で同期する必要はありません。

## [0.6.2] - 2026-05-09

### Build

- **build script に `chmod +x dist/index.js` を追加**: local dev で `./dist/index.js` を直接実行した際の `permission denied` を回避。npm install / npx 経由の通常利用には影響なし (npm が install 時に bin を chmod するため)。shuji 製 MCP 全体で build script を統一。

## [0.6.1] - 2026-05-08

### Added

- **`read_url` の同時実行数制限 (concurrency limit)** — module-level の shared limiter を `src/services/url-fetcher.ts` に導入。LLM が複数 `read_url` を並列に呼んでも、リモートホストへの過剰負荷とレート制限の発火を防ぎます。
  - 新規 `src/utils/concurrency.ts`: 軽量な FIFO ベース limit ヘルパー (`createLimit`)。houki-egov-mcp v0.2.1 の同名実装を移植 (外部依存なし、約 30 行)。
  - 既定 4 並列。環境変数 `PDF_READER_CONCURRENCY` で上書き可。
  - `fetchPdfFromUrl(url)` は内部で limit を経由するように変更。limit を経由しない素の実装は `fetchPdfFromUrlUnlimited(url)` として再エクスポート (テスト・特殊用途用)。
- **`tests/tier1/concurrency.test.ts`**: limit が cap を超えないこと、戻り値・順序を保つこと、エラー伝播の単体テスト 5 件。

### Changed

- **`SERVER_VERSION` 定数を `0.6.0` → `0.6.1` へ同期**。`User-Agent` ヘッダで送信される値もこれに追従。

## [0.6.0] - 2026-05-07

### Added

- **houki-hub family-compatible 構造化エラー応答** (Issue #9): すべての tool がエラー時に `LawServiceError` を JSON 文字列化したものを `content[0].text` に入れ、`isError: true` を立てて返すように変更しました。`code` 文字列は houki-hub family (houki-egov-mcp / houki-nta-mcp) と語彙を共有するため、LLM や Skill 層が一貫した解釈ロジックでエラーを処理できます。
  - 新規 `src/errors.ts`: `LawErrorCode` / `LawServiceError` / `makeError` / `isLawServiceError` / `NEXT_ACTIONS` を定義 (houki-egov-mcp の `src/errors.ts` をリファレンスとし、`houki-abbreviations` 等への依存はなし)。
  - 新規 `handleStructuredError(error)`: `unknown` を `LawServiceError` に正規化。`PdfReaderError` の legacy `code` を family 語彙にマッピング、汎用 `Error` のメッセージから `DOC_NOT_FOUND` / `INVALID_PDF` / `ENCRYPTED_PDF` / `FILE_TOO_LARGE` / `SOURCE_*` を推定。
  - 採用 `code` 一覧: `INVALID_ARGUMENT` / `DOC_NOT_FOUND` / `INVALID_PDF` / `ENCRYPTED_PDF` / `UNSUPPORTED_PDF_FEATURE` / `FILE_TOO_LARGE` / `SOURCE_API_ERROR` / `SOURCE_TIMEOUT` / `SOURCE_UNAVAILABLE` / `INTERNAL_ERROR`。
  - `PdfReaderError` を拡張: 直接 `familyCode` / `nextActions` / `retryable` / `detail` を渡せる第 4〜7 引数を追加 (既存呼び出しは変更なし、後方互換)。
- **`tests/tier1/errors.test.ts`**: makeError / isLawServiceError / NEXT_ACTIONS / handleStructuredError の単体テストを追加 (28 ケース)。

### Changed

- **全 16 tool のエラーパス**: tier1 (7) / tier2 (6) / tier3 (3) すべてが `handleStructuredError(error)` を呼び、JSON 文字列 + `isError: true` を返す形に統一。`content[0].text` は人間可読文字列ではなく **JSON** になります。
- **README.md / README.ja.md** の Error Contract セクション: 「方針」記述を「v0.6.0 で実装済み」に更新し、`code` 一覧テーブル / 移行ノート (v0.5.x → v0.6.0) を追記。
- **`handleError(error)` (deprecated)**: 後方互換のため引き続き人間可読な文字列を返しますが、内部実装は `formatStructuredErrorForHumans(handleStructuredError(error))` に置き換わりました。新規 tool では `handleStructuredError()` を直接利用してください。

### Migration

LLM クライアントや Skill 層で `content[0].text` を文字列として解釈していた場合、v0.6.0 以降は `JSON.parse(content[0].text)` で `LawServiceError` として解釈してください。`isError: true` フラグで構造化エラーかどうかを判定できます。詳細は README の「Error Contract (houki-hub family)」セクションを参照。

## [0.5.0] - 2026-05-07

### Added

- **`compact_whitespace` parameter on `read_text` and `read_url`** (Issue #4): opt-in whitespace normalization that collapses runs of `\s` plus U+3000 (fullwidth space) to a single ASCII space, and trims every line. Designed for Japanese form-style PDFs (帳票・様式) where U+3000 is used as visual indentation, inflating token consumption without adding information.
  - Default `false` keeps the existing extraction byte-for-byte (regression-tested).
  - Combines orthogonally with `split_columns`: inter-column `\n\n` separators survive the compaction.
  - Per-cell CJK kerning ("消 費 税" → "消費税") is intentionally NOT touched here — that requires CJK-aware logic and remains the responsibility of `extract_tables`'s `compactCellText`.
  - Empirically reduces character count by ~40% on 国税庁 form PDFs (e.g. `jimu-unei/hojin/090401-2/pdf/01.pdf`) while preserving all content.
- **E2E tests** in `tests/e2e/02-tier1-text.test.ts`: 3 new cases (RT-CW-1..3) covering the regression guard, the line-trim + run-collapse invariants, and orthogonal combination with `split_columns`.

### Changed

- **`read_text` / `read_url` tool descriptions**: documented the new `compact_whitespace` parameter and added "Japanese form template" usage example.

## [0.4.0] - 2026-05-07

### Added

- **`split_columns` parameter on `read_text` and `read_url`** (Issue #3): opt-in column-aware reordering for **untagged** multi-column PDFs. When `split_columns: 2` (or `3`) is passed, text items are first bucketed by X-coordinate into N equal-width columns, then each bucket is Y-sorted independently and concatenated left-to-right with a blank-line separator. Designed for older 新旧対照表 PDFs and similar two-column documents that lack a structure tree (Tagged PDFs with proper `<Table>` markup should use `extract_tables` instead).
  - `splitColumns: 1` (default / undefined) is unchanged — existing single-column Y-sort behaviour is preserved as a regression-tested baseline.
  - `extractText` / `extractTextFromDoc` now accept an `ExtractTextOptions` object with `splitColumns?: number`. Internally, line-grouping logic is factored out into `itemsToText` so the column path reuses the same Y-sort.
- **Test fixture `tests/fixtures/two-column.pdf`**: 1-page A4 untagged PDF with `LEFT-1..4` and `RIGHT-1..4` placed at paired Y-coordinates so plain Y-sort interleaves them — the regression target for `split_columns`.
- **E2E tests** in `tests/e2e/02-tier1-text.test.ts`: 4 new cases (RT-SC-1..4) covering the failure mode without `split_columns`, the success mode with `split_columns: 2`, the `split_columns: 1` regression guard, and a sanity check that `split_columns: 2` on a single-column PDF preserves all content.

### Changed

- **`read_text` / `read_url` tool descriptions**: documented the new `split_columns` parameter with guidance to prefer `extract_tables` for Tagged PDFs.

## [0.3.0] - 2026-05-06

### Added

- **`extract_tables` (Tier 2)**: New tool that walks a Tagged PDF's structure tree and emits every `<Table>` subtree as a Markdown table or a JSON document. Designed for documents whose meaning depends on multi-column layout — e.g. 国税庁 新旧対照表 (kaisei tsutatsu) PDFs where reading-order extraction merges 改正後 / 改正前 columns into ambiguous text. Internals:
  - `extractTables(filePath, pages?)` / `extractTablesFromDoc(doc, pages?)` in `services/pdfjs-service.ts`. Walks the StructTree, identifies `<Table>` → `<THead> | <TBody> | <TFoot>` → `<TR>` → `<TH> | <TD>`, then resolves cell text by mapping each leaf node's marked-content `id` (e.g. `p715R_mc4`) to the corresponding `beginMarkedContentProps` boundary in `getTextContent({ includeMarkedContent: true })`.
  - Cell text post-processing: collapses whitespace runs (incl. U+3000), folds per-character kerning runs ("消 費 税 法" → "消費税法") while preserving natural inter-word spacing ("事業者 法人番号"), escapes Markdown table delimiters.
  - Untagged PDFs return `isTagged: false`, an empty `tables` array, and a `note` recommending column-aware extraction (planned in Issue #3) as the fallback.
  - colspan / rowspan and nested tables are skipped in this initial release; cells appear in source order.
- **Types**: `TableCell`, `TableRow`, `ExtractedTable`, `TablesExtractionResult` in `types.ts`.
- **Schema**: `ExtractTablesSchema` in `schemas/tier2.ts` (file_path + pages + response_format).
- **Markdown formatter**: `formatTablesMarkdown` in `utils/formatter.ts` renders results as `# Extracted Tables` summary block followed by `## Page N — Table M` GFM tables.
- **E2E tests**: 5 new tests in `tests/e2e/04-tier2-structure.test.ts` covering untagged → note path, tagged-but-empty path, formatter shape, and pages filter.

### Changed

- **Tool count**: 15 → 16 tools (Tier 2 now has 6).
- README / README.ja.md tool tables and architecture diagram updated accordingly.

## [0.2.3] - 2026-05-06

### Fixed

- **`inspect_structure` / `inspect_fonts`**: No longer throw `Expected instance of PDFDict, but got instance of undefined` on Linearized PDFs whose cross-reference cannot be fully resolved by pdf-lib. Public-sector publishers (e.g. Japanese government agencies) routinely emit Linearized PDFs from Microsoft Word; previously every such file produced a hard error. After the fix:
  - `analyzeStructure` returns a partial result. The page count is filled in via pdfjs-dist when pdf-lib's page-tree traversal fails, and a `note` field describes the fallback.
  - `analyzeFontsWithPdfLib` returns an empty font map with an explanatory `note` instead of throwing.
  - All pdf-lib call sites (`loadWithPdfLib`, `analyzeStructure`, `analyzeFontsWithPdfLib`, `analyzeSignatures`, `detectEncryption`) now run inside `withSuppressedPdfLibLogs`, preventing pdf-lib's `console.log`-based parse diagnostics from polluting the JSON-RPC stream when the server runs over stdio.
- **Types**: `StructureAnalysis` and `FontsAnalysis` gained an optional `note?: string` field. `FontAnalysisResult` (internal) gained the same field.
- **Markdown formatter**: `formatStructureMarkdown` and `formatFontsMarkdown` now render the `note` as a `> ...` blockquote when present.

### Added

- **Test fixture**: `tests/fixtures/linearized.pdf` (regenerated by `create-test-pdf.ts` via `qpdf --linearize`) and matching e2e regression tests in `tests/e2e/04-tier2-structure.test.ts`.

## [0.2.2] - 2026-04-18

### Fixed

- **README**: Fixed broken link to pdf-spec-mcp. The `nicholasgriffintn/pdf-spec-mcp` URL in previous versions was erroneous (that repository does not exist); now correctly points to [`shuji-bonji/pdf-spec-mcp`](https://github.com/shuji-bonji/pdf-spec-mcp) — the companion MCP server providing ISO 32000 PDF specification knowledge.
- Restored the "Pairing with pdf-spec-mcp" section in both `README.md` and `README.ja.md` with the corrected link.
- **`src/index.ts`**: Restored header comment describing pairing with pdf-spec-mcp.

## [0.2.1] - 2026-04-18

### Changed

- **CI/CD**: Migrated npm publish workflow to [Trusted Publishing (OIDC)](https://docs.npmjs.com/trusted-publishers). `NPM_TOKEN` is no longer required; provenance attestations are generated automatically.
- **Publish workflow**: Split into `test` / `build` / `publish` jobs with tag-vs-`package.json` version consistency check.
- **`package.json`**: Added `publishConfig.access: "public"`, `publishConfig.provenance: true`, and `prepublishOnly: "npm run build"` for publish safety.
- **README**: Synchronized `README.ja.md` with `README.md` (`npx`-based installation steps). Corrected test counts (unit: 39, E2E: 118, total: 157).

## [0.2.0] - 2026-02-08

### Added

- **Tier 3 tools**: `validate_tagged`, `validate_metadata`, `compare_structure`
- **E2E test suite**: 146 tests across 9 test suites with performance baseline tracking
- **CI/CD**: GitHub Actions workflow for automated testing (Node 18/20/22) and npm publishing
- **Batch processor utility**: `processInBatches()` and `processAndReduce()` for large PDF handling
- **`analyzeTagsFromDoc()`**: Pre-loaded document variant for shared document lifecycle

### Changed

- **Parallel page processing**: `extractTextFromDoc`, `searchText`, `countImagesFromDoc`, `extractImages`, `checkSignatures`, `analyzeAnnotations`, `analyzeTags` now use `Promise.all` for concurrent page access
- **`validateTagged()`**: Eliminated double document load — now loads once and runs `analyzeTagsFromDoc` + `countImagesFromDoc` in parallel via `Promise.all`
- **Test infrastructure**: Extracted constants (`constants.ts`), cached baseline reads, added `measureAndCheck()` helper for DRY performance tests
- **Test naming**: All test descriptions translated to English for international readability

### Performance

- `searchText`: ~68% faster (parallel text extraction across pages)
- `getMetadata`: ~27% faster (parallel signature check)
- `validateMetadata`: ~25% faster
- `analyzeFonts`: ~57% faster
- `getMetadata-all-7` (batch): ~17% faster

## [0.1.0] - 2026-02-07

### Added

- **Tier 1 tools** (7): `get_page_count`, `get_metadata`, `read_text`, `search_text`, `read_images`, `read_url`, `summarize`
- **Tier 2 tools** (5): `inspect_structure`, `inspect_tags`, `inspect_fonts`, `inspect_annotations`, `inspect_signatures`
- Input validation with Zod schemas and path security checks
- Y-coordinate-based text extraction preserving natural reading order
- Unit tests for core utilities and pdfjs-service

[0.5.0]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shuji-bonji/pdf-reader-mcp/releases/tag/v0.1.0
