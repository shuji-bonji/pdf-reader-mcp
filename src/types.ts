/**
 * pdf-reader-mcp shared type definitions
 */

import type { ReadingScope, SummaryScope } from './services/reading-scope.js';

// ─── Tier 1 ──────────────────────────────────────────────

/** Metadata extracted from a PDF document */
export interface PdfMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  pageCount: number;
  pdfVersion: string | null;
  isLinearized: boolean;
  isEncrypted: boolean;
  isTagged: boolean;
  hasSignatures: boolean;
  fileSize: number;
}

/**
 * How much of a page's text this server could have converted to Unicode (#21).
 *
 * ISO 32000-2 §9.10.1 distinguishes three conditions that an empty extraction
 * result used to collapse into one. `not_observed` is a fourth, and is not a
 * verdict about the file: it says this server did not get to look (an encrypted
 * document, an undecodable content stream). Counting it as `extracted` would
 * repeat the bug this type exists to fix.
 */
export type TextExtractabilityState =
  | 'extracted'
  | 'no_text_layer'
  | 'not_extractable'
  | 'not_observed';

/** One font a text-showing operator used that offers no route to Unicode. */
export interface UnmappableFont {
  /** The `/Tf` resource name, e.g. `F4`. */
  resourceName: string;
  baseFont: string | null;
  subtype: string | null;
  encoding: string | null;
  /** Which method of ISO 32000-2 §9.10.2 was missing, in words. */
  reason: string;
}

/** Per-page text extractability observation (#21). */
export interface PageExtractability {
  page: number;
  state: TextExtractabilityState;
  /** Empty unless `state` is `not_extractable`. */
  unmappableFonts: UnmappableFont[];
  /** Fonts referenced by a text-showing operator on this page. */
  fontsUsed: number;
  /** `Tj` / `TJ` / `'` / `"` occurrences. */
  textShowingOperators: number;
  /** `Do` on an Image XObject, plus `BI` inline images. */
  imageOperators: number;
  /** `/ActualText` entries on marked-content sequences of this page (§14.9.4). */
  actualTextEntries: number;
  /** Set only for `not_observed`: what stopped the observation. */
  reason?: string;
}

/** A single page's extracted text */
export interface PageText {
  page: number;
  /**
   * The text this server could take from the page.
   *
   * 🔴 `null` and `''` are different answers. `''` means the extraction ran and
   * produced no characters; `null` means the extraction did not run on this
   * document at all, and `ReadingScope.textExtraction` says why. Writing `''`
   * for the second case would say "this page has no text", which is a claim
   * this server did not measure.
   */
  text: string | null;
  /**
   * Present when the caller asked for it (#21). Absent is not "extracted" —
   * it means the state was not observed on this path. When the observation
   * could not run at all, `ReadingScope.extractabilityObservation` says why;
   * this field is left off rather than filled with zeros, because `0` fonts
   * observed and "not observed" are different answers.
   */
  extractability?: PageExtractability;
}

/** A search match within a PDF */
export interface SearchMatch {
  page: number;
  lineIndex: number;
  text: string;
  contextBefore: string;
  contextAfter: string;
}

/** Search results response */
export interface SearchResult {
  /** どこまで読んだか。検索と観測は別々に失敗しうる。 */
  scope?: ReadingScope;
  query: string;
  /**
   * 見つかった件数。
   *
   * 🔴 `null` は 0 ではない。0 は「探して見つからなかった」、`null` は
   * 「探せなかった」で、理由は `scope.textExtraction` にある。
   */
  totalMatches: number | null;
  matches: SearchMatch[] | null;
  truncated: boolean | null;
  /**
   * Set when the search found nothing but the document is tagged (#15).
   * search_text sees raw glyphs only — a tagged document may carry the
   * searched words in `/ActualText` replacements (ISO 32000-2 §14.9.4),
   * which only `extract_structured_text` resolves.
   */
  note?: string;
  /**
   * Pages searched whose text is not fully convertible to Unicode (#21).
   * A zero-match search over these pages means "not found in what could be
   * read", which is not the same claim as "not in the document".
   */
  unsearchablePages?: PageExtractability[];
}

/** An extracted image from a PDF page, encoded as a real image file (#22). */
export interface ExtractedImage {
  page: number;
  index: number;
  /** Width of the image as returned, after any downscale. */
  width: number;
  /** Height of the image as returned, after any downscale. */
  height: number;
  /** The image's own width in the file, before any downscale. */
  sourceWidth: number;
  /** The image's own height in the file, before any downscale. */
  sourceHeight: number;
  /**
   * Colour space of the decoded buffer: 'Grayscale' | 'RGB' | 'RGBA'
   * ('Unknown' if pdfjs reports a kind we do not recognise).
   * This describes pdfjs's normalised output, not the raw image XObject's
   * /ColorSpace entry.
   */
  colorSpace: string;
  /** Bits per component of the decoded buffer: 1 for Grayscale, 8 for RGB/RGBA. */
  bitsPerComponent: number;
  /** `image/png` or `image/jpeg` — what `dataBase64` actually contains. */
  mimeType: string;
  /** Size in bytes of the encoded image, before base64. */
  encodedBytes: number;
  /** True when `max_width` / `max_height` reduced the image. */
  downscaled: boolean;
  /** Base64 of a complete PNG or JPEG file — not raw pixels. */
  dataBase64: string;
}

/** An image that was decoded but left out of the response, and why. */
export interface OmittedImage {
  page: number;
  index: number;
  sourceWidth: number;
  sourceHeight: number;
  reason: string;
}

/** Result of image extraction including detected vs extracted counts */
export interface ImageExtractionResult {
  images: ExtractedImage[];
  detectedCount: number;
  extractedCount: number;
  skippedCount: number;
  /** Decoded but not returned — over the response budget, or too large to encode. */
  omitted: OmittedImage[];
  /** Total encoded bytes of the images that ARE returned. */
  totalEncodedBytes: number;
}

/** Summary report of a PDF document */
export interface PdfSummary {
  filePath: string;
  /**
   * どこまで読んだか。この 4 つは別々に失敗しうる（#26）。
   * 🔴 下の項目が `null` のときは、その読みが行われなかったということで、
   * 「0 だった」「無かった」ではない。理由はここにある。
   */
  scope?: SummaryScope;
  metadata: PdfMetadata | null;
  textPreview: string | null;
  imageCount: number | null;
  hasText: boolean | null;
  /**
   * Document-level fold of the per-page states (#21). `hasText` alone cannot
   * say why text is absent; this can.
   */
  textExtractability: TextExtractabilityState | null;
  /** The pages that are not `extracted`, so the caller can go straight to them. */
  unreadablePages: PageExtractability[] | null;
  /**
   * What the XMP packet declares (#29): PDF/A, PDF/UA and TDMRep, **as written**. A
   * `pdfuaid` block is the author's claim that the structure tree is complete — the cue
   * to prefer the structure route — not a verdict on it. `null` when the packet could not
   * be read; all-null blocks when the catalog has no `/Metadata` at all.
   */
  declaredConformance: XmpDeclarations | null;
  /**
   * What to call next, decided from the observations above (#24).
   *
   * Suggestions, not a workflow: each line names the observation it follows
   * from, the caller remains free to ignore it, and no ordering between the
   * lines is implied. Orchestration stays a Skill-level responsibility — this
   * field only saves the caller from re-deriving the obvious move from the
   * numbers.
   */
  next: string[];
}

// ─── Tier 2: Structure Analysis ──────────────────────────

/** Catalog entry info */
export interface CatalogEntry {
  key: string;
  /**
   * COS の型（ISO 32000-2 §7.3）: `dict` / `stream` / `array` / `name` /
   * `string` / `integer` / `real` / `boolean` / `null` / `ref`。
   * 参照は解決しないので、`ref` は「この鍵には参照が書いてある」を意味する。
   */
  type: string;
  value: string;
}

/** Page tree statistics */
export interface PageTreeInfo {
  totalPages: number;
  mediaBoxSamples: Array<{ page: number; width: number; height: number }>;
}

/** Object statistics */
export interface ObjectStats {
  /** 読めた間接オブジェクトの数。読めなかった分は `unreadable` が持つ。 */
  totalObjects: number;
  streamCount: number;
  /**
   * COS の型（§7.3）ごとの数。10 種の `kind` で数える。
   *
   * 🔴 §7.3 の型と辞書の `/Type` は別の問いなので、`/Type` は `byDocType` に
   * 分けてある。1 つの数に畳むと「dict が 51,237 個」と「Page が 13,001 個」が
   * 同じ欄を取り合う。
   */
  byType: Record<string, number>;
  /**
   * 辞書の `/Type` ごとの数（`Catalog` / `Pages` / `Page` / `Font` …）。
   * ストリームの辞書も含める（`ObjStm` / `XRef` / `Metadata` がここに出る）。
   */
  byDocType: Record<string, number>;
  /**
   * 相互参照表に載っているが**読めなかった**オブジェクトの数。
   *
   * 🔴 `totalObjects` に足さない。足すと「読めた数」でも「表に載っている数」でも
   * ない 3 つ目の数になる。0 は「全部読めた」という観測結果である。
   */
  unreadable: number;
}

/** inspect_structure output */
export interface StructureAnalysis {
  catalog: CatalogEntry[];
  pageTree: PageTreeInfo;
  objectStats: ObjectStats;
  isEncrypted: boolean;
  pdfVersion: string | null;
  /**
   * Optional human-readable note describing partial / fallback results.
   * Set when the PDF could not be fully analyzed via pdf-lib alone (e.g.
   * Linearized PDFs whose cross-reference cannot be fully resolved) and
   * the page count was obtained via pdfjs-dist instead.
   */
  note?: string;
}

/** Tag tree node */
export interface TagNode {
  role: string;
  children: TagNode[];
  contentCount: number;
}

/** A cell of a `Table` in structured text, mirroring `extract_tables`. */
export interface StructuredTableCell {
  text: string;
  isHeader: boolean;
}

/**
 * One element of the flattened logical content order (`extract_structured_text`).
 *
 * Flat + `depth` rather than nested: a depth-first pre-order plus depth encodes
 * the tree exactly (it is an indented outline), so nothing is lost.
 */
export interface StructuredElement {
  /** The structure type, `/S` (e.g. `H1`, `P`, `Table`). */
  role: string;
  /** Nesting depth in the structure tree; the top-level element is 0. */
  depth: number;
  /** Textual content, or `null` for containers and for content with no text. */
  text: string | null;
  /**
   * `/Alt` — an alternate *description* of content that has no text
   * (ISO 32000-2 §14.9.3), e.g. a Figure. Never the content itself, which is
   * why it is not folded into `text`. Present only when the element has one.
   */
  alt?: string;
  /** `/Lbl` text ("•", "1.") of a list item. Present only when the item has one. */
  label?: string;
  /** `/Lang` override for this element (§14.9.2). Present only when set. */
  lang?: string;
  /**
   * Pages this element's content appears on.
   *
   * An array, not a number: §14.8.2.5 NOTE 2 — "A logical object can extend over
   * more than one PDF page".
   */
  pages: number[];
  /**
   * Rows, for `Table` only. A table is two-dimensional and `depth` cannot express
   * "row 2, column 3"; every other role is an outline and fits `depth`.
   */
  rows?: StructuredTableCell[][];
  /**
   * Where this element is drawn, one rectangle per page (Issue #20, stage 2).
   *
   * Present only when `include_bbox` was requested AND a rectangle could be
   * arrived at. An array, not a rectangle: an element that spans pages has no
   * single rectangle, and merging them would place content on a page it is not on.
   */
  boxes?: ElementBox[];
  /**
   * Why there is no rectangle, or what the returned one does and does not cover.
   * Present only when `include_bbox` was requested and something has to be said.
   */
  boxNote?: string;
}

/** How an element's rectangle was arrived at (Issue #20, stage 2). */
export type ElementBoxBasis =
  /**
   * The `/BBox` layout attribute the file declares for this element
   * (ISO 32000-2 Table 379: "the coordinates of the left, bottom, right and top
   * edges … of the structure element's bounding box"). This is the producer's
   * own statement about the geometry — a **declaration**, not a measurement.
   */
  | 'layout-attribute-bbox'
  /**
   * Measured from the text the element owns: the union of each run's box, taken
   * from the run's baseline origin and the font's ascent/descent (§9.4.4 places
   * glyphs by Trm; the run's transform is that mapping into default user space).
   * Non-text marks — images, vector art — contribute nothing.
   */
  | 'text-extent';

/** One place a structure element is drawn. */
export interface ElementBox {
  /** 1-based page number. */
  page: number;
  /**
   * PDF default user space, origin bottom-left, pt, normalised (x1 < x2, y1 < y2)
   * — the same rectangle `pdf-writer-mcp` `add_annotation` takes, so it can be
   * handed over without reinterpreting the coordinate system. Unaffected by
   * `/Rotate` and by a `/CropBox` whose origin is not (0, 0).
   */
  rect: ObjectRect;
  basis: ElementBoxBasis;
}

/** extract_structured_text output */
export interface StructuredTextResult {
  /** どこまで読んだか。構造木の読み取りと §9.10.1 の観測は別々に失敗しうる。 */
  scope?: ReadingScope;
  /**
   * 🔴 `null` は false ではない。false は「タグが無いと観測した」、`null` は
   * 「構造木を読めなかった」で、理由は `scope.textExtraction` にある。
   */
  isTagged: boolean | null;
  lang: string | null;
  elements: StructuredElement[] | null;
  /**
   * Per-page text extractability (#21). The structure tree says what the
   * elements are; this says whether their characters could be read at all.
   */
  extractability?: PageExtractability[];
  /** Why extraction is not possible, when `isTagged` is false. */
  note?: string;
  /** What the rectangles do and do not mean. Present only when `include_bbox`. */
  bboxNotes?: string[];
}

/** inspect_tags output */
export interface TagsAnalysis {
  isTagged: boolean;
  rootTag: TagNode | null;
  maxDepth: number;
  totalElements: number;
  roleCounts: Record<string, number>;
}

/** Font information */
export interface FontInfo {
  name: string;
  type: string;
  encoding: string | null;
  isEmbedded: boolean;
  isSubset: boolean;
  pagesUsed: number[];
}

/** inspect_fonts output */
export interface FontsAnalysis {
  fonts: FontInfo[];
  totalFontCount: number;
  embeddedCount: number;
  subsetCount: number;
  pagesScanned: number;
  /**
   * Optional human-readable note describing partial / fallback results.
   * Set when fonts could not be enumerated via pdf-lib (e.g. Linearized PDFs
   * whose page tree cannot be fully resolved).
   */
  note?: string;
}

/** A single cell within an extracted table row. */
export interface TableCell {
  /** Concatenated text content of the cell (whitespace compacted). */
  text: string;
  /** True when the cell came from a `TH` element (header), false for `TD`. */
  isHeader: boolean;
}

/** A table row composed of one or more cells. */
export interface TableRow {
  cells: TableCell[];
}

/** A single table extracted from a Tagged PDF's structure tree. */
export interface ExtractedTable {
  /**
   * 1-based page numbers the table's content lives on, ascending (#14).
   *
   * An array, not a number: a Table StructElem that continues across a page
   * break is ONE table (§14.8.2.5 NOTE 2), and since the walker moved to the
   * document's StructTreeRoot it is reported whole. Was `page: number` when
   * extraction was per-page — that sliced spanning tables into fragments.
   */
  pages: number[];
  /** 1-based index of the table in logical content order, document-wide. */
  index: number;
  /** Rows from `<THead>`. Empty if the table has no explicit header section. */
  headerRows: TableRow[];
  /** Rows from `<TBody>` (or directly under `<Table>` when no `<TBody>` exists). */
  bodyRows: TableRow[];
  /** Rows from `<TFoot>`. Rare; usually empty. */
  footerRows: TableRow[];
}

/** Output of `extract_tables`. */
export interface TablesExtractionResult {
  /** Whether the PDF claims to be tagged (`/MarkInfo /Marked true`). */
  isTagged: boolean;
  /** All tables extracted from the requested pages. */
  tables: ExtractedTable[];
  /** Total number of tables across `pagesScanned`. */
  totalTables: number;
  /** Number of pages traversed (subject to the `pages` filter). */
  pagesScanned: number;
  /**
   * Optional human-readable note. Set when no tables could be extracted
   * because the PDF is not tagged (in that case callers should fall back to
   * the planned column-aware extraction).
   */
  note?: string;
}

/** Annotation information */
export interface AnnotationInfo {
  subtype: string;
  page: number;
  rect: number[] | null;
  contents: string | null;
  author: string | null;
  modificationDate: string | null;
  hasAppearance: boolean;
}

/** inspect_annotations output */
export interface AnnotationsAnalysis {
  totalAnnotations: number;
  bySubtype: Record<string, number>;
  byPage: Record<number, number>;
  annotations: AnnotationInfo[];
  hasLinks: boolean;
  hasForms: boolean;
  hasMarkup: boolean;
}

/** Signature field information */
export interface SignatureFieldInfo {
  fieldName: string;
  isSigned: boolean;
  signerName: string | null;
  reason: string | null;
  location: string | null;
  contactInfo: string | null;
  signingTime: string | null;
  filter: string | null;
  subFilter: string | null;
}

/** inspect_signatures output */
export interface SignaturesAnalysis {
  totalFields: number;
  signedCount: number;
  unsignedCount: number;
  fields: SignatureFieldInfo[];
  note: string;
}

// ─── Tier 3: Validation & Analysis ──────────────────────

/** Severity level for validation issues */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/** A single validation issue */
export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  details?: string;
}

/** validate_tagged output */
export interface TaggedValidation {
  isTagged: boolean;
  /**
   * 実際に判定できた検査の数。
   * 🔴 前提を観測できずに回らなかった検査はここに入らない。`notChecked` にある。
   * 回らなかった検査を「通った」に数えると、観測していないことが合格の顔をする。
   */
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  issues: ValidationIssue[];
  /** 前提を観測できなかったので回らなかった検査。コードと、なぜ回らなかったか。 */
  notChecked?: { code: string; reason: string }[];
  summary: string;
}

/** validate_metadata output */
export interface MetadataValidation {
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  issues: ValidationIssue[];
  metadata: {
    hasTitle: boolean;
    hasAuthor: boolean;
    hasSubject: boolean;
    hasKeywords: boolean;
    hasCreator: boolean;
    hasProducer: boolean;
    hasCreationDate: boolean;
    hasModificationDate: boolean;
    pdfVersion: string | null;
    isTagged: boolean;
  };
  summary: string;
}

/** Diff entry for structure comparison */
export interface StructureDiffEntry {
  property: string;
  file1Value: string;
  file2Value: string;
  status: 'match' | 'differ';
}

/** compare_structure output */
export interface StructureComparison {
  file1: string;
  file2: string;
  diffs: StructureDiffEntry[];
  fontComparison: {
    onlyInFile1: string[];
    onlyInFile2: string[];
    inBoth: string[];
  };
  summary: string;
}

// ─── Object → coordinates (Issue #20 / family gap G-A) ───

/**
 * A rectangle in PDF user space: origin bottom-left, points, `x1 < x2` and
 * `y1 < y2` (ISO 32000-1 §7.9.5 normalised form). Deliberately the same shape
 * `pdf-writer-mcp`'s `add_annotation` takes, so a result can be handed over
 * without reinterpretation.
 */
export interface ObjectRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** How an object's coordinates were arrived at */
export type ObjectLocationBasis =
  /** the object's own `/Rect` — exact */
  | 'annotation-rect'
  /** the object is a page; the rectangle is its crop/media box */
  | 'page-box'
  /** the object is a page's content stream; the rectangle is the whole page */
  | 'page-content-stream'
  /** the object is a resource of the page and has no rectangle of its own */
  | 'page-resource';

/** One place an object occupies. An object may be used by several pages. */
export interface ObjectLocation {
  /** 1-based page number; null when no page could be tied to the object */
  page: number | null;
  /** null when the object has no rectangle (a font, an image resource, …) */
  rect: ObjectRect | null;
  basis: ObjectLocationBasis;
}

/** locate_objects result for one requested object number */
export interface LocatedObject {
  objectNumber: number;
  /** Generation as present in the document; null when the object was not found */
  generation: number | null;
  /** false when no object with this number exists — e.g. freed by a revision */
  found: boolean;
  type: string | null;
  subtype: string | null;
  /** `/T` of a form field, when readable (never for an encrypted document) */
  fieldName: string | null;
  locations: ObjectLocation[];
  /** Why there is no location, or what the returned one does and does not mean */
  reason: string | null;
}

/** locate_objects output */
export interface ObjectLocationResult {
  objects: LocatedObject[];
  isEncrypted: boolean;
  notes: string[];
}

// ─── XMP metadata (ISO 32000-2 §14.3.2) — shared by inspect_catalog and summarize ───

/**
 * What the document-level XMP packet declares. Every value here is **as written** —
 * a declaration, not a verified property. `null` for a block means that block's
 * properties were not found in the packet.
 */
export interface XmpDeclarations {
  /** PDF/A identification (`pdfaid:part` / `pdfaid:conformance`). Verified by pdf-verify-mcp, not here. */
  pdfaid: { part: number | null; conformance: string | null } | null;
  /** PDF/UA identification (`pdfuaid:part`). A claim about the structure tree, not a verdict on it. */
  pdfuaid: { part: number | null } | null;
  /**
   * W3C TDM Reservation Protocol (TDMRep), namespace `http://www.w3.org/ns/tdmrep#`.
   * `reservation` is 1 when the rights holder reserves text-and-data-mining rights, 0 when
   * they do not; `policy` is the URL of the licensing policy when one is given. This server
   * reports the statement; whether to honour it is the caller's decision (#28).
   */
  tdm: { reservation: number | null; policy: string | null } | null;
}

/**
 * The document-level `/Metadata` stream. `null` at the call site means the catalog has no
 * `/Metadata` key — the packet is **absent**. `unreadable` means the key is there but the
 * stream could not be reached or decoded; nothing can be said about what it declares.
 */
export type XmpMetadataInfo =
  | {
      status: 'read';
      /** Decoded packet length in bytes. */
      bytes: number;
      /** `/Subtype` of the stream dictionary (`XML` per §14.3.2), or null when not written. */
      subtype: string | null;
      /** Every `xmlns:` declaration in the packet, so a caller can see which vocabularies are present. */
      namespaces: { prefix: string; uri: string }[];
      declarations: XmpDeclarations;
      /** The packet text. Present from the service; dropped from the tool output unless `include_xmp` is set. */
      xml?: string;
    }
  | { status: 'unreadable'; reason: string };

// ─── inspect_catalog (ISO 32000-2 §7.7.2, Table 29) ───

/** One outline item (§12.3.3), flattened with its depth. */
export interface OutlineItemInfo {
  title: string | null;
  /** 1 for a top-level item. */
  depth: number;
  /**
   * Where the item points. `page` is 1-based when the destination names a page object in
   * this document's page tree; `named` carries a named destination that was not resolved;
   * `action` is the `/S` of an action dictionary used instead of a destination.
   */
  page: number | null;
  named: string | null;
  action: string | null;
}

export interface OutlinesInfo {
  /** All items in the tree, counted by walking `/First` / `/Next` (not `/Count`, which may be wrong). */
  count: number;
  maxDepth: number;
  /** The first `max_outline_items` items in document order. */
  items: OutlineItemInfo[];
  truncated: boolean;
}

/** Optional content (layers), §8.11.4. */
export interface OptionalContentInfo {
  /** `/OCGs` — every optional content group, with its `/Name`. */
  groups: { name: string | null; ref: string | null }[];
  /** The default configuration `/D` (§8.11.4.3). */
  defaultConfig: {
    name: string | null;
    baseState: 'ON' | 'OFF' | 'Unchanged' | null;
    on: number;
    off: number;
  } | null;
  /** Number of alternate configurations in `/Configs`. */
  alternateConfigs: number;
}

/** One entry of the `/EmbeddedFiles` name tree (§7.7.4, §7.11.4). */
export interface EmbeddedFileInfo {
  /** The name-tree key. */
  key: string;
  /** `/UF` when present, else `/F`, of the file specification dictionary. */
  fileName: string | null;
  /** `/Subtype` of the embedded file stream — a MIME type written as a name. */
  mimeType: string | null;
  /** `/Params /Size` when written, else the decoded stream length when the stream was readable. */
  size: number | null;
  /** `/AFRelationship` of the file specification (PDF 2.0, Table 43). */
  afRelationship: string | null;
  description: string | null;
}

export interface EmbeddedFilesInfo {
  count: number;
  files: EmbeddedFileInfo[];
  /** Leaves of the name tree whose file specification could not be read. */
  unreadable: number;
}

/** Document-level name trees other than `/EmbeddedFiles` (§7.7.4, Table 32). Counts only. */
export interface NameTreesInfo {
  /** `/Dests` — named destinations. */
  dests: number | null;
  /** `/JavaScript` — document-level ECMAScript actions (§12.6.4.17). Runs when the document opens. */
  javaScript: number | null;
}

/** An action dictionary (§12.6.2) or an explicit destination, as it appears at a trigger. */
export interface ActionInfo {
  /** `/S` of the action; `Destination` when the trigger holds a destination rather than an action. */
  type: string;
  /** For `GoTo`-like actions and destinations: the 1-based target page when resolved. */
  page: number | null;
  /** `/F` for `Launch` / `GoToR` / `GoToE` / `ImportData`, as a file name when readable. */
  file: string | null;
  /** `/URI` for `URI` actions. */
  uri: string | null;
  /** A named destination (§12.3.2.4) that was not resolved to a page. */
  named: string | null;
  /** Whether the dictionary carries `/JS` (ECMAScript). */
  hasJavaScript: boolean;
  /** `/S` of each further action in the `/Next` chain (§12.6.2), in order; empty when none. */
  next: string[];
}

export interface CatalogInventory {
  /**
   * `absent` = the catalog has no such key (an observed fact). `unreadable` = the key is
   * there but its value could not be resolved; nothing below it is known.
   */
  outlines: OutlinesInfo | { status: 'absent' } | { status: 'unreadable'; reason: string };
  optionalContent:
    | OptionalContentInfo
    | { status: 'absent' }
    | { status: 'unreadable'; reason: string };
  embeddedFiles:
    | EmbeddedFilesInfo
    | { status: 'absent' }
    | { status: 'unreadable'; reason: string };
  /** Associated files at document level (`/AF`, PDF 2.0 §14.13). */
  associatedFiles: number | null;
  names: NameTreesInfo | { status: 'absent' } | { status: 'unreadable'; reason: string };
  /** `/Metadata`. `absent` when the catalog has no such key. */
  metadata: XmpMetadataInfo | { status: 'absent' };
  /** `/OpenAction` — what happens when the document is opened (§7.7.2). */
  openAction: ActionInfo | { status: 'absent' } | { status: 'unreadable'; reason: string };
  /** `/AA` — document-level trigger events (§12.6.3, Table 200: WC, WS, DS, WP, DP). */
  additionalActions:
    | Record<string, ActionInfo>
    | { status: 'absent' }
    | { status: 'unreadable'; reason: string };
  /** `/Collection` — the document is a portfolio (§12.3.5). */
  collection: boolean;
  isEncrypted: boolean;
  /** Set when nothing below the catalog could be read (encrypted, key not derivable). */
  note?: string;
}
