/**
 * ページの資源辞書に載っているフォントを数える（`inspect_fonts`）。
 *
 * 🔴 **これは「描画に使われたフォント」ではない。** §7.8.3 の `/Resources /Font`
 * に載っているものを、ページごとに数え上げる。PDF/A が埋め込みを求めるのは
 * 描画に使われたフォントのほうで、そちらは `content-stream-service` の
 * `usedFonts` が答える（別の問いなので混ぜない）。
 *
 * ## S4（2026-08-31）で変わったこと
 *
 * 読み口を pdf-lib から `@normativepdf/recover` に替えた。振る舞いは 1 か所だけ
 * 変わる: **埋め込みの有無**である。pdf-lib の `PDFDict.has` はオブジェクト
 * ストリーム由来の鍵を外していた（`get` は通るのに `has` だけ false）ので、
 * 埋め込み済みのフォントを「未埋め込み」と誤報していた。recover の `has` は
 * §7.3.7 のとおり読むので、`isEmbedded` が false → true に直る検体がある。
 */

import { asArray, asDict, get, has, nameOf, resolved } from '@normativepdf/recover';
import { type CosDict, inheritedAttribute, type PdfDocument, readPageTree } from 'normativepdf';
import type { FontInfo } from '../types.js';
import { lockedOut, openPdf } from './recover-service.js';

/** Font analysis result including font map and total pages scanned */
export interface FontAnalysisResult {
  fontMap: Map<string, FontInfo>;
  pagesScanned: number;
  /**
   * Optional human-readable note describing partial / fallback results.
   * Set when the page tree could not be enumerated.
   */
  note?: string;
}

/**
 * Analyze fonts across all pages.
 *
 * ページ木に届かなかったときは空の地図と `note` を返す。**0 件の観測ではなく
 * 「観測できなかった」**なので、呼び出し側はその `note` を落とさないこと。
 */
export async function analyzeFonts(filePath: string): Promise<FontAnalysisResult> {
  const { doc, scope } = await openPdf(filePath);
  const fontMap = new Map<string, FontInfo>();

  // 🔴 鍵が導けないと間接オブジェクトを 1 つも読めない（ADR-0008）。
  // 「フォントが 0 個」と「フォントを見に行けなかった」を同じ 0 で言わない。
  if (lockedOut(scope)) {
    return {
      fontMap,
      pagesScanned: 0,
      note:
        'The document is encrypted and the key could not be derived from the empty user ' +
        'password (ISO 32000-2 §7.6.4.3.2), so no page could be read and no font could be ' +
        'looked at. This is not a document without fonts.',
    };
  }

  const tree = await readPageTree(doc).catch(() => null);
  const pages = tree?.reached ? tree.pages : [];

  if (pages.length === 0) {
    return {
      fontMap,
      pagesScanned: 0,
      note:
        'The page tree could not be walked from the catalogue (ISO 32000-2 §7.7.3); ' +
        'fonts could not be analyzed.',
    };
  }

  for (const page of pages) {
    const pageNum = page.index + 1;
    // `/Resources` は継承する（Table 31・§7.7.3.4）。
    const resources = asDict(await resolved(doc, inheritedAttribute(page, 'Resources')));
    const fontDict = asDict(await resolved(doc, get(resources, 'Font')));
    if (!fontDict) continue;

    for (const [fontKey, value] of fontDict.entries) {
      const actualFont = asDict(await resolved(doc, value));
      if (!actualFont) continue;

      const subtype = nameOf(await resolved(doc, get(actualFont, 'Subtype'))) ?? 'Unknown';
      const baseFontName = nameOf(await resolved(doc, get(actualFont, 'BaseFont'))) ?? fontKey;
      // pdf-lib 版は `/Encoding` を解決せずに直接値だけ名前として読んでいた。
      // 辞書で書かれた `/Encoding`（§9.6.6）は null になる。そこは変えていない。
      const encoding = nameOf(get(actualFont, 'Encoding'));

      // Check if font is embedded (has FontDescriptor with FontFile/FontFile2/FontFile3).
      //
      // For Type 0 (composite) fonts the FontDescriptor is NOT on the font
      // dictionary itself — ISO 32000-2 Table 119 has no such entry. It lives on
      // the CIDFont dictionary in DescendantFonts, where Table 115 marks it
      // "(Required; shall be an indirect reference)". §9.7.6.2 fixes the font
      // number at 0 ("In PDF, the font number shall be 0"), and Table 119
      // describes DescendantFonts as "a one-element array", so element 0 is the
      // only descendant to inspect.
      const descriptorHost =
        subtype === 'Type0' ? await resolveDescendantFont(doc, actualFont) : actualFont;
      const isEmbedded = descriptorHost ? await hasEmbeddedFontFile(doc, descriptorHost) : false;

      // Check if subset (name starts with 6 uppercase + '+')
      const isSubset = /^[A-Z]{6}\+/.test(baseFontName);

      const existing = fontMap.get(baseFontName);
      if (existing) {
        if (!existing.pagesUsed.includes(pageNum)) existing.pagesUsed.push(pageNum);
      } else {
        fontMap.set(baseFontName, {
          name: baseFontName,
          type: subtype,
          encoding,
          isEmbedded,
          isSubset,
          pagesUsed: [pageNum],
        });
      }
    }
  }

  return { fontMap, pagesScanned: pages.length };
}

/**
 * Resolve the CIDFont dictionary of a Type 0 (composite) font.
 *
 * ISO 32000-2 Table 119 defines DescendantFonts as "(Required) A one-element
 * array specifying the CIDFont dictionary that is the descendant of this Type 0
 * font", and §9.7.6.2 states "In PDF, the font number shall be 0" — so index 0
 * is the only descendant. The array itself may also be an indirect reference.
 *
 * Returns `null` for malformed fonts (missing / empty DescendantFonts), which
 * the caller reports as not embedded — the descriptor is unreachable, so
 * embedding cannot be asserted.
 */
async function resolveDescendantFont(
  doc: PdfDocument,
  type0Font: CosDict,
): Promise<CosDict | null> {
  const descendants = asArray(await resolved(doc, get(type0Font, 'DescendantFonts')));
  if (!descendants || descendants.items.length === 0) return null;
  return asDict(await resolved(doc, descendants.items[0]));
}

/**
 * Report whether a font dictionary's FontDescriptor carries an embedded font
 * program. ISO 32000-2 §9.8.2 Table 121: FontFile (Type 1), FontFile2
 * (TrueType), FontFile3 (Type 1C / CIDFontType0C / OpenType).
 */
async function hasEmbeddedFontFile(doc: PdfDocument, fontDict: CosDict): Promise<boolean> {
  const descriptor = asDict(await resolved(doc, get(fontDict, 'FontDescriptor')));
  if (!descriptor) return false;
  return (
    has(descriptor, 'FontFile') || has(descriptor, 'FontFile2') || has(descriptor, 'FontFile3')
  );
}
