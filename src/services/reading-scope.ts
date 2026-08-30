/**
 * 「どこまで読めたか」を、答えそのものと同じ応答で申告する（#26）。
 *
 * ## なぜ要るか
 *
 * テキストを返すツールは 2 つの別々の問いに答えている。
 *
 *   1. **文字を取り出せたか**（pdfjs）
 *   2. **その文字が Unicode に変換できるか**（ISO 32000-2 §9.10.1・pdf-lib）
 *
 * 0.13.0 まで、この 2 本は `Promise.all` に入っていた。`Promise.all` は
 * **先に失敗したほうの理由で拒否する**ので、次の 3 つが起きていた（実測）。
 *
 *   - どちらが失敗したのかが出力に残らない
 *   - 片方が成功していても、その結果ごと捨てられる
 *     （コーパス 2,931 件のうち 3 件で、取れていた 13 字・0 字・86 字が捨てられていた）
 *   - どちらが先に失敗するかが実行ごとに変わる
 *     （同じ壊れた 1 ファイルに 12 回投げて、2 回だけ別のコードが返った）
 *
 * 🔴 **「抽出が失敗した」と「テキストが無い」は別のことである。**
 * 抽出の失敗は、pdfjs が文書またはページを開けなかったことを言う。
 * テキストが無いと言える根拠は、観測側の `textShowingOperators` が 0 であること
 * （§9.10.1 の `no_text_layer`）で、抽出の成否ではない。
 *
 * ## この module がすること
 *
 * 2 本を `Promise.allSettled` で受け、**片方が失敗しても、もう片方の答えを返す**。
 * 失敗した側は `ReadingScope` に理由を名指しして残す。両方失敗したときだけ
 * ツール全体が `isError` になり、そのときは **2 つの理由を両方載せる**。
 */

import { type LawErrorCode, type LawServiceError, makeError } from '../errors.js';
import { handleStructuredError } from '../utils/error-handler.js';

/** 片方の問いの結末。読めたか、読めなかったか。読めなかったなら理由を名指しする。 */
export type PartOutcome =
  | { status: 'read' }
  | { status: 'failed'; code: LawErrorCode; reason: string; hint?: string };

/**
 * この応答が「どこまで読んだか」。
 *
 * 🔴 これは判定ではない。`failed` は文書が誤っていることを言うのではなく、
 * この server がそこを読めなかったことを言う。
 */
export interface ReadingScope {
  /** ページの文字を取り出せたか（pdfjs）。 */
  textExtraction: PartOutcome;
  /** その文字が Unicode に変換できるかを観測できたか（§9.10.1・pdf-lib）。 */
  extractabilityObservation: PartOutcome;
}

/** 片方の結果。成功なら値、失敗なら申告できる形の理由。 */
export type Half<T> =
  | { ok: true; value: T; outcome: PartOutcome }
  | {
      ok: false;
      value: undefined;
      outcome: Extract<PartOutcome, { status: 'failed' }>;
      error: LawServiceError;
    };

const READ: PartOutcome = { status: 'read' };

/** 例外を、申告できる形（family のエラーコードと 1 文）に直す。握りつぶさない。 */
export function toOutcome(error: unknown): Extract<PartOutcome, { status: 'failed' }> {
  const structured = handleStructuredError(error);
  return {
    status: 'failed',
    code: structured.code,
    reason: structured.error,
    ...(structured.hint ? { hint: structured.hint } : {}),
  };
}

/** 1 本を回し、成功・失敗のどちらでも申告できる形にして返す。 */
export async function half<T>(run: () => Promise<T>): Promise<Half<T>> {
  try {
    return { ok: true, value: await run(), outcome: READ };
  } catch (error) {
    return {
      ok: false,
      value: undefined,
      outcome: toOutcome(error),
      error: handleStructuredError(error),
    };
  }
}

/**
 * 2 本を同時に回し、どちらも待つ。
 * 🔴 `Promise.all` と違い、片方の失敗でもう片方の答えを捨てない。
 */
export async function bothHalves<A, B>(
  runText: () => Promise<A>,
  runObservation: () => Promise<B>,
): Promise<{ text: Half<A>; observation: Half<B>; scope: ReadingScope }> {
  const [text, observation] = await Promise.all([half(runText), half(runObservation)]);
  return {
    text,
    observation,
    scope: { textExtraction: text.outcome, extractabilityObservation: observation.outcome },
  };
}

/**
 * どちらも読めなかったときのエラー。**2 つの理由を両方載せる。**
 *
 * 最上位の `code` は文字の取り出し側のものにする。利用者が頼んだのはそちらで、
 * どちらを最上位に置くかを固定しないと、`Promise.all` と同じように
 * 実行ごとに違うコードが出ることになる。
 */
export function bothFailedError(
  textError: LawServiceError,
  observationError: LawServiceError,
): LawServiceError {
  return makeError(textError.code, textError.error, {
    hint: textError.hint,
    next_actions: textError.next_actions,
    detail: {
      cause:
        `text extraction: ${textError.code}: ${textError.error}` +
        ` / extractability observation: ${observationError.code}: ${observationError.error}`,
    },
  });
}

/** 観測が立ち上がらなかったときに、ページごとに置く理由の 1 文。 */
export function observationUnavailableReason(outcome: PartOutcome): string {
  return outcome.status === 'failed'
    ? `this server could not observe the page: ${outcome.reason}`
    : 'this server did not observe the page';
}

/**
 * `summarize` の射程。1 つの文書に 4 つの読みがあり、別々に失敗しうる。
 * 3 つは同じ pdfjs の文書から取るので、文書が開けなければ 3 つとも同じ理由で失敗する。
 */
export interface SummaryScope {
  /** 文書情報（ページ数・版・タグの有無など）。 */
  metadata: PartOutcome;
  /** 1 ページ目の文字。 */
  textPreview: PartOutcome;
  /** 画像 XObject の数。 */
  imageCount: PartOutcome;
  /** §9.10.1 の観測。 */
  extractabilityObservation: PartOutcome;
}

/**
 * 射程を人が読む本文に直す。見出しは family でそろえてある
 * （pdf-verify-mcp の `Scope of this reading` と同じ）。
 *
 * 🔴 **全部読めたときにも出す。** 何かが欠けたときだけ現れる行は、
 * 読み手が読み飛ばすようになる。
 */
export function formatScopeLines(entries: Array<[string, PartOutcome]>): string[] {
  return [
    '## Scope of this reading',
    '',
    ...entries.map(([label, outcome]) =>
      outcome.status === 'read'
        ? `- ${label}: done`
        : `- ${label}: NOT DONE — ${outcome.code}: ${outcome.reason}`,
    ),
  ];
}

export function formatReadingScope(scope: ReadingScope): string[] {
  return formatScopeLines([
    ['Text extraction', scope.textExtraction],
    ['Extractability observation (ISO 32000-2 §9.10.1)', scope.extractabilityObservation],
  ]);
}

export function formatSummaryScope(scope: SummaryScope): string[] {
  return formatScopeLines([
    ['Document information', scope.metadata],
    ['Text of page 1', scope.textPreview],
    ['Image count', scope.imageCount],
    ['Extractability observation (ISO 32000-2 §9.10.1)', scope.extractabilityObservation],
  ]);
}
