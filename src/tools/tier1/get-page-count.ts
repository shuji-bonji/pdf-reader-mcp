/**
 * get_page_count - Lightweight page count retrieval.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { asDict, get, integerOf, resolved } from '@normativepdf/recover';
import { readPageTree } from 'normativepdf';
import { ResponseFormat } from '../../constants.js';
import { type GetPageCountInput, GetPageCountSchema } from '../../schemas/tier1.js';
import { loadDocument } from '../../services/pdfjs-service.js';
import { type PartOutcome, toOutcome } from '../../services/reading-scope.js';
import { lockedOut, openPdf } from '../../services/recover-service.js';
import {
  ENCRYPTED_PDF_HINT,
  handleStructuredError,
  PdfReaderError,
} from '../../utils/error-handler.js';

/** `get_page_count` の JSON の射程（SPEC-READER-GET-PAGE-COUNT-002）。 */
export interface PageCountScope {
  /** 根のページ木の節点の `/Count`（ISO 32000-2 §7.7.3.2）。読めなければ null。 */
  declaredCount: number | null;
  /** ページ木をたどって届いた葉の数。たどれなければ null。 */
  pagesReached: number | null;
  /** ページ木をたどれたか。 */
  pageTree: PartOutcome;
}

/**
 * `/Count` の宣言と、ページ木をたどった結果を読む。
 *
 * 🔴 ページ数は pdfjs の `numPages`（主に `/Count`）で、ほかのツールの `pages` の検査も
 * 同じ数を使う。`/Count` は書き手の宣言で（R-7.7.3.2-8 は書き手に一致を求めている）、
 * 実際の葉の数と違うことがある。どちらの数なのかを応答から分かるようにする。
 * 読めなかった値を 0 にしない —— 0 は「ページが無いと観測した」と読める。
 */
async function readPageCountScope(filePath: string): Promise<PageCountScope> {
  try {
    const { doc, scope } = await openPdf(filePath);
    if (lockedOut(scope)) {
      return {
        declaredCount: null,
        pagesReached: null,
        pageTree: toOutcome(
          new PdfReaderError(
            'The page tree could not be read: the key could not be derived.',
            'ENCRYPTED_PDF',
            ENCRYPTED_PDF_HINT,
            'ENCRYPTED_PDF',
          ),
        ),
      };
    }
    const catalog = asDict(await doc.getCatalog().catch(() => null));
    const root = asDict(await resolved(doc, get(catalog, 'Pages')));
    const declared = integerOf(await resolved(doc, get(root, 'Count')));
    const tree = await readPageTree(doc);
    if (!tree.reached) {
      return {
        declaredCount: declared ?? null,
        pagesReached: null,
        pageTree: toOutcome(
          new PdfReaderError(
            'The page tree could not be reached from the catalog (ISO 32000-2 §7.7.3).',
            'PAGE_TREE_UNREACHED',
            undefined,
            'INVALID_PDF',
          ),
        ),
      };
    }
    return {
      declaredCount: declared ?? null,
      pagesReached: tree.pages.length,
      pageTree: { status: 'read' },
    };
  } catch (error) {
    return { declaredCount: null, pagesReached: null, pageTree: toOutcome(error) };
  }
}

export function registerGetPageCount(server: McpServer): void {
  server.registerTool(
    'get_page_count',
    {
      title: 'Get PDF Page Count',
      description: `Get the total number of pages in a PDF document.

This is a lightweight operation that only reads the PDF header, not the full content.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  markdown (default) — the page count as a bare number, e.g. "126". This is the number the
  pages arguments of the other tools are checked against.
  json — { pageCount, scope }. scope.declaredCount is the /Count the root page tree node
  declares (ISO 32000-2 §7.7.3.2), scope.pagesReached is the number of pages reached by
  walking the page tree, and scope.pageTree says whether that walk could be done. The two
  numbers can differ in a file whose writer got /Count wrong; this server reports both and
  does not judge which is right. A value that could not be read is null, not 0.

Examples:
  - Quick check before deciding which pages to extract
  - Validate a PDF file is readable`,
      inputSchema: GetPageCountSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: GetPageCountInput) => {
      try {
        const doc = await loadDocument(params.file_path);
        let count: number;
        try {
          count = doc.numPages;
        } finally {
          await doc.destroy();
        }
        // 既定は数値だけ（互換。SPEC-READER-GET-PAGE-COUNT-001）
        if (params.response_format !== ResponseFormat.JSON) {
          return { content: [{ type: 'text' as const, text: String(count) }] };
        }
        const scope = await readPageCountScope(params.file_path);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ pageCount: count, scope }, null, 2) },
          ],
        };
      } catch (error) {
        const err = handleStructuredError(error);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(err, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
