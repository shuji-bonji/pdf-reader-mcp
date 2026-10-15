# record: remove-validate-tools

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）の Phase 1、変更 2 件目の記録です。書式は計画 §8 です。時刻は commit の時刻と手元の時計で測りました（JST）。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-reader-mcp 0.16.1 → 次の版（人が決める）/ Claude（claude.ai の Cowork、モデル claude-opus-5-5）/ 2026-10-15 |
| 仕様を書いた時間 | 約 4 分（09:04 に着手し、影響範囲の調査を含めて 09:08 に proposal / 差分 spec / design / tasks を commit。`openspec validate --all` と `spec-ids check` は緑）。初版起こしは無し（消す 2 ツールは正本を持っておらず、残す一覧を新しい共通 capability `tools-list` に ADDED で書いた） |
| 人が判断した箇所 | (1) パイロットの対象として候補 A（2 ツールの削除）を選んだ。(2) 版の上げ方（0.17.0 か 1.0.0 か）は未決で、proposal の「人が判断すること」に書いた。(3) `approved`・`pr: 33` は本人が PR #33 で記入。`approved` が `202610-15` と書かれていて spec-gate の `spec-ids check` が「実在する YYYY-MM-DD ではありません」で止めたので、archive の commit で `2026-10-15` に直した。archive はマージの前に同じ PR の中で入れた（1 件目の反省のとおり） |
| 仕様と実装のずれ | 0 件。受入テスト 3 件は削除の前に 3 件とも落ち、削除の後に 3 件とも通った |
| エージェントが仕様に無い振る舞いを実装した件数 | 0 件。仕様の外の修正が 1 件ある。計器 `scripts/golden.mjs` の呼び出し一覧に `inspect_catalog`（0.16.0 で追加）が無く、0.16.0 から `take` が「登録されていて CALLS に無い」で止まっていた。A/B に要るので足した |
| 実装後に仕様を読み返した回数 | 1 回。tasks.md に、archive の後に正本へ front matter を書き足す手順（5.3）を足した（下の「分かったこと」の 1） |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 出力の A/B | 変更の前（`42433e2` から登録の 2 行だけを外した版）と後で、残る 18 ツールの出力を `scripts/golden.mjs` で採って比べた。検体は reader の fixtures 21 件・halves 4 件・veraPDF-corpus の 10 件おき 291 件の計 316 件で、JSON・Markdown とも差 0 件。計器の自己検査（t3）は JSON 20 件・Markdown 12 件の壊し方をすべて差として報告した。veraPDF-corpus 全件（2,931 件）でも差 0 件だった（下の「全件の A/B」） |
| テストの数 | `npm test` 502 → 456 件（2 ツールのテスト 49 件を消し、受入テスト 3 件を足した）。`test:e2e` 285 件。lint・format・typecheck・build・check:public-types・check:engines はすべて終了コード 0 |

## 分かったこと

1. **新しい capability を archive すると、OpenSpec 1.14.1 は差分仕様の front matter を正本に写さない。** 正本の 1 行目が `---` にならず、`spec-ids check` が「front matter がありません」で落ちる。1 件目（`inspect-structure`）は先に初版を起こして正本を置いていたので当たらなかった。
   - 正本の骨組み（front matter と Purpose だけ）を先に置く方法は使えない。要求が 0 件の正本を `openspec validate --all` が「Spec must have at least one requirement」で拒むので、CI の spec-gate が PR の間ずっと赤になる。
   - 採った方法は、archive の commit で正本の先頭に front matter を書き足すこと。これで `openspec validate --all`・`spec-ids check`・`spec-ids pr-scope` が通ることを使い捨てのブランチで確かめた。
   - spec-ids 側で直すなら、openspec レイアウトのときは「新しい capability の正本の front matter」を差分の front matter から補う、または archive 直後の正本では front matter を求めない、のどちらか。spec-ids 側のプロジェクトへ渡す材料。
2. **REMOVED は使えなかった。** OpenSpec の REMOVED は正本にある要求しか消せない。消す 2 ツールは OpenSpec の導入より前のツールで、正本が無い。初版を起こしてから REMOVED にすることもできるが、消すためだけに 2 ツール分の要求を書くことになる。そこで、残る一覧（001）と「合否を返すツールを登録しない」（002）を ADDED で書いた。消したツールの記録は proposal と CHANGELOG に残る。
3. **計器は、ツールの追加で止まったまま 1 版過ぎていた。** `golden.mjs` は「登録済みのツールが一覧に無い」と止まる作りで、その止まり方は正しかった。ただ、0.16.0 で `inspect_catalog` を足したときに一覧へ足しておらず、止まっていることはどの記録にも無かった。今回の 001 は `tools/list` の実応答を仕様で固定するので、次にツールを足すときは 001 の MODIFIED と受入テストの修正が要る。計器の一覧の修正もそこで一緒に気づける。
4. **A/B の 1 回目に、変更と関係の無い差が 22 件出た。** 変更の前後で fixtures の置き場所の文字数が 1 文字違い（`/home/claude/reader-before` と `/home/claude/pdf-reader-mcp`）、本文の長さが 1 バイト違った。両側で同じ置き場所の fixtures を使って採り直すと 0 件になった。

## 全件の A/B

検体を veraPDF-corpus の全件に広げて採り直した。条件は上と同じ（変更の前 = `42433e2` から登録の 2 行だけを外した版、変更の後 = このブランチ。両側で同じ置き場所の fixtures を使う）。

| 項目 | 結果 |
| --- | --- |
| 検体 | 2,931 件（fixtures 21・halves 4・veraPDF-corpus 2,906。veraPDF-corpus は GitHub の `veraPDF/veraPDF-corpus` の既定ブランチを `--depth 1` で取得） |
| 呼び出し | 片側 64,482 件（22 の呼び出し × 2,931 件）。`isError` は両側とも 57 件 |
| 差（JSON） | 0 件 |
| 差（Markdown） | 0 件 |
| 計器の自己検査（t3） | JSON 20 件・Markdown 12 件の壊し方をすべて差として報告した |
| 測れていない箇所 | JSON の本文が切り詰められて読めない呼び出しが 16 件ある（両側とも同じ 16 件）。この 16 件は項目ごとの比較ができず、本文全体の sha でだけ比べている |

コンテナ（2 CPU・メモリ 8 GB）で前後 2 本を並行に採ると、変更の後の JSON が 1,175 件目で `Killed` で止まった（メモリ不足と思われる）。`--resume` で単独で採り切った。
