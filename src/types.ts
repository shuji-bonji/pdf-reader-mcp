/**
 * pdf-reader-mcp shared type definitions
 */

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

/** A single page's extracted text */
export interface PageText {
  page: number;
  text: string;
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
  query: string;
  totalMatches: number;
  matches: SearchMatch[];
  truncated: boolean;
}

/** An extracted image from a PDF page */
export interface ExtractedImage {
  page: number;
  index: number;
  width: number;
  height: number;
  colorSpace: string;
  bitsPerComponent: number;
  dataBase64: string;
}

/** Summary report of a PDF document */
export interface PdfSummary {
  filePath: string;
  metadata: PdfMetadata;
  textPreview: string;
  imageCount: number;
  hasText: boolean;
}

/** Tool response content */
export interface ToolContent {
  type: 'text' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}
