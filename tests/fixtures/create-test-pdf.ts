/**
 * Generate test PDF fixtures using pdf-lib.
 * Run with: npx tsx tests/fixtures/create-test-pdf.ts
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { PDFDocument, PDFName, PDFNumber, PDFString, rgb, StandardFonts } from 'pdf-lib';

const execFileAsync = promisify(execFile);

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
 * Untagged 2-column PDF for Issue #3 (`split_columns`) regression.
 *
 * Layout: A4 portrait, two columns sharing the page horizontally. Each
 * column has 4 lines stacked top-to-bottom. Y-coordinates are paired
 * across columns so that **plain Y-sort interleaves the columns**, while
 * `split_columns: 2` should restore left-then-right reading order.
 *
 *   LEFT-1                         RIGHT-1
 *   LEFT-2                         RIGHT-2
 *   LEFT-3                         RIGHT-3
 *   LEFT-4                         RIGHT-4
 *
 * No StructTree is added — this PDF is intentionally untagged to model
 * older 新旧対照表 PDFs that lack accessibility metadata.
 */
async function createTwoColumnPdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]); // A4
  const opts = { size: 14, font, color: rgb(0, 0, 0) };

  // 4 horizontally-paired lines in 2 columns.
  const ys = [780, 740, 700, 660];
  for (let i = 0; i < ys.length; i++) {
    page.drawText(`LEFT-${i + 1}`, { x: 80, y: ys[i], ...opts });
    page.drawText(`RIGHT-${i + 1}`, { x: 360, y: ys[i], ...opts });
  }

  doc.setTitle('Two-Column Test PDF');
  doc.setAuthor('pdf-reader-mcp');
  doc.setSubject('Issue #3 split_columns regression fixture');
  doc.setCreator('pdf-lib');

  const bytes = await doc.save();
  await writeFile(`${FIXTURES_DIR}/two-column.pdf`, bytes);
  console.log('Created: two-column.pdf (1 page, untagged 2 columns)');
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

/**
 * Linearized PDF fixture for Issue #1 regression
 * (`inspect_structure` / `inspect_fonts` must not throw on Linearized PDFs).
 *
 * Generated by piping `simple.pdf` through `qpdf --linearize`.
 *
 * - qpdf not installed: skipped with a warning on a developer machine (the
 *   tests that read `linearized.pdf` then skip), but an error under CI —
 *   CI installs qpdf, so a missing qpdf there means the regression block
 *   would be skipped while the run stays green.
 * - qpdf installed but failed: always an error. Before this, any failure was
 *   reported as "Skipped" and the regression block silently went away.
 * - 🔴 `--warning-exit-0`: qpdf exits with 3 when it only warns, and what it
 *   warns about changes by version (qpdf 12 repairs things 10.6 / 11.9 pass
 *   over silently — see pdf-verify-mcp's verify-integrity test). A warned run
 *   still writes the linearized file, so a warning is printed, not fatal.
 */
async function createLinearizedPdf(): Promise<void> {
  const input = `${FIXTURES_DIR}/simple.pdf`;
  const output = `${FIXTURES_DIR}/linearized.pdf`;
  let stderr: string;
  try {
    ({ stderr } = await execFileAsync('qpdf', ['--warning-exit-0', '--linearize', input, output]));
  } catch (e) {
    const notInstalled = (e as NodeJS.ErrnoException).code === 'ENOENT';
    if (notInstalled && !process.env.CI) {
      console.warn(
        'Skipped: linearized.pdf — qpdf is not installed (the linearized tests will skip).',
      );
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      notInstalled
        ? 'linearized.pdf: qpdf is not installed, and CI is set. Install qpdf (apt install qpdf) — without it the linearized regression tests are skipped.'
        : `linearized.pdf: qpdf --linearize failed (${msg}).`,
    );
  }
  if (stderr.trim()) console.warn(`qpdf warned while linearizing simple.pdf:\n${stderr.trimEnd()}`);
  console.log('Created: linearized.pdf (linearized via qpdf)');
}

async function main(): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });
  await createSimplePdf();
  await createEmptyPdf();
  await createAnnotatedPdf();
  await createTwoColumnPdf();
  await createLinearizedPdf();
  console.log('All test fixtures created.');
}

// A failed fixture must fail the step: CI runs this before the tests, and a
// zero exit here let a missing fixture surface later as an unrelated failure
// (or, for an optional fixture, as skipped tests).
main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
