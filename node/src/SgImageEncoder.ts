/**
 * Convert an RGBA pixel (8 bits per channel) to 555 format (5 bits per channel).
 * Pixels with alpha < 128 are encoded as the transparent magic value 0xf81f.
 */
function rgbaTo555(r: number, g: number, b: number, a: number): number {
  if (a < 128) return 0xf81f
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
}

export class SgImageEncoder {
  /**
   * Encode RGBA pixels to plain 555 format.
   * Output is width × height × 2 bytes (one UInt16LE per pixel).
   * Transparent pixels (alpha < 128) are encoded as 0xf81f.
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
   * Transparent pixels (alpha < 128) produce skip commands; opaque pixels produce runs.
   * Up to 254 pixels per run; up to 255 pixels per skip command.
   */
  static encodeSprite(rgba: Uint8Array, width: number, height: number): Buffer {
    const parts: Buffer[] = []
    let x = 0, y = 0

    const isTransparent = () => rgba[(y * width + x) * 4 + 3] < 128

    while (y < height) {
      if (isTransparent()) {
        // Count transparent run
        let skip = 0
        while (y < height && isTransparent()) {
          skip++
          x++
          if (x >= width) { x = 0; y++ }
        }
        // Emit skip commands (max 255 pixels each)
        while (skip > 0) {
          const n = Math.min(skip, 255)
          parts.push(Buffer.from([0xff, n]))
          skip -= n
        }
      } else {
        // Collect opaque run (max 254 pixels)
        const pixels: number[] = []
        while (y < height && !isTransparent() && pixels.length < 254) {
          const idx = (y * width + x) * 4
          pixels.push(rgbaTo555(rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]))
          x++
          if (x >= width) { x = 0; y++ }
        }
        const chunk = Buffer.allocUnsafe(1 + pixels.length * 2)
        chunk[0] = pixels.length
        for (let j = 0; j < pixels.length; j++) {
          chunk.writeUInt16LE(pixels[j], 1 + j * 2)
        }
        parts.push(chunk)
      }
    }

    return Buffer.concat(parts)
  }

  /**
   * Encode RGBA pixels to the appropriate 555 wire format, auto-selecting based on originalType.
   *
   * - Plain types (0, 1, 10, 12, 13) → encodePlain; type unchanged.
   * - Sprite types (256, 257, 276) → encodeSprite; type unchanged.
   * - Isometric type (30) → encodeSprite; type becomes 256.
   *   (Full isometric tiled re-encoding is not yet supported; the image is stored
   *    as a sprite, which the game can render correctly for non-isometric use.)
   *
   * Returns { data, type } where type is the value to write to the image record.
   */
  static encode(
    rgba: Uint8Array,
    width: number,
    height: number,
    originalType: number
  ): { data: Buffer; type: number } {
    if (originalType >= 256) {
      return { data: this.encodeSprite(rgba, width, height), type: originalType }
    }
    if (originalType === 30) {
      // Isometric → sprite (changes type in the image record)
      return { data: this.encodeSprite(rgba, width, height), type: 256 }
    }
    // Plain types
    return { data: this.encodePlain(rgba, width, height), type: originalType }
  }
}
