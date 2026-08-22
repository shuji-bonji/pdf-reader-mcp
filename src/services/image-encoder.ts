/**
 * Dependency-free PNG and baseline-JPEG encoders for `read_images` (#22).
 *
 * pdfjs hands back *decoded pixels*, not an image file: `imgData.data` for an
 * 8×8 RGB image is 192 bytes (8×8×3), and there is no PNG or JPEG signature
 * anywhere in it. Base64-ing that buffer produced something no viewer and no
 * vision model can open — the response looked like an image and was not one.
 *
 * Both encoders are written out rather than pulled in. The repository's
 * standing reason (see #21) is that a native addon ships per-platform binaries
 * and breaks the post-release `npx` check of the published package; nothing
 * here needs one. PNG is `zlib.deflateSync` plus four chunks; JPEG is the
 * baseline process of ISO/IEC 10918-1 with the example tables of its Annex K.
 */

import { deflateSync } from 'node:zlib';

// ─── PNG ────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
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
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** PNG colour types used here: 0 greyscale, 2 truecolour, 6 truecolour+alpha. */
export type PngColorType = 0 | 2 | 6;

/**
 * Encode raw samples as a PNG.
 *
 * `rows` must already be packed the way PNG wants them — one scanline per row,
 * each padded to a byte boundary — which is also how pdfjs packs its 1 bpp
 * greyscale output, so that case is a straight copy.
 */
export function encodePng(
  width: number,
  height: number,
  colorType: PngColorType,
  bitDepth: 1 | 8,
  rows: Uint8Array,
): Buffer {
  const stride = Math.ceil((width * samplesPerPixel(colorType) * bitDepth) / 8);
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0; // filter type 0 (None)
    // A short final row is padded with zeros rather than throwing: a truncated
    // image stream is a property of the file, and losing the rows that did
    // decode would report less than was observed.
    const from = y * stride;
    if (from >= rows.length) break;
    Buffer.from(rows.subarray(from, Math.min(from + stride, rows.length))).copy(
      raw,
      y * (1 + stride) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function samplesPerPixel(colorType: PngColorType): number {
  return colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
}

// ─── Baseline JPEG (ISO/IEC 10918-1) ────────────────────

/** Annex K.1 Table K.1 — luminance quantisation, in zigzag-free natural order. */
const LUMINANCE_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

/** Annex K.1 Table K.2 — chrominance quantisation. */
const CHROMINANCE_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** Annex K.3.3 Table K.3 — DC luminance code lengths and values. */
const DC_LUMINANCE_BITS = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMINANCE_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** Table K.4 — DC chrominance. */
const DC_CHROMINANCE_BITS = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMINANCE_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Table K.5 — AC luminance. */
const AC_LUMINANCE_BITS = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMINANCE_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

/** Table K.6 — AC chrominance. */
const AC_CHROMINANCE_BITS = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMINANCE_VALUES = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

/** A Huffman table as (code, length) pairs indexed by symbol. */
type HuffmanTable = Array<{ code: number; length: number } | undefined>;

function buildHuffmanTable(bits: number[], values: number[]): HuffmanTable {
  const table: HuffmanTable = [];
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length]; i++) {
      table[values[k]] = { code, length };
      code++;
      k++;
    }
    code <<= 1;
  }
  return table;
}

/** The IJG quality curve; `quality` is 1–100, 100 meaning "divide by 1". */
function scaleQuantTable(base: number[], quality: number): Int32Array {
  const clamped = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = clamped < 50 ? Math.floor(5000 / clamped) : 200 - clamped * 2;
  const table = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    table[i] = Math.min(255, Math.max(1, Math.floor((base[i] * scale + 50) / 100)));
  }
  return table;
}

/**
 * Separable 8-point float DCT-II (§A.3.3), applied to rows then to columns.
 *
 * The result is left in the block in natural order — index `v * 8 + u`, with
 * `v` the vertical frequency — which is the order `ZIGZAG` indexes into.
 */
function forwardDct(block: Float32Array): void {
  const tmp = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) sum += block[y * 8 + x] * COS_TABLE[x * 8 + u];
      tmp[y * 8 + u] = 0.5 * DCT_ALPHA[u] * sum;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) sum += tmp[y * 8 + u] * COS_TABLE[y * 8 + v];
      block[v * 8 + u] = 0.5 * DCT_ALPHA[v] * sum;
    }
  }
}

/** C(u) of §A.3.3: 1/√2 at zero frequency, 1 elsewhere. */
const DCT_ALPHA = Float32Array.from({ length: 8 }, (_, u) => (u === 0 ? Math.SQRT1_2 : 1));
const COS_TABLE = (() => {
  const table = new Float32Array(64);
  for (let x = 0; x < 8; x++) {
    for (let u = 0; u < 8; u++) {
      table[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return table;
})();

/** MSB-first bit writer with the 0xFF00 byte stuffing of §B.1.1.5. */
class BitWriter {
  private readonly bytes: number[] = [];
  private accumulator = 0;
  private bitCount = 0;

  write(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.accumulator = (this.accumulator << 1) | ((code >> i) & 1);
      this.bitCount++;
      if (this.bitCount === 8) {
        this.bytes.push(this.accumulator & 0xff);
        // A 0xFF in entropy-coded data is followed by a zero byte, so it is
        // never mistaken for a marker.
        if ((this.accumulator & 0xff) === 0xff) this.bytes.push(0x00);
        this.accumulator = 0;
        this.bitCount = 0;
      }
    }
  }

  /** Pad the final byte with 1-bits (§B.1.1.5) and return the stream. */
  finish(): Buffer {
    while (this.bitCount !== 0) this.write(1, 1);
    return Buffer.from(this.bytes);
  }
}

/** §F.1.2.1: the category of a coefficient, i.e. how many bits it needs. */
function magnitudeCategory(value: number): number {
  let magnitude = Math.abs(value);
  let category = 0;
  while (magnitude > 0) {
    magnitude >>= 1;
    category++;
  }
  return category;
}

/** §F.1.2.1: negative values are sent as the one's complement. */
function magnitudeBits(value: number, category: number): number {
  return value >= 0 ? value : value + (1 << category) - 1;
}

interface ComponentPlan {
  samples: Float32Array;
  quant: Int32Array;
  dcTable: HuffmanTable;
  acTable: HuffmanTable;
  previousDc: number;
}

function encodeBlock(writer: BitWriter, component: ComponentPlan, block: Float32Array): void {
  forwardDct(block);

  const quantised = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    quantised[i] = Math.round(block[ZIGZAG[i]] / component.quant[ZIGZAG[i]]);
  }

  const dcDiff = quantised[0] - component.previousDc;
  component.previousDc = quantised[0];
  const dcCategory = magnitudeCategory(dcDiff);
  const dcCode = component.dcTable[dcCategory];
  if (!dcCode) throw new Error(`JPEG: no DC code for category ${dcCategory}`);
  writer.write(dcCode.code, dcCode.length);
  if (dcCategory > 0) writer.write(magnitudeBits(dcDiff, dcCategory), dcCategory);

  let runLength = 0;
  for (let i = 1; i < 64; i++) {
    if (quantised[i] === 0) {
      runLength++;
      continue;
    }
    while (runLength > 15) {
      const zrl = component.acTable[0xf0];
      if (!zrl) throw new Error('JPEG: no ZRL code');
      writer.write(zrl.code, zrl.length);
      runLength -= 16;
    }
    const category = magnitudeCategory(quantised[i]);
    const symbol = (runLength << 4) | category;
    const acCode = component.acTable[symbol];
    if (!acCode) throw new Error(`JPEG: no AC code for symbol ${symbol}`);
    writer.write(acCode.code, acCode.length);
    writer.write(magnitudeBits(quantised[i], category), category);
    runLength = 0;
  }
  if (runLength > 0) {
    const eob = component.acTable[0x00];
    if (!eob) throw new Error('JPEG: no EOB code');
    writer.write(eob.code, eob.length);
  }
}

function marker(code: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = code;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function quantMarker(id: number, table: Int32Array): Buffer {
  const payload = Buffer.alloc(65);
  payload[0] = id; // precision 0 (8-bit) in the high nibble, table id in the low
  for (let i = 0; i < 64; i++) payload[1 + i] = table[ZIGZAG[i]];
  return marker(0xdb, payload);
}

function huffmanMarker(id: number, bits: number[], values: number[]): Buffer {
  const payload = Buffer.alloc(1 + 16 + values.length);
  payload[0] = id;
  for (let i = 0; i < 16; i++) payload[1 + i] = bits[i + 1];
  for (let i = 0; i < values.length; i++) payload[17 + i] = values[i];
  return marker(0xc4, payload);
}

/**
 * Encode 8-bit samples as a baseline JPEG.
 *
 * `channels` is 1 (greyscale) or 3 (RGB). No chroma subsampling: 4:4:4 costs
 * some bytes and removes a whole class of edge cases at the boundaries, and the
 * images this server returns are read by a model, not streamed to a browser.
 */
export function encodeJpeg(
  width: number,
  height: number,
  channels: 1 | 3,
  pixels: Uint8Array,
  quality: number,
): Buffer {
  const luminanceQuant = scaleQuantTable(LUMINANCE_QUANT, quality);
  const chrominanceQuant = scaleQuantTable(CHROMINANCE_QUANT, quality);

  const dcLuminance = buildHuffmanTable(DC_LUMINANCE_BITS, DC_LUMINANCE_VALUES);
  const acLuminance = buildHuffmanTable(AC_LUMINANCE_BITS, AC_LUMINANCE_VALUES);
  const dcChrominance = buildHuffmanTable(DC_CHROMINANCE_BITS, DC_CHROMINANCE_VALUES);
  const acChrominance = buildHuffmanTable(AC_CHROMINANCE_BITS, AC_CHROMINANCE_VALUES);

  // Planes, in the JPEG sense: Y always, Cb/Cr only for colour.
  const pixelCount = width * height;
  const y = new Float32Array(pixelCount);
  const cb = channels === 3 ? new Float32Array(pixelCount) : null;
  const cr = channels === 3 ? new Float32Array(pixelCount) : null;

  for (let i = 0; i < pixelCount; i++) {
    if (channels === 1) {
      y[i] = pixels[i] - 128;
    } else {
      const r = pixels[i * 3];
      const g = pixels[i * 3 + 1];
      const b = pixels[i * 3 + 2];
      // ITU-T T.871 §7 (JFIF) conversion.
      y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      (cb as Float32Array)[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
      (cr as Float32Array)[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
    }
  }

  const components: ComponentPlan[] =
    channels === 1
      ? [
          {
            samples: y,
            quant: luminanceQuant,
            dcTable: dcLuminance,
            acTable: acLuminance,
            previousDc: 0,
          },
        ]
      : [
          {
            samples: y,
            quant: luminanceQuant,
            dcTable: dcLuminance,
            acTable: acLuminance,
            previousDc: 0,
          },
          {
            samples: cb as Float32Array,
            quant: chrominanceQuant,
            dcTable: dcChrominance,
            acTable: acChrominance,
            previousDc: 0,
          },
          {
            samples: cr as Float32Array,
            quant: chrominanceQuant,
            dcTable: dcChrominance,
            acTable: acChrominance,
            previousDc: 0,
          },
        ];

  const writer = new BitWriter();
  const block = new Float32Array(64);
  for (let blockY = 0; blockY < height; blockY += 8) {
    for (let blockX = 0; blockX < width; blockX += 8) {
      for (const component of components) {
        for (let row = 0; row < 8; row++) {
          // §A.2.4: an incomplete edge block repeats its last sample.
          const sy = Math.min(blockY + row, height - 1);
          for (let col = 0; col < 8; col++) {
            const sx = Math.min(blockX + col, width - 1);
            block[row * 8 + col] = component.samples[sy * width + sx];
          }
        }
        encodeBlock(writer, component, block);
      }
    }
  }

  const jfif = Buffer.from([
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    0x01,
    0x01, // version 1.1
    0x00, // no density units
    0x00,
    0x01,
    0x00,
    0x01, // 1:1 aspect
    0x00,
    0x00, // no thumbnail
  ]);

  const sofPayload = Buffer.alloc(6 + channels * 3);
  sofPayload[0] = 8; // sample precision
  sofPayload.writeUInt16BE(height, 1);
  sofPayload.writeUInt16BE(width, 3);
  sofPayload[5] = channels;
  for (let c = 0; c < channels; c++) {
    sofPayload[6 + c * 3] = c + 1; // component id
    sofPayload[7 + c * 3] = 0x11; // 1×1 sampling — no subsampling
    sofPayload[8 + c * 3] = c === 0 ? 0 : 1; // quantisation table selector
  }

  const sosPayload = Buffer.alloc(4 + channels * 2);
  sosPayload[0] = channels;
  for (let c = 0; c < channels; c++) {
    sosPayload[1 + c * 2] = c + 1;
    sosPayload[2 + c * 2] = c === 0 ? 0x00 : 0x11; // DC/AC table selectors
  }
  sosPayload[1 + channels * 2] = 0; // Ss
  sosPayload[2 + channels * 2] = 63; // Se
  sosPayload[3 + channels * 2] = 0; // Ah/Al

  const parts: Buffer[] = [
    Buffer.from([0xff, 0xd8]), // SOI
    marker(0xe0, jfif), // APP0
    quantMarker(0x00, luminanceQuant),
  ];
  if (channels === 3) parts.push(quantMarker(0x01, chrominanceQuant));
  parts.push(marker(0xc0, sofPayload)); // SOF0
  parts.push(huffmanMarker(0x00, DC_LUMINANCE_BITS, DC_LUMINANCE_VALUES));
  parts.push(huffmanMarker(0x10, AC_LUMINANCE_BITS, AC_LUMINANCE_VALUES));
  if (channels === 3) {
    parts.push(huffmanMarker(0x01, DC_CHROMINANCE_BITS, DC_CHROMINANCE_VALUES));
    parts.push(huffmanMarker(0x11, AC_CHROMINANCE_BITS, AC_CHROMINANCE_VALUES));
  }
  parts.push(marker(0xda, sosPayload)); // SOS
  parts.push(writer.finish());
  parts.push(Buffer.from([0xff, 0xd9])); // EOI

  return Buffer.concat(parts);
}
