/**
 * Generate test PDF fixtures using pdf-lib.
 * Run with: npx tsx tests/fixtures/create-test-pdf.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const FIXTURES_DIR = new URL('.', import.meta.url).pathname;

async function createSimplePdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Page 1
  const page1 = doc.addPage([595, 842]); // A4
  page1.drawText('Hello PDF World', { x: 50, y: 780, size: 24, font, color: rgb(0, 0, 0) });
  page1.drawText('This is a test PDF document for pdf-reader-mcp.', {
    x: 50,
    y: 740,
    size: 12,
    font,
  });
  page1.drawText('It contains multiple pages with searchable text.', {
    x: 50,
    y: 720,
    size: 12,
    font,
  });
  page1.drawText('Digital signatures are important for document integrity.', {
    x: 50,
    y: 700,
    size: 12,
    font,
  });

  // Page 2
  const page2 = doc.addPage([595, 842]);
  page2.drawText('Page Two', { x: 50, y: 780, size: 24, font, color: rgb(0, 0, 0) });
  page2.drawText('This page has different content for search testing.', {
    x: 50,
    y: 740,
    size: 12,
    font,
  });
  page2.drawText('PDF internal structure includes objects, xref tables, and trailers.', {
    x: 50,
    y: 720,
    size: 12,
    font,
  });

  // Page 3
  const page3 = doc.addPage([595, 842]);
  page3.drawText('Page Three', { x: 50, y: 780, size: 24, font, color: rgb(0, 0, 0) });
  page3.drawText('The final page of this test document.', { x: 50, y: 740, size: 12, font });

  // Set metadata
  doc.setTitle('Test PDF Document');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('Test fixture');
  doc.setKeywords(['test', 'pdf', 'mcp']);
  doc.setCreator('pdf-lib');
  doc.setProducer('pdf-reader-mcp test suite');

  const bytes = await doc.save();
  await writeFile(`${FIXTURES_DIR}/simple.pdf`, bytes);
  console.log('Created: simple.pdf (3 pages)');
}

async function createEmptyPdf(): Promise<void> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]); // Single blank page
  const bytes = await doc.save();
  await writeFile(`${FIXTURES_DIR}/empty.pdf`, bytes);
  console.log('Created: empty.pdf (1 blank page)');
}

async function main(): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });
  await createSimplePdf();
  await createEmptyPdf();
  console.log('All test fixtures created.');
}

main().catch(console.error);
