/**
 * Generate test PDF fixtures using pdf-lib.
 * Run with: npx tsx tests/fixtures/create-test-pdf.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber, PDFString, rgb, StandardFonts } from 'pdf-lib';

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

/**
 * Create a PDF with annotations and form fields for Tier 2 testing.
 * Features: link annotations, text annotations, form fields (text + signature).
 */
async function createAnnotatedPdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const context = doc.context;

  // ─── Page 1: Link annotations ───────────────────────
  const page1 = doc.addPage([595, 842]);
  page1.drawText('Annotated PDF Test', {
    x: 50,
    y: 780,
    size: 24,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  page1.drawText('This PDF contains annotations and form fields for testing.', {
    x: 50,
    y: 740,
    size: 12,
    font: helvetica,
  });
  page1.drawText('Visit: https://github.com/shuji-bonji/pdf-reader-mcp', {
    x: 50,
    y: 700,
    size: 12,
    font: courier,
    color: rgb(0, 0, 0.8),
  });

  // Add link annotation on page 1
  const linkAnnot1 = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [50, 695, 450, 712],
    Border: [0, 0, 0],
    A: {
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of('https://github.com/shuji-bonji/pdf-reader-mcp'),
    },
  });
  const linkRef1 = context.register(linkAnnot1);

  // Add text annotation (comment) on page 1
  const textAnnot = context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [400, 750, 420, 770],
    Contents: PDFString.of('This is a test comment annotation.'),
    T: PDFString.of('Test Author'),
    Open: false,
    C: [1, 1, 0],
  });
  const textAnnotRef = context.register(textAnnot);

  // Set annotations on page 1
  page1.node.set(PDFName.of('Annots'), context.obj([linkRef1, textAnnotRef]));

  // ─── Page 2: Signature field ────────────────────────
  const page2 = doc.addPage([595, 842]);
  page2.drawText('Signature Page', {
    x: 50,
    y: 780,
    size: 24,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  page2.drawText('This page contains a signature field placeholder.', {
    x: 50,
    y: 740,
    size: 12,
    font: helvetica,
  });

  // Draw signature box outline
  page2.drawRectangle({
    x: 50,
    y: 600,
    width: 200,
    height: 60,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
  page2.drawText('Sign here:', { x: 55, y: 665, size: 10, font: helvetica });

  // Create signature field widget
  const sigFieldDict = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of('SignatureField1'),
    Rect: [50, 600, 250, 660],
    P: page2.ref,
  });
  const sigFieldRef = context.register(sigFieldDict);

  // Create text input field widget
  const textFieldDict = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Tx',
    T: PDFString.of('NameField'),
    Rect: [50, 540, 250, 560],
    V: PDFString.of(''),
  });
  const textFieldRef = context.register(textFieldDict);

  // Set annotations on page 2
  page2.node.set(PDFName.of('Annots'), context.obj([sigFieldRef, textFieldRef]));

  // Create AcroForm in the catalog
  const acroForm = context.obj({
    Fields: [sigFieldRef, textFieldRef],
    SigFlags: PDFNumber.of(3), // SignaturesExist + AppendOnly
  });
  doc.catalog.set(PDFName.of('AcroForm'), acroForm);

  // Set metadata
  doc.setTitle('Annotated Test PDF');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('Tier 2 test fixture');
  doc.setCreator('pdf-lib');
  doc.setProducer('pdf-reader-mcp test suite');

  const bytes = await doc.save();
  await writeFile(`${FIXTURES_DIR}/annotated.pdf`, bytes);
  console.log('Created: annotated.pdf (2 pages, annotations + form fields)');
}

async function main(): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });
  await createSimplePdf();
  await createEmptyPdf();
  await createAnnotatedPdf();
  console.log('All test fixtures created.');
}

main().catch(console.error);
