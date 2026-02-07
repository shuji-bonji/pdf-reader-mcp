/**
 * Generate additional test PDF fixtures for E2E testing.
 * Run with: npx tsx tests/fixtures/create-e2e-fixtures.ts
 *
 * Creates:
 *  - tagged.pdf      : Tagged PDF with structure tree (Document/P/H1)
 *  - multi-font.pdf  : PDF using multiple font families
 *  - no-metadata.pdf : PDF with no metadata set
 *  - corrupted.pdf   : Invalid file (non-PDF bytes)
 */

import { writeFile } from 'node:fs/promises';
import { PDFDocument, PDFName, rgb, StandardFonts } from 'pdf-lib';

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
 * Create a corrupted "PDF" file (non-PDF bytes).
 */
async function createCorruptedPdf(): Promise<void> {
  const data = Buffer.from('This is not a PDF file. Just random text content.\n'.repeat(10));
  await writeFile(`${FIXTURES_DIR}/corrupted.pdf`, data);
  console.log('Created: corrupted.pdf (invalid, non-PDF bytes)');
}

async function main(): Promise<void> {
  await createTaggedPdf();
  await createMultiFontPdf();
  await createNoMetadataPdf();
  await createCorruptedPdf();
  console.log('All E2E test fixtures created.');
}

main().catch(console.error);
