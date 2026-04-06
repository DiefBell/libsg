/**
 * Convert an RGBA pixel (8 bits per channel) to RGB555 format (5 bits per channel).
 * Only fully-transparent pixels (alpha === 0) are encoded as the magic transparent
 * value 0xf81f.  Semi-transparent pixels are encoded as opaque RGB — their alpha
 * values are carried separately by the alpha mask blob (see encodeAlpha).
 */
function rgbaTo555(r: number, g: number, b: number, a: number): number {
  if (a === 0) return 0xf81f
  // .555 is RGB555: bits 14-10 = Red, bits 9-5 = Green, bits 4-0 = Blue
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
}

export class SgImageEncoder {
  /**
   * Encode RGBA pixels to plain 555 format.
   * Output is width × height × 2 bytes (one UInt16LE per pixel).
   * Only fully-transparent pixels (alpha === 0) become 0xf81f.
   */
  static encodePlain(rgba: Uint8Array, width: number, height: number): Buffer {
    const buf = Buffer.allocUnsafe(width * height * 2)
    for (let i = 0; i < width * height; i++) {
      buf.writeUInt16LE(rgbaTo555(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]), i * 2)
    }
    return buf
  }

  /**
   * Encode RGBA pixels to sprite RLE format (the transparent image format).
   *
   * Wire format: alternating skip and run commands.
   *   - Skip: byte 0xFF followed by a byte N → skip N pixels (advance position by N).
   *   - Run:  byte C (1–254) followed by C × 2 bytes of 555 pixel data.
   *
   * Only fully-transparent pixels (alpha === 0) produce skips.
   * Semi-transparent pixels are encoded as opaque RGB in the run data; their actual
   * alpha values are handled by the separate alpha mask blob (see encodeAlpha).
   *
   * IMPORTANT: Each row is encoded independently — commands never cross row boundaries.
   * This is required because the game's decoder does not wrap x within a single command;
   * it only advances the row after a complete run or skip.
   */
  static encodeSprite(rgba: Uint8Array, width: number, height: number): Buffer {
    const parts: Buffer[] = []

    for (let y = 0; y < height; y++) {
      let x = 0
      while (x < width) {
        if (rgba[(y * width + x) * 4 + 3] === 0) {
          // Count consecutive fully-transparent pixels within this row only
          let skip = 0
          while (x < width && rgba[(y * width + x) * 4 + 3] === 0) {
            skip++
            x++
          }
          // Emit skip commands (max 255 each)
          while (skip > 0) {
            const n = Math.min(skip, 255)
            parts.push(Buffer.from([0xff, n]))
            skip -= n
          }
        } else {
          // Collect non-transparent run within this row only (max 254 pixels)
          const pixels: number[] = []
          while (x < width && rgba[(y * width + x) * 4 + 3] !== 0 && pixels.length < 254) {
            const idx = (y * width + x) * 4
            pixels.push(rgbaTo555(rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]))
            x++
          }
          const chunk = Buffer.allocUnsafe(1 + pixels.length * 2)
          chunk[0] = pixels.length
          for (let j = 0; j < pixels.length; j++) {
            chunk.writeUInt16LE(pixels[j], 1 + j * 2)
          }
          parts.push(chunk)
        }
      }
    }

    return Buffer.concat(parts)
  }

  /**
   * Encode an alpha mask blob for all non-transparent pixels (alpha > 0).
   * Returns null if every pixel is fully transparent (no alpha mask needed).
   *
   * Wire format: same skip/run structure as loadAlphaMask in SgImageData.
   *   - Skip: byte 0xFF followed by N → advance cursor by N pixels (no alpha written).
   *   - Run:  byte C (1–254) followed by C alpha bytes (5-bit values in low bits).
   *
   * The cursor is a flat scan over all pixels (both opaque and transparent).
   * Only fully-transparent pixels (alpha === 0) produce skip bytes; all others
   * (including fully-opaque alpha === 255) produce run bytes with their 5-bit alpha.
   * This matches the original encoder, which encodes alpha=255 pixels as run value 31
   * so that the game's alpha decoder explicitly sets the alpha for every visible pixel.
   * Stored alpha is 5-bit: alpha_8bit >> 3.
   */
  static encodeAlpha(rgba: Uint8Array, width: number, height: number): Buffer | null {
    const total = width * height
    let hasNonTransparent = false
    for (let i = 0; i < total; i++) {
      if (rgba[i * 4 + 3] > 0) { hasNonTransparent = true; break }
    }
    if (!hasNonTransparent) return null

    const parts: Buffer[] = []
    let i = 0

    while (i < total) {
      const a = rgba[i * 4 + 3]
      if (a === 0) {
        // Skip fully-transparent pixels only
        let skip = 0
        while (i < total && rgba[i * 4 + 3] === 0) {
          skip++; i++
        }
        while (skip > 0) {
          const n = Math.min(skip, 255)
          parts.push(Buffer.from([0xff, n]))
          skip -= n
        }
      } else {
        // Emit run for ALL non-transparent pixels (alpha > 0), including fully-opaque (255 → 5-bit 31)
        const run: number[] = []
        while (i < total && rgba[i * 4 + 3] > 0 && run.length < 254) {
          run.push(rgba[i * 4 + 3] >> 3)  // 8-bit → 5-bit
          i++
        }
        const chunk = Buffer.allocUnsafe(1 + run.length)
        chunk[0] = run.length
        for (let k = 0; k < run.length; k++) chunk[k + 1] = run[k]
        parts.push(chunk)
      }
    }

    return Buffer.concat(parts)
  }

  /**
   * Encode RGBA pixels to the appropriate 555 wire format, auto-selecting based on originalType.
   * Also produces an optional alpha mask blob for semi-transparent pixels.
   *
   * - Plain types (0, 1, 10, 12, 13) → encodePlain; type unchanged.
   * - Sprite types (256, 257, 276) → encodeSprite; type unchanged.
   * - Isometric type (30) → encodeSprite; type becomes 256.
   *
   * Returns { data, alpha, type }.  alpha is null if no semi-transparent pixels exist.
   */
  static encode(
    rgba: Uint8Array,
    width: number,
    height: number,
    originalType: number
  ): { data: Buffer; alpha: Buffer | null; type: number } {
    const alpha = this.encodeAlpha(rgba, width, height)
    if (originalType >= 256) {
      return { data: this.encodeSprite(rgba, width, height), alpha, type: originalType }
    }
    if (originalType === 30) {
      return { data: this.encodeSprite(rgba, width, height), alpha, type: 256 }
    }
    return { data: this.encodePlain(rgba, width, height), alpha, type: originalType }
  }
}
