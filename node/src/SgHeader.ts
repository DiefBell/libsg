import { FileHandle, ESeekOrigin } from "./util/FileHandle";
import { readUInt32Le, readInt32Le } from "./util/readNumberLe";

/**
 * The 680-byte header at the start of every .sg2 / .sg3 file.
 *
 * Only the first 40 bytes are parsed here; the remaining 640 bytes are
 * skipped by seeking to SG_HEADER_SIZE after the read.
 *
 * Version identifiers:
 *   0xd3  SG2  (Caesar 3, Pharaoh, Zeus …)  — up to 100 bitmap records
 *   0xd5  SG3  (Emperor: RotMK, etc.)        — up to 200 bitmap records, no alpha
 *   0xd6  SG3+ (Emperor: RotMK with alpha)   — up to 200 bitmap records, alpha mask fields
 */
export class SgHeader
{
	/** Total size of the header block in bytes.  The parser always seeks past this
	 *  after reading so that the file position is aligned to the bitmap records. */
	public static readonly SG_HEADER_SIZE = 680;

	constructor(
		/** Declared size of this .sg file in bytes.
		 *  For SG3 files this should equal the actual file size on disk. */
		public readonly sgFilesize: number,

		/** File format version: 0xd3 (SG2), 0xd5 (SG3), or 0xd6 (SG3+alpha). */
		public readonly version: number,

		/** Unknown; always seems to be 1 in practice. */
		public readonly unknown1: number,

		/** Maximum number of image records the file was built to hold.
		 *  Not the same as numImageRecords — this is an upper bound. */
		public readonly maxImageRecords: number,

		/** Actual number of image records that follow the bitmap table.
		 *  Image records are 1-indexed; record 0 is a dummy placeholder. */
		public readonly numImageRecords: number,

		/** Number of bitmap records that follow the header.
		 *  Each bitmap record is 200 bytes. */
		public readonly numBitmapRecords: number,

		/** Number of bitmap records that are "real" content (as opposed to system/
		 *  internal records).  Exact meaning is uncertain; treat as informational. */
		public readonly numBitmapRecordsWithoutSystem: number,

		/** Combined size of all data: sg file + 555 file + any external file.
		 *  Used as a sanity check by some readers. */
		public readonly totalFilesize: number,

		/** Declared size of the companion .555 pixel-data file in bytes.
		 *  SgFileWriter updates this field when writing a modified file. */
		public readonly filesize555: number,

		/** Declared size of any external .555 file (used by some multi-part assets).
		 *  Usually 0 for single-file assets. */
		public readonly filesizeExternal: number
	) { }

	public static FromFileHandle(file: FileHandle): SgHeader
	{
		const sgHeader = new SgHeader(
			readUInt32Le(file),   // sgFilesize
			readUInt32Le(file),   // version
			readUInt32Le(file),   // unknown1

			readInt32Le(file),    // maxImageRecords
			readInt32Le(file),    // numImageRecords

			readInt32Le(file),    // numBitmapRecords
			readInt32Le(file),    // numBitmapRecordsWithoutSystem

			readUInt32Le(file),   // totalFilesize
			readUInt32Le(file),   // filesize555
			readUInt32Le(file)    // filesizeExternal
		);

		// Skip the rest of the 680-byte header (bytes 40–679 are unknown/padding)
		file.seek(SgHeader.SG_HEADER_SIZE, ESeekOrigin.SEEK_SET);
		return sgHeader;
	}
}
