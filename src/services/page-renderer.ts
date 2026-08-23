/**
 * Page rasterisation for `render_page` (#23), through PDFium compiled to
 * WebAssembly (`@hyzyla/pdfium`).
 *
 * Why not pdf.js + a Canvas implementation: measured on this repository's own
 * fixtures (2026-08-23, Linux x64, Node 22, @napi-rs/canvas 1.0.7 and 0.1.80),
 * `page.render()` segfaults the process on any page that draws an image — and
 * an MCP server is a process, so the whole server dies, on exactly the pages
 * this tool exists for. Text-only pages rendered, but only with
 * `standardFontDataUrl` configured; without it every glyph was skipped and the
 * output was a blank page that *looked* like a successful render.
 *
 * Why the dependency is acceptable when a native addon was not (#21, #22): the
 * package is a single WASM binary with zero dependencies and no `os`/`cpu`
 * restriction — every platform installs the same bytes, so the published
 * package behaves the same everywhere `npx` runs it. It sits in
 * `optionalDependencies`: when absent, `render_page` reports that and what to
 * install, rather than failing to start the server.
 *
 * PDFium is a different engine from the pdfjs this server reads text with. That
 * is stated in the tool description rather than hidden: a rendering difference
 * between the two is possible, and pretending one engine produced both outputs
 * would misattribute any such difference.
 */

import { DEFAULT_IMAGE_QUALITY, MAX_IMAGE_PIXELS, MAX_IMAGE_RESPONSE_BYTES } from '../constants.js';
import { readPdfFile, resolvePageNumbers } from '../utils/pdf-helpers.js';
import { encodeJpeg, encodePng } from './image-encoder.js';
import { downscale, type Samples } from './image-resampler.js';

/** One rendered page, as an encoded image file. */
export interface RenderedPage {
  page: number;
  /** Pixel size of the returned image. */
  width: number;
  height: number;
  /** The page's size in PDF points (1/72 inch), as PDFium reports it. */
  pointWidth: number;
  pointHeight: number;
  /** The dpi the returned image works out to, after any downscale. */
  effectiveDpi: number;
  mimeType: string;
  encodedBytes: number;
  dataBase64: string;
}

/** A page that was not rendered, and why. */
export interface OmittedRender {
  page: number;
  reason: string;
}

export interface RenderResult {
  pages: RenderedPage[];
  omitted: OmittedRender[];
  totalEncodedBytes: number;
}

export interface RenderOptions {
  /** Rasterisation density. Default 150 — text is legible, files stay small. */
  dpi?: number;
  /** Cap on the rendered width in pixels; overrides dpi when smaller. */
  maxWidth?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
  /** Response budget override, for tests. */
  maxTotalBytes?: number;
}

export const DEFAULT_RENDER_DPI = 150;

/** The pdfium module, loaded once. `null` after a failed attempt. */
let pdfiumLibrary: unknown | null | undefined;

/**
 * Load `@hyzyla/pdfium` if it is installed.
 *
 * The import is dynamic and by variable so that neither TypeScript nor a
 * bundler resolves it at build time: the package is optional, and the server
 * must start (and every other tool must work) without it.
 */
async function loadPdfium(): Promise<unknown | null> {
  if (pdfiumLibrary !== undefined) return pdfiumLibrary;
  try {
    const specifier = '@hyzyla/pdfium';
    const module = (await import(specifier)) as {
      PDFiumLibrary: { init(): Promise<unknown> };
    };
    pdfiumLibrary = await module.PDFiumLibrary.init();
  } catch {
    pdfiumLibrary = null;
  }
  return pdfiumLibrary;
}

/** True when the renderer is available in this installation. */
export async function rendererAvailable(): Promise<boolean> {
  return (await loadPdfium()) !== null;
}

export const RENDERER_MISSING_MESSAGE =
  'render_page needs the optional dependency @hyzyla/pdfium (PDFium compiled to ' +
  'WebAssembly), which is not installed here. Install it next to this server — ' +
  '`npm install @hyzyla/pdfium` — and call again. Every other tool works without it.';

/** BGRA (PDFium's output order) to RGB, dropping alpha against white. */
function bgraToRgb(width: number, height: number, bgra: Uint8Array): Samples {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const alpha = bgra[i * 4 + 3] / 255;
    // PDFium fills the bitmap with opaque white before drawing, so alpha is
    // normally 255; the blend is kept for the transparent-background case.
    data[i * 3] = Math.round(bgra[i * 4 + 2] * alpha + 255 * (1 - alpha));
    data[i * 3 + 1] = Math.round(bgra[i * 4 + 1] * alpha + 255 * (1 - alpha));
    data[i * 3 + 2] = Math.round(bgra[i * 4] * alpha + 255 * (1 - alpha));
  }
  return { width, height, channels: 3, data };
}

interface PdfiumPageLike {
  getOriginalSize(): { originalWidth: number; originalHeight: number };
  render(options: {
    scale: number;
    render: 'bitmap';
  }): Promise<{ width: number; height: number; data: Uint8Array }>;
}

interface PdfiumDocumentLike {
  getPageCount(): number;
  getPage(index: number): PdfiumPageLike;
  destroy(): void;
}

interface PdfiumLibraryLike {
  loadDocument(data: Uint8Array): Promise<PdfiumDocumentLike>;
}

/**
 * Render the requested pages to PNG or JPEG.
 *
 * Pages are rendered in order until the byte budget is reached; the rest are
 * reported in `omitted` with the reason, mirroring `read_images` (#22).
 */
export async function renderPages(
  filePath: string,
  pages: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const library = (await loadPdfium()) as PdfiumLibraryLike | null;
  if (!library) throw new Error(RENDERER_MISSING_MESSAGE);

  const dpi = options.dpi ?? DEFAULT_RENDER_DPI;
  const format = options.format ?? 'png';
  const quality = options.quality ?? DEFAULT_IMAGE_QUALITY;
  const budget = options.maxTotalBytes ?? MAX_IMAGE_RESPONSE_BYTES;

  const data = await readPdfFile(filePath);
  const document = await library.loadDocument(new Uint8Array(data));

  try {
    const pageNumbers = resolvePageNumbers(pages, document.getPageCount());

    const rendered: RenderedPage[] = [];
    const omitted: OmittedRender[] = [];
    let totalEncodedBytes = 0;

    for (const pageNumber of pageNumbers) {
      const page = document.getPage(pageNumber - 1);
      const { originalWidth, originalHeight } = page.getOriginalSize();

      // dpi → scale: PDF points are 1/72 inch (ISO 32000-2 §8.3.2.3).
      let scale = dpi / 72;
      if (options.maxWidth && originalWidth * scale > options.maxWidth) {
        scale = options.maxWidth / originalWidth;
      }

      if (originalWidth * scale * originalHeight * scale > MAX_IMAGE_PIXELS) {
        omitted.push({
          page: pageNumber,
          reason:
            `${Math.round(originalWidth * scale)}×${Math.round(originalHeight * scale)} at ` +
            `${dpi} dpi exceeds the ${MAX_IMAGE_PIXELS.toLocaleString()} pixel limit. ` +
            'Lower dpi or pass max_width.',
        });
        continue;
      }

      const bitmap = await page.render({ scale, render: 'bitmap' });
      let samples = bgraToRgb(bitmap.width, bitmap.height, bitmap.data);
      if (options.maxWidth && samples.width > options.maxWidth) {
        samples = downscale(samples, options.maxWidth);
      }

      const bytes =
        format === 'jpeg'
          ? encodeJpeg(samples.width, samples.height, 3, samples.data, quality)
          : encodePng(samples.width, samples.height, 2, 8, samples.data);
      const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';

      if (totalEncodedBytes + bytes.length > budget) {
        omitted.push({
          page: pageNumber,
          reason:
            `${bytes.length.toLocaleString()} bytes would take the response past the ` +
            `${budget.toLocaleString()}-byte budget. Render fewer pages per call, lower dpi, ` +
            'or pass format: "jpeg".',
        });
        continue;
      }

      totalEncodedBytes += bytes.length;
      rendered.push({
        page: pageNumber,
        width: samples.width,
        height: samples.height,
        pointWidth: Math.round(originalWidth),
        pointHeight: Math.round(originalHeight),
        effectiveDpi: Math.round((samples.width / originalWidth) * 72),
        mimeType,
        encodedBytes: bytes.length,
        dataBase64: bytes.toString('base64'),
      });
    }

    return { pages: rendered, omitted, totalEncodedBytes };
  } finally {
    document.destroy();
  }
}
