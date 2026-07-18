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
 *  - no-metadata.pdf     : PDF with no metadata set
 *  - corrupted.pdf       : Invalid file (non-PDF bytes)
 */

import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  PDFName,
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
 * Create a corrupted "PDF" file (non-PDF bytes).
 */
async function createCorruptedPdf(): Promise<void> {
  const data = Buffer.from('This is not a PDF file. Just random text content.\n'.repeat(10));
  await writeFile(`${FIXTURES_DIR}/corrupted.pdf`, data);
  console.log('Created: corrupted.pdf (invalid, non-PDF bytes)');
}

async function main(): Promise<void> {
  await createComprehensivePdf();
  await createTaggedPdf();
  await createMultiFontPdf();
  await createCidFontPdf();
  await createImageKindsPdf();
  await createNoMetadataPdf();
  await createCorruptedPdf();
  console.log('All E2E test fixtures created.');
}

main().catch(console.error);
