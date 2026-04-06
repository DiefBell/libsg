import { FileHandle, ESeekOrigin } from "./util/FileHandle";
import { readUInt32Le, readInt32Le, readUInt16Le, readUInt8Le } from "./util/readNumberLe";

/**
 * One image record from the .sg3 file.
 *
 * Record size:
 *   64 bytes for version 0xd5 (SG3 without alpha)
 *   72 bytes for version 0xd6 (SG3 with alpha — adds alphaOffset + alphaLength)
 *
 * Byte layout (offsets within the record):
 *    0  UInt32LE  offset            — encoded .555 position (see notes below)
 *    4  UInt32LE  length            — pixel data byte length in .555
 *    8  UInt32LE  uncompressedLength— tile base byte length (isometric only)
 *   12  4 bytes   padding/zero
 *   16  Int32LE   invertOffset      — signed; negative = mirror of that many images back
 *   20  UInt16LE  width
 *   22  UInt16LE  height
 *   24  26 bytes  unknown (mostly zero; first 4 bytes are two UInt16LE fields)
 *   50  UInt16LE  type              — image encoding type
 *   52  4 bytes   flags[0..3]
 *   56  UInt8     bitmapId          — index of the parent SgBitmap
 *   57  7 bytes   padding/zero
 *   --- (v0xd6+ only) ---
 *   64  UInt32LE  alphaOffset       — encoded .555 position of alpha mask
 *   68  UInt32LE  alphaLength       — alpha mask byte length
 *
 * IMPORTANT — flags[0] and the offset field:
 *   The game reads pixel data from: (offset - flags[0])
 *   flags[0] is called the "extern" flag in the C source.  When writing, always
 *   store `record.offset = absolute_555_position + original_flags[0]` and leave
 *   flags[0] unchanged, so that the game's subtraction yields the correct position.
 *
 * IMPORTANT — invertOffset is a signed Int32:
 *   A negative value means this image's pixels should be decoded from the image
 *   at index (thisImageIndex + invertOffset), then horizontally mirrored.
 *   Reading it as UInt32 (as earlier code mistakenly did) causes the sign check
 *   to never fire, breaking the invert chain for mirrored animation frames.
 */
export class SgImageRecord
{
	protected constructor(
		/**
		 * Encoded byte offset into the .555 file.
		 * Actual read position = offset - flags[0].
		 * Written as absolute_555_position + flags[0] so the game's subtraction
		 * yields the correct address.
		 */
		public readonly offset: number,

		/** Byte length of the pixel data block in the .555 file. */
		public readonly length: number,

		/**
		 * For isometric images (type 30): byte length of the uncompressed tile base.
		 * The sprite RLE overlay begins at offset+uncompressedLength in the .555 file.
		 * Zero for all other image types.
		 */
		public readonly uncompressedLength: number,

		/**
		 * Signed relative index delta used for mirrored images.
		 * When negative, this image has no pixel data of its own; the image at
		 * (imageId + invertOffset) is decoded and then horizontally flipped.
		 * Zero for normal (non-inverted) images.
		 */
		public readonly invertOffset: number,

		public readonly width: number,
		public readonly height: number,

		/**
		 * Image encoding type.  Known values:
		 *   0, 1, 10, 12, 13  — plain (uncompressed row-major RGB555)
		 *   30                 — isometric (tiled base + sprite RLE overlay)
		 *   256, 257, 276      — sprite (RLE with skip/run commands)
		 */
		public readonly type: number,

		/**
		 * 4 per-image option bytes.
		 *   flags[0]  "extern" offset adjustment — see class-level comment above
		 *   flags[1]  unknown
		 *   flags[2]  unknown
		 *   flags[3]  isometric grid size (number of tiles per side; 0 = derive from height)
		 */
		public readonly flags: Uint8Array,

		/** 0-based index of the parent SgBitmap in SgFile.bitmaps */
		public readonly bitmapId: number,

		/**
		 * Encoded byte offset of the alpha mask in the .555 file (v0xd6+ only).
		 * Actual read position = alphaOffset - flags[0].
		 * Zero for v0xd5 records or when no alpha mask is present.
		 */
		public readonly alphaOffset: number,

		/**
		 * Byte length of the alpha mask data (v0xd6+ only).
		 * Zero when no alpha mask is present.
		 */
		public readonly alphaLength: number
	) { }

	/**
	 * Parse one image record from the current file position.
	 *
	 * @param includeAlpha  Pass true for version 0xd6+ files to read the
	 *                      8-byte alpha fields at the end of each record.
	 *                      For 0xd5 files pass false; alphaOffset and alphaLength
	 *                      will be set to 0.
	 */
	public static FromFileHandle(file: FileHandle, includeAlpha: boolean): SgImageRecord
	{
		const offset              = readUInt32Le(file);
		const length              = readUInt32Le(file);
		const uncompressed_length = readUInt32Le(file);

		file.seek(4, ESeekOrigin.SEEK_CUR);  // 4 bytes padding (always zero)

		// CRITICAL: invertOffset is a signed int32 in the C source (int32_t).
		// Negative values indicate this image mirrors an earlier one.
		// Reading as UInt32 (as was done in an earlier version) causes the
		// sign check in SgFile to never fire, silently corrupting inverted images.
		const invert_offset = readInt32Le(file);

		const width  = readUInt16Le(file);
		const height = readUInt16Le(file);

		file.seek(26, ESeekOrigin.SEEK_CUR);  // 26 unknown bytes

		const type = readUInt16Le(file);

		const flagsBuffer = Buffer.alloc(4);
		file.read(flagsBuffer, 0, 4);
		const flags = new Uint8Array(flagsBuffer);

		const bitmap_id = readUInt8Le(file);

		file.seek(7, ESeekOrigin.SEEK_CUR);  // 3 unknown + 4 zero bytes

		// Alpha fields only exist in version 0xd6+ (72-byte records)
		const alpha_offset = includeAlpha ? readUInt32Le(file) : 0;
		const alpha_length = includeAlpha ? readUInt32Le(file) : 0;

		return new SgImageRecord(
			offset,
			length,
			uncompressed_length,
			invert_offset,
			width,
			height,
			type,
			flags,
			bitmap_id,
			alpha_offset,
			alpha_length
		);
	}
}
