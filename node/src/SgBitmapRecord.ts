import { SgFile } from "./SgFile";
import { FileHandle, ESeekOrigin } from "./util/FileHandle";
import { readUInt32Le } from "./util/readNumberLe";

/**
 * One 200-byte bitmap record from the .sg3 file.
 *
 * Bitmap records immediately follow the 680-byte header and form a fixed-size
 * table: 100 entries for SG2 (version 0xd3) or 200 entries for SG3/SG3+.
 * The file always contains the maximum number of slots; unused slots are zero.
 *
 * A bitmap record describes a group of related images and names the .555 file
 * that contains their pixel data.  The sgFilename field stores the base name
 * (without the directory path) and the corresponding .555 file is expected to
 * be in the same directory as the .sg3 file.
 *
 * Record layout (200 bytes total):
 *   bytes   0– 64  sgFilename      (65-byte null-terminated string)
 *   bytes  65–115  comment         (51-byte null-terminated string)
 *   bytes 116–119  width           (UInt32LE)
 *   bytes 120–123  height          (UInt32LE)
 *   bytes 124–127  numImages       (UInt32LE)
 *   bytes 128–131  startIndex      (UInt32LE) — index of first image record
 *   bytes 132–135  endIndex        (UInt32LE) — index of last image record (inclusive)
 *   bytes 136–199  unknown (64 bytes):
 *     +0   4 bytes UInt32 (unknown, between startIndex and endIndex in some files)
 *     +4  16 bytes 4× Int32 unknown purpose
 *     +20  8 bytes 2× Int32 "real" width & height (sometimes present)
 *     +28 12 bytes 3× Int32 non-zero if this is an "internal" image group
 *     +40 24 bytes miscellaneous, mostly zero
 */
export class SgBitmapRecord
{
	/** Size of one complete bitmap record in bytes */
	public static readonly SG_BITMAP_RECORD_SIZE = 200;
	/** Length of the sgFilename field in bytes (includes null terminator) */
	public static readonly SG_BITMAP_FILENAME_SIZE = 65;
	/** Length of the comment field in bytes (includes null terminator) */
	public static readonly SG_BITMAP_RECORD_COMMENT_SIZE = 51;

	protected constructor(
		/** Base filename of the associated .555 pixel-data file (no path, no extension) */
		public readonly sgFilename: string,
		/** Human-readable comment stored in the file (often empty) */
		public readonly comment: string,
		/** Declared width of the bitmap group in pixels */
		public readonly width: number,
		/** Declared height of the bitmap group in pixels */
		public readonly height: number,
		/** Number of image records belonging to this bitmap group */
		public readonly numImages: number,
		/** Index of the first image record in the global image array (1-based) */
		public readonly startIndex: number,
		/** Index of the last image record in the global image array (inclusive, 1-based) */
		public readonly endIndex: number,
		/** The 64 unknown bytes that follow endIndex — parsed but not interpreted */
		public readonly unknownFields: Buffer = Buffer.alloc(0)
	) { }

	public static FromFileHandle(file: FileHandle): SgBitmapRecord
	{
		const bitmapRecord = new SgBitmapRecord(
			file.readString(SgBitmapRecord.SG_BITMAP_FILENAME_SIZE),
			file.readString(SgBitmapRecord.SG_BITMAP_RECORD_COMMENT_SIZE),

			readUInt32Le(file),   // width
			readUInt32Le(file),   // height
			readUInt32Le(file),   // numImages
			readUInt32Le(file),   // startIndex
			readUInt32Le(file)    // endIndex
		);

		// Skip 64 bytes of unknown/internal fields to land on the next record boundary
		file.seek(64, ESeekOrigin.SEEK_CUR);
		return bitmapRecord;
	}

	/**
	 * Maximum number of bitmap records stored in the file's bitmap table.
	 * The table is always full-sized; unused slots are zeroed out.
	 */
	public static MaxRecordsInFile(file: SgFile): number
	{
		return file.header.version === 0xd3
			? 100   // SG2 files (Caesar 3, Pharaoh, Zeus …)
			: 200;  // SG3/SG3+ files (Emperor, etc.)
	}
}
