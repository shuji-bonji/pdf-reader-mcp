/**
 * Sample-space helpers for `read_images` (#22): expanding pdfjs's decoded
 * buffers into a uniform 8-bit form, and area-averaged downscaling.
 *
 * pdfjs hands back three different shapes (1 bpp packed greyscale, 24 bpp RGB,
 * 32 bpp RGBA). Encoding and resizing both become one code path once they are
 * normalised, and the normalisation is exact — nothing is discarded here except
 * where a caller asked for a smaller image.
 */

/** A decoded image in 8 bits per sample, `channels` samples per pixel. */
export interface Samples {
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  data: Uint8Array;
}

/**
 * Expand packed 1 bpp greyscale to one byte per pixel.
 *
 * Each row starts on a byte boundary (the same padding rule PNG uses), and a
 * set bit is the maximum grey value — DeviceGray with the default `/Decode`
 * maps 0 to black and 1 to white (ISO 32000-2 §8.9.5.2).
 */
export function expandGrayscale1Bpp(width: number, height: number, packed: Uint8Array): Samples {
  const stride = Math.ceil(width / 8);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = packed[y * stride + (x >> 3)] ?? 0;
      data[y * width + x] = byte & (0x80 >> (x & 7)) ? 0xff : 0x00;
    }
  }
  return { width, height, channels: 1, data };
}

/** Drop the alpha channel by compositing over white — JPEG has no alpha. */
export function flattenAlphaOverWhite(samples: Samples): Samples {
  if (samples.channels !== 4) return samples;
  const { width, height, data } = samples;
  const out = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const alpha = data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = Math.round(data[i * 4 + c] * alpha + 255 * (1 - alpha));
    }
  }
  return { width, height, channels: 3, data: out };
}

/**
 * Downscale by averaging every source pixel that falls in a destination pixel.
 *
 * Averaging rather than nearest-neighbour: a scanned page reduced by point
 * sampling loses whole strokes of text, and the result would misrepresent the
 * page more than a smaller image does. Upscaling is not performed — this only
 * ever returns something the same size or smaller.
 */
export function downscale(samples: Samples, maxWidth?: number, maxHeight?: number): Samples {
  const scale = Math.min(
    maxWidth ? maxWidth / samples.width : 1,
    maxHeight ? maxHeight / samples.height : 1,
    1,
  );
  if (scale >= 1) return samples;

  const width = Math.max(1, Math.floor(samples.width * scale));
  const height = Math.max(1, Math.floor(samples.height * scale));
  const { channels } = samples;
  const out = new Uint8Array(width * height * channels);

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * samples.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * samples.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * samples.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * samples.width) / width));
      const count = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let sy = y0; sy < y1; sy++) {
          for (let sx = x0; sx < x1; sx++) {
            sum += samples.data[(sy * samples.width + sx) * channels + c];
          }
        }
        out[(y * width + x) * channels + c] = Math.round(sum / count);
      }
    }
  }

  return { width, height, channels, data: out };
}
