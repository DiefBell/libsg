import { SgImage } from "./SgImage";
import { FileHandle } from "./util/FileHandle";
import { fillBufferFromFileHandle } from "./util/fillBufferFromFileHandle";

/**
 * Decodes raw pixel data from a .555 file into an RGBA pixel buffer.
 *
 * The three supported encoding formats are:
 *
 *   Plain (types 0, 1, 10, 12, 13)
 *     Uncompressed row-major array of UInt16LE RGB555 values.
 *     2 bytes per pixel, width × height pixels total.
 *
 *   Sprite / transparent (types 256, 257, 276)
 *     Run-length encoded with explicit transparent-skip commands.
 *     Wire format (decoded by writeTransparentImage):
 *       byte 0xFF + byte N  → advance cursor by N pixels (transparent)
 *       byte C (1–254)      → C opaque pixels follow; each is 2 bytes of RGB555
 *     Commands may wrap across row boundaries — the cursor is a flat scan over
 *     the entire pixel grid.  (The ENCODER must NOT emit commands that cross rows;
 *     the game's renderer only advances the row at specific points.)
 *
 *   Isometric (type 30)
 *     Two-part encoding:
 *       1. Uncompressed tile base: `uncompressedLength` bytes of tightly packed
 *          diamond-shaped tiles arranged in the isometric grid.
 *       2. Sprite overlay: `length - uncompressedLength` bytes of sprite RLE
 *          layered on top (buildings, trees, etc.).
 *     The number of tiles and tile size are inferred from flags[3] and the
 *     image dimensions. Regular tiles are 58 × 30 px; Emperor "large" tiles are
 *     78 × 40 px.
 *
 * Alpha mask (v0xd6+ only, when alphaLength > 0)
 *   Stored immediately after the pixel data in the .555 file.
 *   Same skip/run wire format as sprite, but run bytes are 5-bit alpha values
 *   for pixels with partial transparency (0 < alpha < 255). Pixels not mentioned
 *   in the mask retain the alpha that the pixel decoder already set (255 for
 *   opaque, 0 for the magic transparent color 0xf81f).
 *
 * Channel layout
 *   Output Uint32 values are RGBA in little-endian memory order:
 *     byte 0 = R, byte 1 = G, byte 2 = B, byte 3 = A
 *   This matches the layout that sharp expects for raw RGBA input.
 *   (The underlying .555 RGB555 format stores Red in bits 14-10, Green in
 *   bits 9-5, Blue in bits 4-0 — the same channel order as output RGBA.)
 *
 * @example
 * ```typescript
 * import { SgFile, SgImageData } from 'libsg'
 * import sharp from 'sharp'
 *
 * const sgFile = SgFile.fromPath('/path/to/China_NuWa.sg3')
 * const file555 = '/path/to/China_NuWa.555'
 *
 * const bitmap = sgFile.bitmaps[0]
 * for (const img of bitmap.images) {
 *   if (img.invert) continue                   // mirrored copy — pixel data lives on another image
 *   if (img.workRecord.length <= 0) continue   // empty slot
 *
 *   const imgData = SgImageData.from555File(img, file555)
 *   // imgData.dataFlat: Uint8Array of RGBA bytes, directly usable by sharp
 *
 *   const pngBuffer = await sharp(Buffer.from(imgData.dataFlat), {
 *     raw: { width: imgData.width, height: imgData.height, channels: 4 },
 *   }).png().toBuffer()
 *
 *   console.log(`Image ${img.imageId}: ${imgData.width}×${imgData.height}, type ${img.workRecord.type}`)
 * }
 * ```
 */
export class SgImageData
{
    // Regular isometric tile dimensions (used in all city-builders except Emperor's "large" tiles)
    public static readonly ISOMETRIC_TILE_WIDTH  = 58;
    public static readonly ISOMETRIC_TILE_HEIGHT = 30;
    /** Bytes per regular tile: 58 × 30 pixels × 2 bytes/pixel, stored as a packed diamond */
    public static readonly ISOMETRIC_TILE_BYTES  = 1800;

    // Large isometric tile dimensions (Emperor: Rise of the Middle Kingdom)
    public static readonly ISOMETRIC_LARGE_TILE_WIDTH  = 78;
    public static readonly ISOMETRIC_LARGE_TILE_HEIGHT = 40;
    /** Bytes per large tile: 78 × 40 pixels × 2 bytes/pixel, stored as a packed diamond */
    public static readonly ISOMETRIC_LARGE_TILE_BYTES  = 3200;

	/**
	 * Decoded pixel data as a flat Uint8Array of RGBA bytes: [R,G,B,A, R,G,B,A, …].
	 * Four bytes per pixel; total length = width × height × 4.
	 * This is a zero-copy view of `data`'s underlying ArrayBuffer.
	 */
	public get dataFlat(): Uint8Array {
		return new Uint8Array(this.data.buffer);
	}

	constructor(
		public readonly width: number,
		public readonly height: number,

		/** Bitmask identifying the red channel within each Uint32 pixel (always 0x000000ff) */
		public readonly rMask: number,
		/** Bitmask identifying the green channel within each Uint32 pixel (always 0x0000ff00) */
		public readonly gMask: number,
		/** Bitmask identifying the blue channel within each Uint32 pixel (always 0x00ff0000) */
		public readonly bMask: number,
		/** Bitmask identifying the alpha channel within each Uint32 pixel (always 0xff000000) */
		public readonly aMask: number,

		/** Decoded pixels: one UInt32 per pixel in row-major order, RGBA little-endian */
		public readonly data: Uint32Array
	)
	{
	}

	/**
	 * Decode an image from a .555 file into an RGBA pixel buffer.
	 *
	 * Uses `sgImage.workRecord` (not `sgImage.record`) for all metadata — for
	 * inverted/mirrored images workRecord points to the source image's record,
	 * which is where the actual pixel data lives.  After decoding, if
	 * `sgImage.invert` is true the pixels are horizontally mirrored in place.
	 *
	 * The .555 path must match the .sg3 path (same directory, same base name,
	 * different extension).
	 *
	 * Throws if:
	 *   - The image has no parent bitmap assigned
	 *   - Dimensions are zero or negative
	 *   - The record reports no data (length <= 0)
	 *   - The .555 file cannot be read or the data is malformed
	 */
	public static from555File(
		sgImage: SgImage,
		filename555: string
	): SgImageData {
		if (!sgImage.parent)
		{
			throw new Error("Image has no bitmap parent");
		}
		if (sgImage.workRecord.width <= 0 || sgImage.workRecord.height <= 0)
		{
			throw new Error("Invalid image dimensions");
		}
		if (sgImage.workRecord.length <= 0)
		{
			throw new Error("No image data available");
		}

		// `using` calls fileHandle555[Symbol.dispose]() (i.e. close()) at end of scope,
		// compiled by TypeScript to a try/finally — no manual close needed.
		using fileHandle555 = new FileHandle(filename555, "r");
		// fillBufferFromFileHandle reads (length + alphaLength) bytes starting at
		// (workRecord.offset - workRecord.flags[0]) in the .555 file.
		const buffer = fillBufferFromFileHandle(sgImage, fileHandle555);
		if (!buffer)
		{
			throw new Error("Failed to read image data");
		}

		// All pixels default to fully-transparent (0x00000000); decoders paint over them.
		const pixels = new Uint32Array(
			sgImage.workRecord.width * sgImage.workRecord.height
		).fill(0);

		switch(sgImage.workRecord.type)
		{
			case 0:
			case 1:
			case 10:
			case 12:
			case 13:
				this.loadPlainImage(sgImage, pixels, buffer);
				break;

			case 30:
				this.loadIsometricImage(sgImage, pixels, buffer);
				break;

			case 256:
			case 257:
			case 276:
				this.loadSpriteImage(sgImage, pixels, buffer);
				break;

			default:
				throw new Error(`Unknown image type: ${sgImage.workRecord.type}`)
		}

		// Alpha mask immediately follows pixel data in the buffer (same Buffer slice).
		// Only present in version 0xd6+ files where alphaLength > 0.
		if (sgImage.workRecord.alphaLength) {
			const alphaBuffer = buffer.subarray(sgImage.workRecord.length);
			this.loadAlphaMask(sgImage, pixels, alphaBuffer);
		}

		// Inverted images are horizontal mirrors; flip in place after decoding.
		if(sgImage.invert) this.mirrorResult(sgImage, pixels);

		const width  = sgImage.workRecord.width;
		const height = sgImage.workRecord.height;
		// Channel masks document the layout for callers; the actual pixel values
		// are written by set555Pixel which always uses this layout.
		const rMask = 0x000000ff;
		const gMask = 0x0000ff00;
		const bMask = 0x00ff0000;
		const aMask = 0xff000000;

		return new SgImageData(
			width, height,
			rMask, gMask, bMask, aMask,
			pixels
		);
	}

	/**
	 * Decode a plain (uncompressed) image.
	 * Wire format: row-major, 2 bytes per pixel, UInt16LE RGB555.
	 * Transparent pixels are represented by the magic value 0xf81f and are
	 * skipped by set555Pixel (the pixel remains at its default 0x00000000).
	 */
	private static loadPlainImage(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		if(sgImage.workRecord.height * sgImage.workRecord.width * 2 !== sgImage.workRecord.length) {
			throw new Error("Image data length does not match image size");
		}

		for(let y = 0, i = 0; y < sgImage.workRecord.height; y++)
		{
			for(let x = 0; x < sgImage.workRecord.width; x++, i += 2)
			{
				// Read 2-byte little-endian RGB555 value
				this.set555Pixel(sgImage, pixels, x, y, buffer[i] | (buffer[i+1] << 8));
			}
		}
	}

	/**
	 * Decode an isometric image (type 30).
	 *
	 * Isometric images have two parts stored back-to-back in the .555 data:
	 *   1. An uncompressed tile base (`uncompressedLength` bytes) holding the
	 *      flat diamond-shaped ground tiles arranged in the isometric grid.
	 *   2. A sprite RLE overlay (`length - uncompressedLength` bytes) containing
	 *      buildings, trees, or other objects placed on top of the base tiles.
	 *
	 * The base is decoded by writeIsometricBase; the overlay by writeTransparentImage.
	 */
	private static loadIsometricImage(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		this.writeIsometricBase(sgImage, pixels, buffer);
		this.writeTransparentImage(
			sgImage,
			pixels,
			buffer.subarray(sgImage.workRecord.uncompressedLength),
			sgImage.workRecord.length - sgImage.workRecord.uncompressedLength);
	}

	/** Decode a sprite (transparent RLE) image (types 256, 257, 276). */
	private static loadSpriteImage(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		this.writeTransparentImage(sgImage, pixels, buffer, sgImage.workRecord.length);
	}

	/**
	 * Apply an alpha mask blob to an already-decoded pixel buffer.
	 *
	 * The alpha mask is stored after the pixel data in the .555 file and uses
	 * the same skip/run RLE structure as the sprite decoder, but the cursor is
	 * a flat scan over ALL pixels (both transparent and opaque).  Run bytes
	 * carry 5-bit alpha values for pixels with partial transparency.
	 *
	 * Wire format:
	 *   byte 0xFF + byte N  → advance flat cursor by N pixels (alpha unchanged)
	 *   byte C (1–254)      → C alpha bytes follow; each is a 5-bit value whose
	 *                         low 5 bits are the stored alpha (expand to 8 bits
	 *                         via setAlphaPixel's `(v << 3) | (v >> 2)` formula)
	 *
	 * Only pixels with 0 < alpha < 255 are encoded; fully-opaque (255) and
	 * fully-transparent (0) pixels are always covered by skip commands.
	 */
	private static loadAlphaMask(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		const width  = sgImage.workRecord.width;
		const length = sgImage.workRecord.alphaLength;

		for(let i = 0, x = 0, y = 0; i < length; )
		{
			const c = buffer[i++];
			if(c === 255)
			{
				// Skip: advance cursor by the next byte's number of pixels
				x += buffer[i++];
				while (x >= width) {
					y++;
					x -= width;
				}
			}
			else
			{
				// Run: c pixels of partial-alpha data follow
				for (let j = 0; j < c; j++, i++)
				{
					this.setAlphaPixel(sgImage, pixels, x, y, buffer[i]);
					x++;
					if (x >= width) {
						y++;
						x = 0;
					}
				}
			}
		}
	}

	/**
	 * Decode the uncompressed tile base for an isometric image.
	 *
	 * The isometric ground tiles are stored as a diamond grid of individual tile
	 * buffers.  For a grid of `size × size` tiles:
	 *   - The first row has 1 tile, the second has 2, … up to size tiles at the
	 *     widest row, then back down symmetrically (a diamond shape).
	 *   - Total tiles = size² (same as a square grid, just displayed diagonally).
	 *
	 * `size` is read from flags[3].  When flags[3] == 0 it is inferred from the
	 * image height divided by tile height.  There is an ambiguity at 4×4 regular
	 * (4 × 30 = 120 px) vs 3×3 large (3 × 40 = 120 px) — regular takes precedence.
	 *
	 * Tile pixel data is stored tightly packed in diamond order (not rectangular
	 * bounding box).  writeIsometricTile handles the per-tile diamond layout.
	 */
	private static writeIsometricBase(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		const width        = sgImage.workRecord.width;
		const height       = (width + 2) / 2;          // diamond height = (imageWidth + 2) / 2
		const heightOffset = sgImage.workRecord.height - height;  // sprite overlay starts below this

		// flags[3] stores the grid size (number of tiles per side); derive if missing
		let size = sgImage.workRecord.flags[3];
		if(size === 0)
		{
			// Prefer regular tiles (4×30=120 over 3×40=120 edge case)
			if (height % SgImageData.ISOMETRIC_TILE_HEIGHT == 0) {
				size = height / SgImageData.ISOMETRIC_TILE_HEIGHT;
			} else if (height % SgImageData.ISOMETRIC_LARGE_TILE_HEIGHT == 0) {
				size = height / SgImageData.ISOMETRIC_LARGE_TILE_HEIGHT;
			}
		}

		let tileBytes: number,
			tileHeight: number,
			tileWidth: number;

		// Choose tile dimensions: regular (most games) or large (Emperor: RotMK)
		if (SgImageData.ISOMETRIC_TILE_HEIGHT * size == height) {
			tileBytes  = SgImageData.ISOMETRIC_TILE_BYTES;
			tileHeight = SgImageData.ISOMETRIC_TILE_HEIGHT;
			tileWidth  = SgImageData.ISOMETRIC_TILE_WIDTH;
		} else if (SgImageData.ISOMETRIC_LARGE_TILE_HEIGHT * size == height) {
			tileBytes  = SgImageData.ISOMETRIC_LARGE_TILE_BYTES;
			tileHeight = SgImageData.ISOMETRIC_LARGE_TILE_HEIGHT;
			tileWidth  = SgImageData.ISOMETRIC_LARGE_TILE_WIDTH;
		} else {
			throw new Error("Unknown tile size");
		}

		// Sanity check: uncompressedLength must equal the total footprint in bytes
		if ((width + 2) * height != sgImage.workRecord.uncompressedLength) {
			throw new Error("Data length doesn't match footprint size");
			return;
		}

		// Iterate the diamond grid row by row.
		// Row 0 has 1 tile; row (size-1) has `size` tiles; row (2*size-2) has 1 tile.
		for (
			let i = 0, y = 0, yOffset = heightOffset;
			y < (size + (size - 1));
			y++
		) {
			// xOffset: left edge of the first tile in this row (in pixels)
			let xOffset = (y < size ? (size - y - 1) : (y - size + 1)) * tileHeight;

			// Number of tiles in this row (rises then falls like a diamond)
			for (
				let x = 0;
				x < (y < size ? y + 1 : 2 * size - y - 1);
				x++, i++
			) {
				this.writeIsometricTile(
					sgImage,
					pixels,
					buffer.subarray(i * tileBytes, (i + 1) * tileBytes),
					xOffset,
					yOffset,
					tileWidth,
					tileHeight
				);
				xOffset += tileWidth + 2;   // +2 px gap between tiles in a row
			}
			yOffset += tileHeight / 2;      // each row descends by half a tile height
		}
	}

	/**
	 * Write one isometric tile's pixels into the output buffer at (offsetX, offsetY).
	 *
	 * Each tile is a diamond (rhombus) shape.  The tile data is stored compactly —
	 * only the visible pixels within the diamond are stored, left to right, top to
	 * bottom.  The diamond narrows at the top and bottom and widens in the middle.
	 *
	 * For the upper half (y < halfHeight):
	 *   pixel columns [tileHeight - 2*(y+1), tileWidth - (tileHeight - 2*(y+1))] are visible
	 * For the lower half (y >= halfHeight):
	 *   pixel columns [(2*y - halfHeight), tileWidth - (2*y - halfHeight)] are visible
	 */
	private static writeIsometricTile(
		sgImage: SgImage,
		pixels: Uint32Array,
		buffer: Buffer,
		offsetX: number,
		offsetY: number,
		tileWidth: number,
		tileHeight: number
	): void
	{
		const halfHeight = Math.floor(tileHeight / 2);

		let i = 0;
		// Upper half of the diamond: each row gets wider
		for(let y = 0; y < halfHeight; y++)
		{
			const start = tileHeight - 2 * (y + 1);
			const end   = tileWidth - start;

			for(let x = start; x < end; x++, i += 2)
			{
				this.set555Pixel(
					sgImage,
					pixels,
					offsetX + x,
					offsetY + y,
					(buffer[i+1] << 8) | buffer[i]
				);
			}
		}

		// Lower half of the diamond: each row gets narrower
		for(let y = halfHeight; y < tileHeight; y++)
		{
			const start = (2 * y) - halfHeight;
			const end   = tileWidth - start;

			for(let x = start; x < end; x++, i += 2)
			{
				this.set555Pixel(
					sgImage,
					pixels,
					offsetX + x,
					offsetY + y,
					(buffer[i+1] << 8) | buffer[i]
				);
			}
		}
	}

	/**
	 * Decode sprite RLE data into the pixel buffer.
	 *
	 * Wire format:
	 *   byte 0xFF + byte N   → skip N pixels (advance cursor; those pixels stay transparent)
	 *   byte C (1–254)       → C opaque pixels follow; each is 2 bytes of UInt16LE RGB555
	 *
	 * The cursor is a flat scan: it advances column-by-column, wrapping to the next row
	 * when x reaches the image width.  This decoder allows commands to cross row boundaries
	 * (the C reference decoder also does this).
	 *
	 * IMPORTANT: The ENCODER must not emit commands that cross row boundaries, because the
	 * game's renderer advances the row at specific points and will misalign pixels if a
	 * command spans two rows.  The decoder is more permissive than the encoder must be.
	 */
	private static writeTransparentImage(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer, length: number): void
	{
		let i = 0;
		let x = 0, y = 0;
		const width = sgImage.workRecord.width;

		while (i < length) {
			const c = buffer[i++];
			if (c === 255) {
				// Skip: advance cursor by the next byte's number of pixels
				x += buffer[i++];
				while (x >= width) {
					y++;
					x -= width;
				}
			} else {
				// Run: c opaque pixels (each 2 bytes of RGB555) follow
				for (let j = 0; j < c; j++, i += 2) {
					this.set555Pixel(sgImage, pixels, x, y, buffer[i] | (buffer[i + 1] << 8));
					x++;
					if (x >= width) {
						y++;
						x = 0;
					}
				}
			}
		}
	}

	/**
	 * Write a single RGB555 pixel into the pixel buffer at (x, y).
	 *
	 * The magic value 0xf81f is the transparent marker — it is skipped, leaving
	 * the pixel at its default value (0x00000000 = fully transparent).
	 *
	 * RGB555 channel layout:
	 *   bits 14-10 = Red (5 bits)
	 *   bits  9-5  = Green (5 bits)
	 *   bits  4-0  = Blue (5 bits)
	 *
	 * Each 5-bit channel is expanded to 8 bits by left-shifting 3 places and then
	 * ORing in the top 3 bits of the channel as the 3 low bits, so that 0x1f maps
	 * to 0xff (full intensity) rather than 0xf8.
	 *
	 * Output Uint32 layout (little-endian memory = RGBA bytes):
	 *   byte 0 (bits  7-0 ) = Red
	 *   byte 1 (bits 15-8 ) = Green
	 *   byte 2 (bits 23-16) = Blue
	 *   byte 3 (bits 31-24) = Alpha (always 0xff for opaque pixels)
	 *
	 * This layout is correct for sharp's raw RGBA input and matches the channel
	 * masks defined in from555File (rMask=0x000000ff, gMask=0x0000ff00, bMask=0x00ff0000).
	 */
	private static set555Pixel(sgImage: SgImage, pixels: Uint32Array, x: number, y: number, color: number): void
	{
		if(color === 0xf81f) return;  // magic transparent value — leave pixel at 0

		let rgb = 0xff000000;  // A=255, R=G=B=0 to start

		// Red: extract bits 14-10, expand to 8-bit in byte position 0 (bits 7-0)
		rgb |= ((color & 0x7c00) >> 7) | ((color & 0x7000) >> 12);

		// Green: extract bits 9-5, expand to 8-bit in byte position 1 (bits 15-8)
		rgb |= ((color & 0x3e0) << 6) | ((color & 0x300));

		// Blue: extract bits 4-0, expand to 8-bit in byte position 2 (bits 23-16)
		rgb |= ((color & 0x1f) << 19) | ((color & 0x1c) << 14);

		pixels[y * sgImage.workRecord.width + x] = rgb;
	}

	/**
	 * Apply a partial-alpha byte from the alpha mask blob to one pixel.
	 *
	 * Stored alpha is 5-bit (0–31).  Expand to 8-bit using the same technique as
	 * the RGB channels: `(v << 3) | (v >> 2)` so that 31 maps to 255.
	 *
	 * The existing RGB in the pixel is preserved; only the alpha byte is replaced.
	 */
	private static setAlphaPixel(sgImage: SgImage, pixels: Uint32Array, x: number, y: number, color: number): void
	{
		// Expand 5-bit stored alpha to 8-bit
		const alpha = ((color & 0x1f) << 3) | ((color & 0x1c) >> 2);

		const p = y * sgImage.workRecord.width + x;
		pixels[p] = (pixels[p] & 0x00ffffff) | (alpha << 24);
	}

	/**
	 * Horizontally mirror the pixel buffer in place.
	 *
	 * Inverted images (those whose SgImageRecord.invertOffset is negative) are
	 * decoded from the same pixel data as their source image, then flipped here.
	 * This gives the game's left/right variants of character animations without
	 * storing duplicate pixel data.
	 *
	 * We iterate over the left half of each row (x < width/2) and swap each pixel
	 * with its mirror partner on the right: pixel (x, y) ↔ pixel (width-1-x, y).
	 *
	 * In flat row-major indices:
	 *   p1 = y * width + x
	 *   p2 = y * width + (width - 1 - x)
	 *      = (y + 1) * width - 1 - x     ← this form avoids a separate multiply
	 *
	 * Common off-by-one mistake: using `(y+1)*width - x` (missing the `-1`) puts
	 * p2 one position too far right, which for x=0 lands on pixel (0, y+1) —
	 * the first pixel of the *next* row — corrupting the image with cross-row swaps.
	 */
	private static mirrorResult(sgImage: SgImage, pixels: Uint32Array): void {
		const width = sgImage.workRecord.width;
		for(let x = 0; x < (width - 1) / 2; x++)
		{
			for(let y = 0; y < sgImage.workRecord.height; y++)
			{
				const p1 = y * width + x;
				const p2 = (y + 1) * width - 1 - x;  // = y*width + (width-1-x)

				const tmp = pixels[p1];
				pixels[p1] = pixels[p2];
				pixels[p2] = tmp;
			}
		}
	}
}
