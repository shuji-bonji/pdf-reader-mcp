# reader の pdf-lib 撤去（family 第 3 弾）— 着手前の 1 枚

> **この 1 枚を読めば別セッションで始められる形にしてある。**
> 先行 2 件の記録: writer = `lib/normativepdf/docs/handoff/phase3-pdflib-removal.md`、
> verify = `mcp/pdf-verify-mcp/docs/handoff/pdflib-removal.md`（+ `scope-in-output.md`）。
>
> 実測日 2026-08-29。reader **0.13.0** / normativepdf **0.9.0**。
> **2026-08-31 追記: L0 と L1 の 1 本目が閉じた。§0 を先に読むこと。**

## 0. いまここ（2026-08-31）

**L0 は終わった。L1 は `detectEncryption` 1 本を移し終えた。次は L1 の続き。**

### L1 / L2 の進み

| 段 | 移したもの | A/B |
|---|---|---|
| L1 | `detectEncryption` → `recover-service.ts` | **差 0 件**（json / markdown 両方） |
| S1 | `object-locator.ts`（`locate_objects`） | 差 91 件・全件帰属（json / markdown で同じ 91 件） |
| S2 | `struct-tree-walker` / `struct-tree-service` / `actual-text-service` | 差 23 件・全件帰属（json / markdown で同じ 23 件） |
| S3 | `content-stream-service` / `text-extractability-service` | まだ |
| S4 | `pdflib-service`（`loadWithPdfLib` を消す） | まだ |

各段で `openPdf`（recover）と `loadWithPdfLib`（pdf-lib）が**併存する**。
移した段だけが recover で開き、残りは pdf-lib で開く。同じファイルを 2 回読むので
遅くなるが、**その段の差だけが A/B に出る**。まとめて移すと、出た差がどの段の
ものか言えなくなる。

### S1 の帰属（91 件・すべて `locate_objects#1-10`）

| 分類 | 件数 | 何が起きたか |
|---|---:|---|
| F 観測が増えた | 84 ファイル / 379 オブジェクト | `/ObjStm` と `/XRef` **自身**。pdf-lib の `enumerateIndirectObjects()` はこの 2 つを返さず「この番号のオブジェクトは存在しない」と答えていた |
| B 読めない→読めた | 2 | `%PDF-`（版が無いヘッダ）。pdf-lib は版の数を読もうとして止まっていた |
| E 観測が減った | 3 ファイル / 8 オブジェクト | 下の表 |
| G その他 | 2 | `detail.cause` の文面が条文つきに変わっただけ（`code` / `hint` / `next_actions` は同じ） |

🔴 **面 3（独立オラクル）で F の 379 件すべてを裏取りした。**
`qpdf --show-object` が返す `/Type` と **379/379 一致**。pdf-lib の
「存在しない」が誤りだったことを、reader の外側が確かめている。

> このとき照合スクリプトの側に欠陥があり、最初は **0/10 一致**と出た。
> qpdf は辞書を 2 行目に書くのに `head -1` で切っていた。
> 「合わない」と report した検査が、実際には何も読んでいなかった。

#### 読めていたものが読めなくなった 8 オブジェクト（面 2 の要注意）

| ファイル | オブジェクト | 理由 |
|---|---|---|
| `halves-fail-ok-password.pdf` | 1〜6 | 空でない利用者パスワード。鍵が導けないので **1 つも読めない**（ADR-0008）。pdf-lib の `ignoreEncryption` は復号せずに構造だけ歩いていた |
| `render-page2-never-finishes.pdf` | 8 | `/YStep -1.175e-38`。§7.3.3 は指数表記を許さないので、`e` が鍵の位置に来て `R-7.3.7-1` に反する。pdf-lib は黙って受けていた |
| veraPDF `6-1-5-t02-pass-d.pdf` | 7 | 表は名指ししているが値が **null オブジェクト**（§7.3.9）。qpdf も `null` と言う。pdf-lib の `found: true` が誤りだった |

後ろ 2 件は是正である。**残る 1 件（暗号化）は本当の後退で、判断が要る:**
空でない利用者パスワードの文書について、pdf-lib 版は `/Type` を返していた
（§7.6.2 は名前を暗号化の対象から外しているので、それ自体は正しい）。
recover は鍵が無いとオブジェクトを渡さないので、いまは
「鍵が導けなかった。パスワードを渡せ」と言って型を返さない。
利用者パスワードが空の文書（`encrypted-actualtext.pdf` など）は影響を受けない
—— recover が復号するので、むしろ文字列まで正しく読める。

### S2 の帰属（23 件）

`inspect_tags` 6 / `extract_tables` 5 / `extract_structured_text` 5 / 同 `#bbox` 5 /
`read_text` 1 / 同 `#cols2-compact` 1。**誤った pass は 0 件。**

| 分類 | 件数 | 何が起きたか |
|---|---:|---|
| B 読めない→読めた | 8 | `%PDF-`（版の無いヘッダ）2 ファイル × 4 呼び出し。S1 と同じ原因 |
| N 取り出せた文字が減った | 4 | UTF-8 のバイト順マーク（§7.9.2.2.1・PDF 2.0）。pdf-lib 1.x は PDFDocEncoding として読み、本文の頭に `ï»¿` を付けていた。検体名がそのまま `pdf20-utf8-test.pdf` |
| O / F 増えた | 5 | 暗号化された PDF/UA 検体の構造木が読めるようになった |
| G その他 | 8 | ① エラー文面が条文つきに（4）② `/Rectangle#c2` の `#c2` を §7.3.5 どおり復号（3）③ 上と同じ検体の `isTagged` が false→true（1） |

#### 暗号化検体の構造木（`PDF_UA-1/7.16 Security/7.16-t01-fail-a.pdf`）

`inspect_tags` が **0 要素 → 3 要素**（Document / H1 / P）になった。
pdf-lib は `ignoreEncryption` でオブジェクトストリームを開けず、
**タグ付き文書を「タグ無し」と誤報していた**。

🔴 面 3: `qpdf --show-encryption` が「利用者パスワードは空」と言い、
`--decrypt` して数えると `/S /Document` `/S /H1` `/S /P` の 3 件。reader の新しい答えと一致する。

#### 構造木の巡回を止める見張りが 2 枚要る

pdf-lib 版には**見張りが 1 枚も無かった**。`/K` が循環している文書では再帰が
止まらず、サーバは以後どの呼び出しにも答えない（0.14.0 の `render_page` と同じ形）。

| 見張り | 何を止めるか |
|---|---|
| 参照番号（`ancestors`・**枝ごと**） | 番号を持つ枝の循環。木全体ではなく枝で見張るので、非循環の文書では出力が 1 バイトも変わらない |
| 深さの上限（`MAX_STRUCT_DEPTH = 200`） | **番号を持たない直接オブジェクト**の循環。前者は素通りする |

🔴 止まらないのは例外ではない。try/catch にも試験の timeout にも掛からない ——
無限の await はマイクロタスクを詰めるので、マクロタスクである `setTimeout` に
順番が回らない。**試験は落ちずにハングする。** 実際、2 枚とも外すと
`vitest` が何も出さずに終わった（1 枚だけ外すと ST-1 が落ちる）。

上限 200 が実文書を切っていないことは測ってある: コーパス 2,939 検体の
`inspect_tags.maxDepth` の最大は **9**。

#### 「見つからない」を 3 つに分けた

| 何が起きたか | どう言うか |
|---|---|
| 表に無い / free | この番号のオブジェクトは無い（後の版が freed にした形） |
| 表にあるが値が null | 表は名指ししているが値は null オブジェクト（§7.3.9） |
| 表にあるが読めない | 表は名指ししているが読めない + **条文を名指しした理由** |

読み手にとって次にすることが 3 つとも違う。以前は 3 つとも同じ 1 文だった。

L1 の 1 本目に `detectEncryption` を選んだのは、呼び出し元が `pdfjs-service.ts:125` の
`metadata.isEncrypted` **1 箇所だけ**で、そこから `summarize` を経て
pdf-read Phase 1 の停止条件になるためである。壊れても何も落ちない経路なので、
差が出れば必ず A/B に出る。**振る舞いは変えていない** ——
読めなかったときに `false` を返す握り潰しも、pdf-lib 版のまま残してある。
これを `PartOutcome` に直すのは次の段で、そのとき
`tests/tier1/recover-service.test.ts` の L1-4 が落ちる。それが合図になる。

🔴 **「差 0 件」が計器の見落としでないことを確かめた。**
`return !scope.encrypted` に変えて 35 検体を採り直すと、
`get_metadata` / `summarize` / `validate_metadata` で 96 件の差が出た。
`isEncrypted` は kept に入っており、diff はそれを見ている。

### 🔴 その確認で計器の欠陥が 1 つ出た（直した）

96 件が全部 `P 返した画像が変わった（枚数・バイト列）` に入っていた。
**画像は 1 枚も動いていない。** `blocks` を丸ごと比べており、`blocks` は本文
ブロックのバイト数も持つので、`true` と `false` の 1 バイト差が P に当たっていた。
帰属は分類の名前を読んで行うので、名前が別のものを指していたら帰属できない。
`imageBlocks()` で本文ブロックを外し、いまは D 32 / C 31 / G 64 に落ちる
（G = 「その他（帰属が要る）」。`get_metadata` と `summarize` では
`isEncrypted` は検査ではなく素の項目なので、これが正しい）。
分類は diff の時に走るので、**採り直しは要らない**。

```
✅ 計器            scripts/golden.mjs（take / merge / diff / report / t3）
                   19 ツール × 23 呼び出し。--shard k/n と merge で 3 本並べて採る
✅ T-3             json 23 件 / markdown 12 件とも差を報告した。壊す先が無い検査 0 件
✅ 撤去前の基準     .golden/json-0.14.0.json  検体 2,942・呼び出し 67,666・isError 75
                   .golden/md-0.14.0.json    同上（markdown）
                   🔴 **消さない。** pdf-lib が在るうちにしか採れない
✅ 決定性          同じ集合を 2 回採って差 0 件（400 検体 9,200 呼び出し）
✅ L1 の A/B       .golden/json-L1.json / .golden/md-L1.json（差 0 件）
```

🔴 **バックグラウンドで採るのは効かない。** `device_bash` は呼び出しが終わると
`--die-with-parent` で子ごと落ちる（`setsid nohup` でも同じ）。しかも各呼び出しは
別の PID 名前空間なので、`pgrep` は前の呼び出しのプロセスを**見つけられない** ——
落ちているのに「動いている」と読めてしまう。`--budget-ms 140000` と `--resume` で
1 回の呼び出しに収まる分ずつ進めること。

### 🔴 撤去の前に 3 つ直した（0.14.0 と #27）

計器を書いたら、**何も変えずに同じ集合を 2 回採るだけで差が 3 件出た**。
基準が実行ごとに変わるなら基準にならないので、先に直した。撤去とは無関係である。

| 何 | どう出ていたか |
|---|---|
| `Promise.all` が 2 つの問いを 1 つの答えに畳んでいた | 同じ壊れた 1 ファイルに 12 回投げて `INVALID_PDF` 10 回・`INTERNAL_ERROR` 2 回。コーパス 2,931 件のうち 3 件で、取れていた文字が捨てられていた |
| `read_url` が全検体で `isError` | pdfjs が渡された配列の中身を worker へ移すので、同じ配列を読む 2 人目が 0 バイトを読んでいた。40 検体中 40 件 |
| `render_page` が返らない | PDFium は WASM の中で同期に走る。3.4 KB のファイル 2 件で 20 分待っても返らず、サーバは以後どの呼び出しにも答えない。タイリングパターンの `/YStep` が -1.175e-38（§8.7.3.1 Table 74 は 0 だけを禁じている） |

**この 3 つは 0.14.0 として commit 済み・未 push・未 publish。**
撤去の A/B はこの 0.14.0 の出力を基準に取る。

### §8 の「先に決めること」の答え

1. ~~B2 の 3 ファイル~~ → `@normativepdf/recover` として切り出し済み（ADR-0010）
2. **面 3 の独立オラクル** → `qpdf --json`（構造・オブジェクト・暗号化）/
   `pdftotext`（テキスト）/ `pdfinfo`（ページ数・メタデータ）を役割で割り当てる。
   どれも device_bash の VM にある（`mutool` と `verapdf` は無い）。
   立たないツール（`inspect_tags` / `validate_tagged` など）は「立たない」と書く
3. **pdfjs と pdf-lib の切り分け** → 下の §0.1 に実測を置いた

### 0.1 pdf-lib に届くのは 19 ツール中 18（import グラフの実測）

届かないのは `render_page` だけ。多くは `pdfjs-service.ts` 経由で、そこが
pdf-lib から取るのは `detectEncryption` と `loadWithPdfLib` の 2 本だけである。

reader が pdf-lib から import している記号は **14 種**で、うち 3 種は §1 の一覧
（COS 8 種）に無い。置き換え先は `@normativepdf/recover` 0.1.2 にすべて在る。

| pdf-lib | recover |
|---|---|
| `PDFDict` / `PDFName` / `PDFString` / `PDFHexString` / `PDFNumber` / `PDFArray` / `PDFRef` / `PDFStream` | `asDict` / `nameOf` / `textOf` / `numberOf` / `asArray` / `asRef` / `asStream` ほか |
| `PDFRawStream` / `decodePDFRawStream` | `decodedBytes` / `bytesOf` |
| `pdfDocEncodingDecode` / `utf16Decode` | `textOf` |
| `PDFPageLeaf` | `enumerateDicts` + `get` |
| `PDFDocument` | `openDocument` の戻り |

### 0.2 計器の回し方

```sh
SETS='--set .golden/specimens --set tests/fixtures \
      --set ../../lib/normativepdf/corpus/veraPDF-corpus \
      --set ../../lib/normativepdf/corpus/pdf20examples \
      --set ../../lib/normativepdf/corpus/_wout'
# 3 本並べて採る（1 回の device_bash に収まる。持ち場 3 は --resume が 1 回要る）
for k in 1 2 3; do node scripts/golden.mjs take .golden/<版>-s$k.json $SETS \
  --label <版> --shard $k/3 --budget-ms 150000 & done; wait
node scripts/golden.mjs merge .golden/<版>.json .golden/<版>-s{1,2,3}.json --label <版>
node scripts/golden.mjs diff .golden/json-0.14.0.json .golden/<版>.json [--detail '<file-key>']
node scripts/golden.mjs t3 .golden/<版>.json
```

- 🔴 **markdown は `--format markdown` で別に採る。** 形式の違うゴールデンは diff が拒む
- 🔴 **計器（kept）を直したら採り直す。** 0.14.0 で出力の形を変えたとき、
  kept が古い形を読んでいて 2,942 件すべてで `pageCount = 0` を返していた
- 遅い検体は 5 秒を越えると名指しされる（最も遅いのは Isartor のマニュアルで 91 秒）

### 0.3 gate は device_bash で全部回る（2026-08-30 に解けた）

```sh
$HOME/tsc-tool/node_modules/.bin/tsc -p tsconfig.json
NODE_PATH=$HOME/linux-natives/node_modules npx biome check ./src ./tests
NODE_PATH=$HOME/linux-natives/node_modules \
ESBUILD_BINARY_PATH=$HOME/linux-natives/node_modules/@esbuild/linux-arm64/bin/esbuild \
  npx vitest run
```

マウントの**外**に linux-arm64 版のネイティブ拡張を置いてある
（`typescript@7` / `@rollup/rollup-linux-arm64-gnu` / `@esbuild/linux-arm64` /
`@biomejs/cli-linux-arm64`）。repo と同じ版を入れること。
🔴 性能テストは `tests/e2e/baseline.json` を書き換えるので、commit 前に戻す。

---


## 1. いま何が載っているか（実測）

```
pdf-reader-mcp 0.13.0   src 46 ファイル・10,959 行
dependencies: @modelcontextprotocol/server ^2.0.0 / pdf-lib ^1.17.1
              pdfjs-dist ^4.9.155 / zod ^4.2.0
normativepdf: 入っていない
```

`pdf-lib` に触れているのは **src の 10 ファイル・約 5,700 行**。

| ファイル | 行 | pdf-lib の出現 |
|---|---:|---:|
| `services/pdflib-service.ts` | 562 | 77 |
| `services/content-stream-service.ts` | 701 | 56 |
| `services/struct-tree-walker.ts` | 319 | 56 |
| `services/object-locator.ts` | 392 | 50 |
| `services/pdfjs-service.ts` | 1,583 | 29 |
| `services/text-extractability-service.ts` | 349 | 29 |
| `services/struct-tree-service.ts` | 803 | 15 |
| `types.ts` | 590 | 2 |
| `services/actual-text-service.ts` | 248 | 1 |
| `tools/tier1/search-text.ts` | 111 | 1 |

`pdflib-service.ts` が入口で、**8 ファイルがそこを import している**
（tools 3 本 + services 5 本）。公開している関数は 6 つ:

```
loadWithPdfLib / loadWithPdfLibFromData / detectEncryption
analyzeStructure / analyzeFontsWithPdfLib / analyzeSignatures / resolvePdfVersion
```

import している pdf-lib の型は COS の 8 種だけ
（`PDFDict` / `PDFName` / `PDFString` / `PDFHexString` / `PDFNumber` /
`PDFArray` / `PDFRef` / `PDFStream`）。**高レベル API はほぼ使っていない** ——
verify のときと同じ形で、置き換え先は `cos.ts` 相当の読み口になる。

## 2. 🔴 pdfjs-dist は撤去対象ではない

`pdfjs-dist` はテキスト抽出とページ描画に使っており、これは別の問い。
normativepdf にテキスト抽出プリミティブは**まだ無い**
（normativepdf の ROADMAP に「需要駆動候補・着火待ち」として置いてある）。

**この作業で撤去するのは pdf-lib だけ。** 6 ファイルが pdfjs と pdf-lib の
両方に触れているので、切り分けを最初に測ること —— どの行がどちらの用事かを
混ぜたまま置き換えると、A/B の差を帰属できなくなる。

## 3. ~~🔴 reader には計器が無い~~（2026-08-31 に書いた。§0 を見よ）

verify（B2）と writer（Phase 3）はゴールデンの計器を持っていたが、reader は持っていない。

```
scripts/   check-engines.mjs / check-public-types.mjs / sync-plugin-version.mjs
tests/     e2e / fixtures / tier1 / verify-*.mjs
docs/handoff/  （このファイルが最初）
```

**最初の仕事は撤去ではなく、撤去前の出力を凍結する計器を書くこと。**
verify の `scripts/golden.mjs`（take / diff / report / t3・分類 10 バケツ）が
そのまま型になる。19 ツール × コーパス 2,950 件を回すので、
**呼び出し数は verify の 20,650 より多くなる**（見積 55,000 前後）。
verify では 2,950 件 × 7 ツールで 28 秒だったので、時間は問題にならない。

計器を信じる前に **T-3（意図的に壊して差が出ることを確かめる）を通す**こと。
verify の t3 は 14 通りで、そのうち 4 つ（増えただけ / 並びだけ / 切り詰め /
増えたうえに判定も動いた）は**あとから足りないと分かって足したもの**である。

## 4. 使えるもの（B2 で作った）

`mcp/pdf-verify-mcp/src/services/` の 3 つは、reader でも同じ形で要る。

| ファイル | 役割 |
|---|---|
| `xref-walk.ts` | 相互参照チェーンの歩きと回復方針（3 段・全部申告） |
| `document.ts` | `openDocument` と `DocumentScope`（どこまで読んだか） |
| `cos.ts` | COS の読み口。判定は書かない |

✅ **決まった（2026-08-29・[ADR-0010](../../../../lib/normativepdf/docs/adr/0010-recover-package.md)）:
共有パッケージ `@normativepdf/recover` として切り出す。**
コアには入れない（回復方針は推測で、条文どおりに読むコアの立場と両立しない）。
`@normativepdf/document`（ADR-0009）はオーサリング層なので、そこでもない。

🔴 **切り出しは reader の撤去より先に行う。** reader は最初からこのパッケージの
`openDocument` / `cos` の上で書く —— コピーしてから共有に直すと、A/B の差が
「置き場所の移動」と「pdf-lib の撤去」で混ざる。
切り出しの 1 枚 = [`mcp/pdf-verify-mcp/docs/handoff/recover-extraction.md`](../../../pdf-verify-mcp/docs/handoff/recover-extraction.md)

計器 3 本も型になる: `golden.mjs` / `probe-scope.mjs` / `verapdf-oracle.mjs`。

## 5. 段取り（verify の B2 に合わせる）

```mermaid
flowchart TD
    L0["L0 計器を書き、撤去前の出力を凍結する<br/>T-3 を通すまで信じない"] --> L1
    L1["L1 normativepdf を足し、pdflib-service の<br/>入口 1 本を置き換える"] --> L2
    L2["L2 COS を読んでいる 8 ファイルを cos.ts 相当へ"] --> L3
    L3["L3 pdf-lib を devDependencies へ落とす"] --> L4
    L4["L4 A/B を全件帰属し、受入 3 面を揃える"]
```

各段で `diff` を採り、**差を 1 件ずつ帰属する**。数を減らすのが目的ではなく、
**説明が付いていない差を 0 にする**のが目的。

## 6. 受入 3 面（verify B2 と同じ）

| 面 | 何を見るか |
|---|---|
| **1 撤去** | `src` の pdf-lib import 0 件 / `npm ls --omit=dev pdf-lib` が `(empty)` |
| **2 出力の A/B** | 19 ツール × 全検体の差を**全件帰属**。🔴 誤った `pass`（読めていたものが読めなくなる・観測が減る）は 0 件 |
| **3 独立オラクル** | reader の答えを **別実装**に照合する。候補 = `qpdf --json` / `pdftotext` / `mutool`。**A/B が両側とも同じ欠陥を持つ場合、面 1・面 2 では見えない**（verify では写しのヘッダが `%PDF-2.0` になっていた欠陥をこれだけが捕まえた） |

面 3 の対象を先に決めること。reader の 19 ツールのうち、
**独立オラクルが立つのはどれか**を実測で決める（立たないものは「立たない」と書く）。

## 7. 環境（そのまま効く制約）

- **push は device_bash からできない**（SSH 鍵が無い）。commit + tag までがこちらの仕事
- **マウント上で `npm install` を打たない**（ホストの darwin バイナリが linux のものに置き換わる）
- ビルドとテストは**コンテナへ往復する**: マウントで tar → `device_stage_files` →
  `/tmp/vm` で `npm ci` → `tsc` / `biome` / `vitest` / `npm run build` → tar →
  `SendUserFile` → `device_commit_files` → **`cat` で 1 ファイルずつ上書き**
  （tar の展開は unlink が要るので通らない）。**dist も戻す** —— 計器は dist を読む
- `.golden/` は gitignore にして**消さない**。撤去前の基準は pdf-lib が在るうちにしか採れない
- git はマウント越しで unlink できない: `--no-optional-locks`、
  `HEAD.lock` / `index.lock` / `tmp_obj_*` を `.git/_cowork-junk/` へ退避、
  identity は `-c user.name="shuji-bonji" -c user.email="bonji@mikuro.jp"`
- publish は **tag `v*` の push で発火**（npm Trusted Publisher / OIDC）。
  🔴 `--follow-tags` を忘れると版が欠番になる（verify 0.20.0 で実際に起きた）

## 8. 先に決めること 3 つ

1. ~~B2 の 3 ファイルをコピーするか、共有に上げるか~~ → **決まった**（§4・ADR-0010）。
   `@normativepdf/recover` の切り出しが**この作業の前**に入る
2. **面 3 の独立オラクルを何にするか**、19 ツールのどれに立つか（§6）
3. **pdfjs と pdf-lib の切り分け**をどこで測るか（§2）

## 9. 先行 2 件で分かっていること（踏まないため）

- **pdf-lib の `PDFDict.has` はオブジェクトストリーム由来の鍵を外す** ——
  `get` は通るのに `has` だけ false。verify では埋め込み済みフォントを
  「未埋め込み」と誤報していた。**`fail → pass` を反射的に後退と数えない**
- **`ignoreEncryption` は復号しない** —— 構造木は歩けるが文字列は暗号文のまま
- **チェーンが途中で切れた文書を条文どおり読むと、その向こうが丸ごと消える** ——
  verify では署名 6 本のうち 5 本と失効情報が見えなくなり、判定が緩んだ。
  「文書の組み立て」と「リビジョンの一覧」は別の問いとして分ける
- **出力に項目が増えると本当の差が埋まる** —— 分類に「増えただけ」の
  バケツを用意しておく。verify では 2,947 件のうち 2,904 件がそれだった
- **計器は自分の省略を黙る** —— 差分表示の打ち切り・辞書を読み飛ばす集計で
  3 度誤報した。**「全部帰属した」は数え直して言う**
