/**
 * Generate additional test PDF fixtures for E2E testing.
 * Run with: npx tsx tests/fixtures/create-e2e-fixtures.ts
 *
 * Creates:
 *  - comprehensive_1.pdf : 4-page PDF with text and embedded images
 *  - tagged.pdf          : Tagged PDF with structure tree (Document/P/H1)
 *  - multi-font.pdf      : PDF using multiple font families
 *  - cid-font.pdf        : Type0 (composite/CID) fonts — embedded & not (High-1 regression)
 *  - image-kinds.pdf     : One image of each pdfjs ImageKind (High-2 / D-9 regression)
 *  - structured.pdf      : REAL tagged PDF with page-spanning elements (M-8)
 *  - actual-text-span.pdf: UNTAGGED PDF with Span-level /ActualText (#18, §14.9.4)
 *  - encrypted-actualtext.pdf: RC4-encrypted tagged PDF whose /ActualText is ciphertext (#18)
 *  - no-metadata.pdf     : PDF with no metadata set
 *  - corrupted.pdf       : Invalid file (non-PDF bytes)
 */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
} from 'pdf-lib';

const FIXTURES_DIR = new URL('.', import.meta.url).pathname;

/**
 * Create a tagged PDF with structure tree markers.
 *
 * pdf-lib doesn't natively support Tagged PDF creation,
 * so we manually set MarkInfo and create a minimal StructTreeRoot.
 */
async function createTaggedPdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const context = doc.context;

  // Page 1: Heading + Paragraphs
  const page1 = doc.addPage([595, 842]);
  page1.drawText('Tagged PDF Document', {
    x: 50,
    y: 780,
    size: 24,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  page1.drawText('This is the first paragraph of the tagged document.', {
    x: 50,
    y: 740,
    size: 12,
    font,
  });
  page1.drawText('This is the second paragraph with more content.', {
    x: 50,
    y: 720,
    size: 12,
    font,
  });
  page1.drawText('Accessibility features are essential for PDF/UA compliance.', {
    x: 50,
    y: 700,
    size: 12,
    font,
  });

  // Page 2: Sub-heading + Paragraphs
  const page2 = doc.addPage([595, 842]);
  page2.drawText('Section Two', {
    x: 50,
    y: 780,
    size: 18,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  page2.drawText('Content on the second page of the tagged document.', {
    x: 50,
    y: 740,
    size: 12,
    font,
  });

  // Set MarkInfo → Marked = true (tagged indicator)
  const markInfoDict = context.obj({ Marked: true });
  doc.catalog.set(PDFName.of('MarkInfo'), markInfoDict);

  // Create minimal StructTreeRoot
  // Structure: StructTreeRoot → Document → [H1, P, P, P, H2, P]
  const pTag1 = context.obj({ Type: PDFName.of('StructElem'), S: PDFName.of('P') });
  const pRef1 = context.register(pTag1);
  const pTag2 = context.obj({ Type: PDFName.of('StructElem'), S: PDFName.of('P') });
  const pRef2 = context.register(pTag2);
  const pTag3 = context.obj({ Type: PDFName.of('StructElem'), S: PDFName.of('P') });
  const pRef3 = context.register(pTag3);
  const pTag4 = context.obj({ Type: PDFName.of('StructElem'), S: PDFName.of('P') });
  const pRef4 = context.register(pTag4);

  const h1Tag = context.obj({ Type: PDFName.of('StructElem'), S: PDFName.of('H1') });
  const h1Ref = context.register(h1Tag);
  const h2Tag = context.obj({ Type: PDFName.of('StructElem'), S: PDFName.of('H2') });
  const h2Ref = context.register(h2Tag);

  const documentTag = context.obj({
    Type: PDFName.of('StructElem'),
    S: PDFName.of('Document'),
    K: [h1Ref, pRef1, pRef2, pRef3, h2Ref, pRef4],
  });
  const documentRef = context.register(documentTag);

  const structTreeRoot = context.obj({
    Type: PDFName.of('StructTreeRoot'),
    K: documentRef,
    ParentTree: context.obj({}),
  });
  doc.catalog.set(PDFName.of('StructTreeRoot'), structTreeRoot);

  // Metadata
  doc.setTitle('Tagged PDF Document');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('E2E test fixture - tagged PDF');
  doc.setKeywords(['tagged', 'pdf-ua', 'accessibility']);
  doc.setCreator('pdf-lib');
  doc.setProducer('pdf-reader-mcp test suite');

  const bytes = await doc.save();
  await writeFile(`${FIXTURES_DIR}/tagged.pdf`, bytes);
  console.log('Created: tagged.pdf (2 pages, tagged with structure tree)');
}

/**
 * Create a PDF using multiple different fonts.
 */
async function createMultiFontPdf(): Promise<void> {
  const doc = await PDFDocument.create();

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const courierBold = await doc.embedFont(StandardFonts.CourierBold);

  // Page 1: Sans-serif fonts
  const page1 = doc.addPage([595, 842]);
  page1.drawText('Multi-Font PDF Test', {
    x: 50,
    y: 780,
    size: 24,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  page1.drawText('Helvetica Regular: The quick brown fox jumps over the lazy dog.', {
    x: 50,
    y: 740,
    size: 12,
    font: helvetica,
  });
  page1.drawText('Helvetica Bold: The quick brown fox jumps over the lazy dog.', {
    x: 50,
    y: 720,
    size: 12,
    font: helveticaBold,
  });
  page1.drawText('Helvetica Oblique: The quick brown fox jumps over the lazy dog.', {
    x: 50,
    y: 700,
    size: 12,
    font: helveticaOblique,
  });

  // Page 2: Serif + Monospace fonts
  const page2 = doc.addPage([595, 842]);
  page2.drawText('Serif and Monospace Fonts', {
    x: 50,
    y: 780,
    size: 20,
    font: timesBold,
    color: rgb(0, 0, 0),
  });
  page2.drawText('Times Roman: The quick brown fox jumps over the lazy dog.', {
    x: 50,
    y: 740,
    size: 12,
    font: timesRoman,
  });
  page2.drawText('Times Bold: The quick brown fox jumps over the lazy dog.', {
    x: 50,
    y: 720,
    size: 12,
    font: timesBold,
  });
  page2.drawText('Courier Regular: The quick brown fox jumps over the lazy dog.', {
    x: 50,
    y: 700,
    size: 12,
    font: courier,
  });
  page2.drawText('Courier Bold: The quick brown fox jumps over the lazy dog.', {
    x: 50,
    y: 680,
    size: 12,
    font: courierBold,
  });

  // Metadata
  doc.setTitle('Multi-Font Test PDF');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('E2E test fixture - multiple fonts');
  doc.setCreator('pdf-lib');
  doc.setProducer('pdf-reader-mcp test suite');

  const bytes = await doc.save();
  await writeFile(`${FIXTURES_DIR}/multi-font.pdf`, bytes);
  console.log('Created: multi-font.pdf (2 pages, 7 font variations)');
}

/**
 * Create a PDF with no metadata set at all.
 */
async function createNoMetadataPdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.addPage([595, 842]);
  page.drawText('This PDF has no metadata.', {
    x: 50,
    y: 780,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText('It is used to test metadata validation edge cases.', {
    x: 50,
    y: 750,
    size: 12,
    font,
  });

  // Intentionally do NOT set any metadata
  // No title, author, subject, keywords, creator, producer

  const bytes = await doc.save();
  await writeFile(`${FIXTURES_DIR}/no-metadata.pdf`, bytes);
  console.log('Created: no-metadata.pdf (1 page, no metadata)');
}

/**
 * Create a comprehensive 4-page PDF with text and embedded images.
 *
 * Used by: image extraction tests, summarize tests, performance tests.
 * Requirements: 4 pages, text, title, images (detectedCount > 0), no annotations.
 */
async function createComprehensivePdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Valid minimal 1x1 red pixel PNG (generated with correct CRC32 and zlib compression)
  const pngBytes = Buffer.from(
    '89504e470d0a1a0a' + // PNG signature
      '0000000d49484452' + // IHDR chunk length=13
      '00000001' + // width: 1
      '00000001' + // height: 1
      '0802000000' + // bit depth 8, color type 2 (RGB), compression 0, filter 0, interlace 0
      '907753de' + // IHDR CRC
      '0000000c' + // IDAT chunk length=12
      '49444154' + // "IDAT"
      '789c63f8cfc0000003010100' + // zlib-compressed pixel data (filter=0, R=255, G=0, B=0)
      'c9fe92ef' + // IDAT CRC
      '00000000' + // IEND chunk length=0
      '49454e44' + // "IEND"
      'ae426082', // IEND CRC
    'hex',
  );
  const pngImage = await doc.embedPng(pngBytes);

  // Page 1: Title page with image
  const page1 = doc.addPage([595, 842]);
  page1.drawText('Comprehensive Test PDF', {
    x: 50,
    y: 780,
    size: 28,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  page1.drawText('A multi-page document with text and images.', {
    x: 50,
    y: 740,
    size: 12,
    font,
  });
  page1.drawImage(pngImage, { x: 50, y: 600, width: 100, height: 100 });

  // Page 2: Content page
  const page2 = doc.addPage([595, 842]);
  page2.drawText('Chapter 1: Introduction', {
    x: 50,
    y: 780,
    size: 20,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  page2.drawText('This chapter covers the basics of PDF structure.', {
    x: 50,
    y: 740,
    size: 12,
    font,
  });
  page2.drawText('PDF documents consist of objects, cross-reference tables, and trailers.', {
    x: 50,
    y: 720,
    size: 12,
    font,
  });

  // Page 3: Content page with image
  const page3 = doc.addPage([595, 842]);
  page3.drawText('Chapter 2: Advanced Topics', {
    x: 50,
    y: 780,
    size: 20,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  page3.drawText('Tagged PDF, accessibility, and digital signatures.', {
    x: 50,
    y: 740,
    size: 12,
    font,
  });
  page3.drawImage(pngImage, { x: 200, y: 500, width: 150, height: 150 });

  // Page 4: Summary
  const page4 = doc.addPage([595, 842]);
  page4.drawText('Summary', {
    x: 50,
    y: 780,
    size: 20,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  page4.drawText('This comprehensive test PDF covers multiple scenarios.', {
    x: 50,
    y: 740,
    size: 12,
    font,
  });

  // Set metadata
  doc.setTitle('Comprehensive Test PDF');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('E2E test fixture - comprehensive PDF with images');
  doc.setKeywords(['comprehensive', 'images', 'multi-page']);
  doc.setCreator('pdf-lib');
  doc.setProducer('pdf-reader-mcp test suite');

  const bytes = await doc.save();
  await writeFile(`${FIXTURES_DIR}/comprehensive_1.pdf`, bytes);
  console.log('Created: comprehensive_1.pdf (4 pages, text + images)');
}

/**
 * Create a PDF containing Type0 (composite / CID) fonts — the High-1 regression
 * fixture.
 *
 * Why this is built by hand: every other fixture uses `StandardFonts`, i.e.
 * simple fonts whose FontDescriptor sits on the font dictionary itself. Type0
 * fonts do NOT have a FontDescriptor there (ISO 32000-2 Table 119); it lives on
 * the CIDFont in DescendantFonts (Table 115, "Required; shall be an indirect
 * reference"). Because no fixture exercised that shape, `inspect_fonts` reported
 * `isEmbedded: false` for every Japanese PDF without any test noticing.
 *
 * The font programs here are stand-in bytes, never parsed: the embedding check
 * only asks whether FontFile/FontFile2/FontFile3 is present (§9.8.2 Table 121).
 * That keeps the fixture reproducible without shipping a CJK font binary.
 *
 * Four fonts, chosen so a naive "always true" implementation fails too:
 *  - F1 Type0 + CIDFont with FontFile2                 → embedded
 *  - F2 Type0 + CIDFont without any FontFile (indirect
 *       DescendantFonts array)                          → NOT embedded
 *  - F3 Type0 with no DescendantFonts (malformed)       → NOT embedded
 *  - Helvetica (simple font)                            → NOT embedded (standard 14)
 */
async function createCidFontPdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const page = doc.addPage([595, 842]);

  // A real simple font, so the page has visible text and the non-Type0 code
  // path stays covered.
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Type0 (CID) font fixture', {
    x: 50,
    y: 780,
    size: 18,
    font: helv,
    color: rgb(0, 0, 0),
  });
  page.drawText('F1: embedded CIDFontType2 / F2: not embedded / F3: malformed', {
    x: 50,
    y: 750,
    size: 10,
    font: helv,
  });

  // ── F1: embedded Type0 ────────────────────────────────
  const fontFileRef = context.register(
    context.flateStream(new Uint8Array([0x00, 0x01, 0x00, 0x00]), { Length1: 4 }),
  );
  const embeddedDescriptorRef = context.register(
    context.obj({
      Type: 'FontDescriptor',
      FontName: 'AAAAAA+NotoSansJP-Regular',
      Flags: 4,
      FontBBox: [-1002, -1048, 2928, 1808],
      ItalicAngle: 0,
      Ascent: 1160,
      Descent: -320,
      CapHeight: 733,
      StemV: 80,
      FontFile2: fontFileRef,
    }),
  );
  const embeddedCidFontRef = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: 'AAAAAA+NotoSansJP-Regular',
      CIDSystemInfo: {
        Registry: PDFString.of('Adobe'),
        Ordering: PDFString.of('Identity'),
        Supplement: 0,
      },
      FontDescriptor: embeddedDescriptorRef,
      DW: 1000,
      CIDToGIDMap: 'Identity',
    }),
  );
  const embeddedType0Ref = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      // Table 119: descendant's BaseFont + '-' + CMap name.
      BaseFont: 'AAAAAA+NotoSansJP-Regular-Identity-H',
      Encoding: 'Identity-H',
      DescendantFonts: [embeddedCidFontRef],
    }),
  );

  // ── F2: non-embedded Type0, via an INDIRECT DescendantFonts array ──
  // The array itself may be a reference; resolving it must not be skipped.
  const nonEmbeddedDescriptorRef = context.register(
    context.obj({
      Type: 'FontDescriptor',
      FontName: 'KozMinPr6N-Regular',
      Flags: 4,
      FontBBox: [-437, -340, 1147, 1317],
      ItalicAngle: 0,
      Ascent: 1137,
      Descent: -349,
      CapHeight: 742,
      StemV: 80,
      // No FontFile / FontFile2 / FontFile3 — the font program is not embedded.
    }),
  );
  const nonEmbeddedCidFontRef = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType0',
      BaseFont: 'KozMinPr6N-Regular',
      CIDSystemInfo: {
        Registry: PDFString.of('Adobe'),
        Ordering: PDFString.of('Japan1'),
        Supplement: 6,
      },
      FontDescriptor: nonEmbeddedDescriptorRef,
      DW: 1000,
    }),
  );
  const descendantArrayRef = context.register(context.obj([nonEmbeddedCidFontRef]));
  const nonEmbeddedType0Ref = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'KozMinPr6N-Regular-UniJIS-UCS2-H',
      Encoding: 'UniJIS-UCS2-H',
      DescendantFonts: descendantArrayRef,
    }),
  );

  // ── F3: malformed Type0 — DescendantFonts absent ──────
  // Required by Table 119, so this is invalid; the descriptor is unreachable
  // and embedding must not be asserted.
  const malformedType0Ref = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'BrokenCID-Identity-H',
      Encoding: 'Identity-H',
    }),
  );

  page.node.setFontDictionary(PDFName.of('F1'), embeddedType0Ref);
  page.node.setFontDictionary(PDFName.of('F2'), nonEmbeddedType0Ref);
  page.node.setFontDictionary(PDFName.of('F3'), malformedType0Ref);

  doc.setTitle('CID Font Test PDF');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('E2E fixture - Type0 / CIDFont embedding detection (High-1)');
  doc.setProducer('pdf-reader-mcp test suite');

  const bytes = await doc.save();
  await writeFile(`${FIXTURES_DIR}/cid-font.pdf`, bytes);
  console.log('Created: cid-font.pdf (1 page, 3 Type0 fonts + Helvetica)');
}

// ─── Minimal PNG encoder (for image-kinds.pdf) ──────────
//
// pdf-lib's embedPng needs real PNG bytes, and we want images whose decoded
// pdfjs ImageKind we control exactly. A dependency-free encoder is ~20 lines
// and keeps the fixture reproducible.

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

/** Encode raw pixels as a PNG. colorType: 2 = RGB, 6 = RGBA. */
function encodePng(width: number, height: number, colorType: 2 | 6, pixels: Buffer): Buffer {
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  // Each scanline is prefixed with a filter-type byte (0 = None).
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0;
    pixels.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Create a PDF with one image of each pdfjs ImageKind — the High-2 / D-9
 * regression fixture.
 *
 * Two bugs shared this blind spot:
 *  - High-2: the ImageKind mapping was wrong for all three kinds, and
 *    bitsPerComponent was hardcoded to 8 (contradicting 1bpp grayscale).
 *  - D-9: read_images extracted nothing at all, so no test could see either.
 *
 * `comprehensive_1.pdf` has images, but pdfjs never yields their decoded data,
 * so it cannot pin down colour space or bit depth. These three can:
 *  - Im1 RGB PNG          → ImageKind.RGB_24BPP (2)  → RGB, 8bpp
 *  - Im2 RGBA PNG (alpha) → ImageKind.RGBA_32BPP (3) → RGBA, 8bpp
 *  - Im3 1bpp DeviceGray  → ImageKind.GRAYSCALE_1BPP (1) → Grayscale, 1bpp
 *
 * Im3 is hand-built: pdf-lib has no API for a 1-bit image, and it is the case
 * that disproves the old `bitsPerComponent: 8` constant.
 */
async function createImageKindsPdf(): Promise<void> {
  const W = 8;
  const H = 8;

  const rgbPixels = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgbPixels[i * 3] = 255;
    rgbPixels[i * 3 + 1] = (i * 3) % 256;
    rgbPixels[i * 3 + 2] = 0;
  }
  const rgbaPixels = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgbaPixels[i * 4] = 0;
    rgbaPixels[i * 4 + 1] = 128;
    rgbaPixels[i * 4 + 2] = 255;
    rgbaPixels[i * 4 + 3] = (i * 4) % 256; // alpha → pdfjs reports RGBA_32BPP
  }

  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('ImageKind fixture: RGB / RGBA / Grayscale-1bpp', {
    x: 20,
    y: 270,
    size: 9,
    font,
    color: rgb(0, 0, 0),
  });

  const imRgb = await doc.embedPng(encodePng(W, H, 2, rgbPixels));
  page.drawImage(imRgb, { x: 20, y: 190, width: 60, height: 60 });

  const imRgba = await doc.embedPng(encodePng(W, H, 6, rgbaPixels));
  page.drawImage(imRgba, { x: 20, y: 110, width: 60, height: 60 });

  // 1bpp grayscale image XObject. 8 px per row = exactly 1 byte per row.
  const context = doc.context;
  const bits = Buffer.from([
    0b10101010, 0b01010101, 0b11001100, 0b00110011, 0b11110000, 0b00001111, 0b10011001, 0b01100110,
  ]);
  const grayRef = context.register(
    context.flateStream(bits, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: W,
      Height: H,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 1,
    }),
  );
  page.node.setXObject(PDFName.of('Im3'), grayRef);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(60, 0, 0, 60, 20, 30),
    drawObject('Im3'),
    popGraphicsState(),
  );

  doc.setTitle('Image Kinds Test PDF');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('E2E fixture - one image per pdfjs ImageKind (High-2 / D-9)');
  doc.setProducer('pdf-reader-mcp test suite');

  await writeFile(`${FIXTURES_DIR}/image-kinds.pdf`, await doc.save());
  console.log('Created: image-kinds.pdf (1 page, RGB + RGBA + 1bpp grayscale)');
}

/**
 * Create a REAL tagged PDF — the M-8 fixture.
 *
 * `tagged.pdf` (above) is NOT a real tagged PDF: it has a StructTreeRoot with
 * StructElems, but the content stream carries no marked content, so nothing is
 * connected. pdfjs reports `{"children":[],"role":"Root"}` and zero
 * marked-content sequences for it. It cannot exercise anything that maps
 * structure to text.
 *
 * This fixture is the real thing: `/Tag <</MCID n>> BDC … EMC` around each piece
 * of content, a StructTreeRoot whose elements point back at those MCIDs, and a
 * ParentTree (which pdfjs's `getStructTree()` requires).
 *
 * The point of the fixture is the two PAGE-SPANNING elements:
 *
 *  - **P** — one paragraph, half on page 1 and half on page 2 (two MCRs).
 *  - **L** — one list, `LI` on page 1 and `LI` on page 2.
 *
 * ISO 32000-2 §14.8.2.5 NOTE 2 calls this out ("A logical object can extend over
 * more than one PDF page"), and it is what separates a correct implementation
 * from a plausible one: walking `page.getStructTree()` per page and merging —
 * which is what `extract_tables` / `inspect_tags` do — reports these as TWO
 * paragraphs and TWO lists, because pdfjs's per-page trees carry no element
 * identity. Only a depth-first walk of the document's StructTreeRoot keeps them
 * whole, which is exactly how §14.8.2.5 defines logical content order.
 *
 * Also included, one case each:
 *  - `ActualText` on a P whose glyphs read "Dif`cult" → text must be "Difficult"
 *  - `Alt` on a Figure with no text → must NOT leak into `text`
 *  - `Lbl` + `LBody` under each LI → the bullet must not end up in `text`
 *  - `Table` → TR → TH/TD (2 dimensions; the one shape `depth` cannot express)
 */
async function createStructuredPdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page1 = doc.addPage([595, 842]);
  const page2 = doc.addPage([595, 842]);

  /** Wrap a drawing call in `/Tag <</MCID n>> BDC … EMC`. */
  const marked = (page: typeof page1, mcid: number, tag: string, draw: () => void): void => {
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [`/${tag}`, `<</MCID ${mcid}>>`]),
    );
    draw();
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  };

  // ── Page 1 content (MCIDs are per-page and sequential) ──
  marked(page1, 0, 'H1', () =>
    page1.drawText('Quarterly Report', { x: 50, y: 780, size: 24, font: bold }),
  );
  marked(page1, 1, 'P', () =>
    page1.drawText('This paragraph begins on page one', { x: 50, y: 740, size: 12, font }),
  );
  marked(page1, 2, 'TH', () => page1.drawText('Item', { x: 50, y: 700, size: 12, font: bold }));
  marked(page1, 3, 'TH', () => page1.drawText('Amount', { x: 150, y: 700, size: 12, font: bold }));
  marked(page1, 4, 'TD', () => page1.drawText('Sales', { x: 50, y: 680, size: 12, font }));
  marked(page1, 5, 'TD', () => page1.drawText('100', { x: 150, y: 680, size: 12, font }));
  marked(page1, 6, 'Lbl', () => page1.drawText('*', { x: 50, y: 640, size: 12, font }));
  marked(page1, 7, 'LBody', () => page1.drawText('First item', { x: 65, y: 640, size: 12, font }));
  // The glyphs spell a ligature substitute; ActualText says what it really is.
  marked(page1, 8, 'P', () => page1.drawText('Dif`cult', { x: 50, y: 600, size: 12, font }));

  // ── Page 2 content ──
  marked(page2, 0, 'P', () =>
    page2.drawText('and continues on page two.', { x: 50, y: 780, size: 12, font }),
  );
  marked(page2, 1, 'Lbl', () => page2.drawText('*', { x: 50, y: 740, size: 12, font }));
  marked(page2, 2, 'LBody', () => page2.drawText('Second item', { x: 65, y: 740, size: 12, font }));
  // A Figure with no text at all — only Alt describes it.
  marked(page2, 3, 'Figure', () =>
    page2.drawRectangle({ x: 50, y: 660, width: 60, height: 40, color: rgb(0.2, 0.4, 0.8) }),
  );
  marked(page2, 4, 'P', () =>
    page2.drawText('Closing paragraph.', { x: 50, y: 620, size: 12, font }),
  );

  // ── Structure tree ──
  doc.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));

  const structRootRef = context.nextRef();
  const docRef = context.nextRef();
  const ref = () => context.nextRef();
  const [
    h1,
    pSpan,
    table,
    tr1,
    tr2,
    th1,
    th2,
    td1,
    td2,
    list,
    li1,
    li2,
    lbl1,
    lbody1,
    lbl2,
    lbody2,
    pActual,
    figure,
    pClose,
  ] = Array.from({ length: 19 }, ref);

  const p1Ref = page1.ref;
  const p2Ref = page2.ref;

  /** Build a StructElem dictionary. `Pg` is omitted when children carry their own. */
  const elem = (
    S: string,
    parent: ReturnType<typeof ref>,
    K?: unknown,
    Pg?: ReturnType<typeof ref>,
    extra: Record<string, unknown> = {},
  ) => {
    const d: Record<string, unknown> = { Type: 'StructElem', S, P: parent, ...extra };
    if (Pg) d.Pg = Pg;
    if (K !== undefined) d.K = K;
    return context.obj(d);
  };

  context.assign(h1, elem('H1', docRef, 0, p1Ref));

  // ★ The page-spanning paragraph: two MCRs, one per page, under ONE element.
  context.assign(
    pSpan,
    elem('P', docRef, [
      context.obj({ Type: 'MCR', Pg: p1Ref, MCID: 1 }),
      context.obj({ Type: 'MCR', Pg: p2Ref, MCID: 0 }),
    ]),
  );

  context.assign(th1, elem('TH', tr1, 2, p1Ref));
  context.assign(th2, elem('TH', tr1, 3, p1Ref));
  context.assign(td1, elem('TD', tr2, 4, p1Ref));
  context.assign(td2, elem('TD', tr2, 5, p1Ref));
  context.assign(tr1, elem('TR', table, [th1, th2]));
  context.assign(tr2, elem('TR', table, [td1, td2]));
  context.assign(table, elem('Table', docRef, [tr1, tr2]));

  context.assign(lbl1, elem('Lbl', li1, 6, p1Ref));
  context.assign(lbody1, elem('LBody', li1, 7, p1Ref));
  context.assign(li1, elem('LI', list, [lbl1, lbody1]));
  context.assign(lbl2, elem('Lbl', li2, 1, p2Ref));
  context.assign(lbody2, elem('LBody', li2, 2, p2Ref));
  context.assign(li2, elem('LI', list, [lbl2, lbody2]));
  // ★ The page-spanning list: LI on page 1, LI on page 2, under ONE element.
  context.assign(list, elem('L', docRef, [li1, li2]));

  context.assign(pActual, elem('P', docRef, 8, p1Ref, { ActualText: PDFString.of('Difficult') }));
  context.assign(
    figure,
    elem('Figure', docRef, 3, p2Ref, { Alt: PDFString.of('A bar chart of sales') }),
  );
  context.assign(pClose, elem('P', docRef, 4, p2Ref));

  context.assign(
    docRef,
    elem('Document', structRootRef, [h1, pSpan, table, list, pActual, figure, pClose]),
  );

  // ParentTree: StructParents index → array indexed by MCID → owning StructElem.
  // Required by pdfjs's getStructTree(). Note that `pSpan` appears in BOTH pages'
  // arrays — that is what a page-spanning element looks like from the page side.
  page1.node.set(PDFName.of('StructParents'), context.obj(0));
  page2.node.set(PDFName.of('StructParents'), context.obj(1));
  const parentTree = context.obj({
    Nums: [
      0,
      [h1, pSpan, th1, th2, td1, td2, lbl1, lbody1, pActual],
      1,
      [pSpan, lbl2, lbody2, figure, pClose],
    ],
  });
  context.assign(
    structRootRef,
    context.obj({
      Type: 'StructTreeRoot',
      K: [docRef],
      ParentTree: context.register(parentTree),
      ParentTreeNextKey: 2,
    }),
  );
  doc.catalog.set(PDFName.of('StructTreeRoot'), structRootRef);

  doc.setTitle('Structured Text Test PDF');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('E2E fixture - real tagged PDF with page-spanning elements (M-8)');
  doc.setProducer('pdf-reader-mcp test suite');
  doc.setLanguage('en-US');

  await writeFile(`${FIXTURES_DIR}/structured.pdf`, await doc.save());
  console.log('Created: structured.pdf (2 pages, real tags, page-spanning P and L)');
}

/**
 * Create spanning-table.pdf — a 2-page PDF whose ONE `Table` StructElem
 * continues across the page break (#14).
 *
 * Structure: Document > Table > [ THead > TR(TH,TH) @p1,
 * TBody > TR(TD,TD) @p1 + TR(TD,TD) @p2 ]. The second body row lives on
 * page 2 — a table that a per-page walk would slice into two fragments,
 * but that the StructTreeRoot walker must report as ONE table with
 * `pages: [1, 2]`.
 */
async function createSpanningTablePdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page1 = doc.addPage([595, 842]);
  const page2 = doc.addPage([595, 842]);

  const marked = (page: typeof page1, mcid: number, tag: string, draw: () => void): void => {
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [`/${tag}`, `<</MCID ${mcid}>>`]),
    );
    draw();
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  };

  // Page 1: header row + first body row.
  marked(page1, 0, 'TH', () => page1.drawText('Item', { x: 50, y: 780, size: 12, font: bold }));
  marked(page1, 1, 'TH', () => page1.drawText('Amount', { x: 150, y: 780, size: 12, font: bold }));
  marked(page1, 2, 'TD', () => page1.drawText('Sales', { x: 50, y: 760, size: 12, font }));
  marked(page1, 3, 'TD', () => page1.drawText('100', { x: 150, y: 760, size: 12, font }));
  // Page 2: the continuation row.
  marked(page2, 0, 'TD', () => page2.drawText('Costs', { x: 50, y: 780, size: 12, font }));
  marked(page2, 1, 'TD', () => page2.drawText('60', { x: 150, y: 780, size: 12, font }));

  doc.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));

  const structRootRef = context.nextRef();
  const docRef = context.nextRef();
  const ref = () => context.nextRef();
  const [table, thead, tbody, trH, tr1, tr2, thA, thB, td1a, td1b, td2a, td2b] = Array.from(
    { length: 12 },
    ref,
  );

  const p1Ref = page1.ref;
  const p2Ref = page2.ref;

  const elem = (
    S: string,
    parent: ReturnType<typeof ref>,
    K?: unknown,
    Pg?: ReturnType<typeof ref>,
  ) => {
    const d: Record<string, unknown> = { Type: 'StructElem', S, P: parent };
    if (Pg) d.Pg = Pg;
    if (K !== undefined) d.K = K;
    return context.obj(d);
  };

  context.assign(thA, elem('TH', trH, 0, p1Ref));
  context.assign(thB, elem('TH', trH, 1, p1Ref));
  context.assign(trH, elem('TR', thead, [thA, thB]));
  context.assign(thead, elem('THead', table, [trH]));

  context.assign(td1a, elem('TD', tr1, 2, p1Ref));
  context.assign(td1b, elem('TD', tr1, 3, p1Ref));
  context.assign(tr1, elem('TR', tbody, [td1a, td1b]));
  // ★ The continuation row: its cells' content lives on page 2.
  context.assign(td2a, elem('TD', tr2, 0, p2Ref));
  context.assign(td2b, elem('TD', tr2, 1, p2Ref));
  context.assign(tr2, elem('TR', tbody, [td2a, td2b]));
  context.assign(tbody, elem('TBody', table, [tr1, tr2]));

  context.assign(table, elem('Table', docRef, [thead, tbody]));
  context.assign(docRef, elem('Document', structRootRef, [table]));

  page1.node.set(PDFName.of('StructParents'), context.obj(0));
  page2.node.set(PDFName.of('StructParents'), context.obj(1));
  const parentTree = context.obj({
    Nums: [0, [thA, thB, td1a, td1b], 1, [td2a, td2b]],
  });
  context.assign(
    structRootRef,
    context.obj({
      Type: 'StructTreeRoot',
      K: [docRef],
      ParentTree: context.register(parentTree),
      ParentTreeNextKey: 2,
    }),
  );
  doc.catalog.set(PDFName.of('StructTreeRoot'), structRootRef);

  doc.setTitle('Spanning Table Test PDF');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('E2E fixture - ONE Table StructElem continuing across a page break (#14)');
  doc.setProducer('pdf-reader-mcp test suite');

  await writeFile(`${FIXTURES_DIR}/spanning-table.pdf`, await doc.save());
  console.log('Created: spanning-table.pdf (2 pages, one Table element across the break)');
}

/**
 * Create a corrupted "PDF" file (non-PDF bytes).
 */
/**
 * `/ActualText` on **marked-content sequences**, in an UNTAGGED document (#18).
 *
 * This is the second of the two places ISO 32000-2 §14.9.4 allows replacement
 * text, and the one no structure-tree walk can reach:
 *
 * > (PDF 1.5) A marked-content sequence (see 14.6, "Marked content"), through
 * > an ActualText entry in a property list attached to the marked-content
 * > sequence with a Span tag.
 *
 * The document deliberately has **no** `StructTreeRoot` and no `/MarkInfo`, so
 * anything that resolves it had to read the content stream.
 *
 * **Page 1** is the clause's EXAMPLE — German hyphenation used to change the
 * spelling of "Drucker", and `/ActualText (c)` puts the `c` back where the
 * glyphs say `k-`:
 *
 * ```
 * (Dru) Tj /Span <</ActualText (c)>> BDC (k-) Tj EMC (ker) Tj
 * ```
 *
 * It is drawn on one line so the fixture tests the substitution itself; the
 * cross-line case gets its own page.
 *
 * **Page 2** exercises R-14.9.4-3 — "If each of two (or more) consecutive
 * structure or marked-content sequences has an ActualText entry, they shall be
 * treated as if no word break is present between them." Two Spans, each with
 * `/ActualText`, on two different lines: "Bäcke-" + "rei" must read "Bäckerei"
 * with nothing between, line break included. Their values are hex strings with
 * a UTF-16BE BOM, which is also the encoding path a real producer uses for
 * anything outside ASCII.
 */
async function createActualTextSpanPdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  /** A PDF hex string holding `text` as UTF-16BE with a BOM (§7.9.2.2). */
  const utf16Hex = (text: string): string => {
    let hex = 'FEFF';
    for (const unit of text) {
      const code = unit.codePointAt(0) ?? 0;
      hex += code.toString(16).padStart(4, '0').toUpperCase();
    }
    return `<${hex}>`;
  };

  const setContent = (page: ReturnType<typeof doc.addPage>, operators: string): void => {
    const fontName = page.node.newFontDictionary('F1', font.ref);
    const stream = doc.context.stream(`BT ${fontName} 12 Tf ${operators} ET`);
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  };

  const page1 = doc.addPage([300, 200]);
  setContent(page1, '20 150 Td (Dru) Tj /Span <</ActualText (c)>> BDC (k-) Tj EMC (ker) Tj');

  const page2 = doc.addPage([300, 200]);
  setContent(
    page2,
    `20 150 Td /Span <</ActualText ${utf16Hex('Bäcke')}>> BDC (Bäcke-) Tj EMC ` +
      `0 -20 Td /Span <</ActualText ${utf16Hex('rei')}>> BDC (rei) Tj EMC`,
  );

  // No MarkInfo, no StructTreeRoot: the point is that this is NOT a tagged PDF.
  await writeFile(`${FIXTURES_DIR}/actual-text-span.pdf`, await doc.save());
  console.log('Created: actual-text-span.pdf (untagged, Span-level /ActualText, §14.9.4)');
}

/**
 * An **encrypted** tagged PDF whose `/ActualText` must NOT be trusted (#18).
 *
 * ISO 32000-2 §7.6.2 encrypts *strings and streams* and nothing else. So an
 * encrypted document's structure tree still walks perfectly — names, numbers and
 * references are all in the clear — while every string in it is ciphertext. The
 * reader loads pdf-lib with `ignoreEncryption`, which ignores encryption rather
 * than undoing it, so the `/ActualText` pdf-lib hands back is the ciphertext.
 *
 * Before this fixture existed, that ciphertext went straight into `read_text`.
 * Measured on `PDF32000_2008.pdf` (owner-password encrypted, opens fine in any
 * viewer): 18026 `/ActualText` entries, every one of them bytes like `&)ð`,
 * each one *replacing* the page text it was attached to. Page 1's title came out
 * as "Document management&)ð — 6±o Portable document format…".
 *
 * The fixture is written by hand rather than with pdf-lib, which cannot produce
 * encrypted files. It uses the standard security handler at V1/R2 (RC4, 40-bit)
 * with an empty user password — the "permissions only" encryption that real
 * documents like the one above use. The glyphs read `Dif\`cult` and the
 * (encrypted) `/ActualText` says `Difficult`; a reader that resolved it here
 * would be resolving ciphertext, so `read_text` must return the glyphs.
 */
async function createEncryptedActualTextPdf(): Promise<void> {
  /** §7.6.4.3 Table 25 — the 32-byte padding string. */
  const PAD = Buffer.from([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
  ]);
  const md5 = (...bufs: Buffer[]): Buffer => createHash('md5').update(Buffer.concat(bufs)).digest();

  function rc4(key: Buffer, data: Buffer): Buffer {
    const s = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 0xff;
      [s[i], s[j]] = [s[j], s[i]];
    }
    const out = Buffer.alloc(data.length);
    let i = 0;
    j = 0;
    for (let k = 0; k < data.length; k++) {
      i = (i + 1) & 0xff;
      j = (j + s[i]) & 0xff;
      [s[i], s[j]] = [s[j], s[i]];
      out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
    }
    return out;
  }

  const permissions = -1;
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(permissions, 0);
  const fileId = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');

  // Algorithm 3: /O, from the owner password — absent, so the user password
  // (also empty) is padded and used instead.
  const O = rc4(md5(PAD).subarray(0, 5), PAD);
  // Algorithm 2: the file encryption key.
  const key = md5(PAD, O, pBytes, fileId).subarray(0, 5);
  // Algorithm 4: /U for R2.
  const U = rc4(key, PAD);
  // Algorithm 1: the per-object key is the file key plus the object and
  // generation numbers, little-endian, hashed.
  const objectKey = (num: number, gen = 0): Buffer =>
    md5(
      key,
      Buffer.from([
        num & 0xff,
        (num >> 8) & 0xff,
        (num >> 16) & 0xff,
        gen & 0xff,
        (gen >> 8) & 0xff,
      ]),
    ).subarray(0, Math.min(key.length + 5, 16));

  const hex = (buf: Buffer): string => `<${buf.toString('hex').toUpperCase()}>`;
  const content = rc4(
    objectKey(4),
    Buffer.from('/P <</MCID 0>> BDC BT /F1 12 Tf 20 50 Td (Dif`cult) Tj ET EMC\n', 'latin1'),
  );
  const actualText = rc4(objectKey(7), Buffer.from('Difficult', 'latin1'));

  const objects: (string | null)[] = [
    '<</Type/Catalog/Pages 2 0 R/MarkInfo<</Marked true>>/StructTreeRoot 6 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R/StructParents 0>>',
    null, // 4 — the content stream, written separately
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    '<</Type/StructTreeRoot/K 7 0 R>>',
    `<</Type/StructElem/S/P/P 6 0 R/Pg 3 0 R/K 0/ActualText ${hex(actualText)}>>`,
    // The /Encrypt dictionary's own strings are exempt from encryption (§7.6.2).
    `<</Filter/Standard/V 1/R 2/Length 40/O ${hex(O)}/U ${hex(U)}/P ${permissions}>>`,
  ];

  const parts: Buffer[] = [];
  let offset = 0;
  const push = (chunk: string | Buffer): void => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1');
    parts.push(bytes);
    offset += bytes.length;
  };
  const offsets: number[] = [];

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  for (let i = 0; i < objects.length; i++) {
    offsets[i + 1] = offset;
    if (objects[i] === null) {
      push(`${i + 1} 0 obj\n<</Length ${content.length}>>\nstream\n`);
      push(content);
      push('\nendstream\nendobj\n');
    } else {
      push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
    }
  }

  const startxref = offset;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(table);
  push(
    `trailer\n<</Size ${objects.length + 1}/Root 1 0 R/Encrypt 8 0 R/ID[${hex(fileId)}${hex(fileId)}]>>\n` +
      `startxref\n${startxref}\n%%EOF\n`,
  );

  await writeFile(`${FIXTURES_DIR}/encrypted-actualtext.pdf`, Buffer.concat(parts));
  console.log('Created: encrypted-actualtext.pdf (RC4 40-bit, tagged, /ActualText is ciphertext)');
}

async function createCorruptedPdf(): Promise<void> {
  const data = Buffer.from('This is not a PDF file. Just random text content.\n'.repeat(10));
  await writeFile(`${FIXTURES_DIR}/corrupted.pdf`, data);
  console.log('Created: corrupted.pdf (invalid, non-PDF bytes)');
}

async function main(): Promise<void> {
  // An optional argv narrows the run to one fixture, so adding a fixture does
  // not force regenerating (and re-committing) every existing one.
  const only = process.argv[2];
  const creators: Array<[string, () => Promise<void>]> = [
    ['comprehensive', createComprehensivePdf],
    ['tagged', createTaggedPdf],
    ['multi-font', createMultiFontPdf],
    ['cid-font', createCidFontPdf],
    ['image-kinds', createImageKindsPdf],
    ['structured', createStructuredPdf],
    ['spanning-table', createSpanningTablePdf],
    ['actual-text-span', createActualTextSpanPdf],
    ['encrypted-actualtext', createEncryptedActualTextPdf],
    ['no-metadata', createNoMetadataPdf],
    ['corrupted', createCorruptedPdf],
  ];
  const wanted = creators.filter(([name]) => !only || name === only);
  if (wanted.length === 0) {
    throw new Error(`Unknown fixture "${only}". Known: ${creators.map(([n]) => n).join(', ')}`);
  }
  for (const [, create] of wanted) await create();
  console.log(only ? `Fixture created: ${only}` : 'All E2E test fixtures created.');
}

main().catch(console.error);
