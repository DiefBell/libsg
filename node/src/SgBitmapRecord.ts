import { SgFile } from "./SgFile";
import { FileHandle, ESeekOrigin } from "./util/FileHandle";
import { readUInt32Le } from "./util/readNumberLe";

export class SgBitmapRecord
{
	public static readonly SG_BITMAP_RECORD_SIZE = 200;
	public static readonly SG_BITMAP_FILENAME_SIZE = 65;
	public static readonly SG_BITMAP_RECORD_COMMENT_SIZE = 51;

	protected constructor(
		public readonly sgFilename: string,
		public readonly comment: string,
		public readonly width: number,
		public readonly height: number,
		public readonly numImages: number,
		public readonly startIndex: number,
		public readonly endIndex: number,
		/* 4 bytes - quint32 between start & end */
		/* 16b, 4x int with unknown purpose */
		/*  8b, 2x int with (real?) width & height */
		/* 12b, 3x int: if any is non-zero: internal image */
		/* 24 more misc bytes, most zero */
		public readonly unknownFields: Buffer = Buffer.alloc(0)
	) { }

	public static FromFileHandle(file: FileHandle): SgBitmapRecord
	{
		const bitmapRecord = new SgBitmapRecord(
			file.readString(SgBitmapRecord.SG_BITMAP_FILENAME_SIZE),
			file.readString(SgBitmapRecord.SG_BITMAP_RECORD_COMMENT_SIZE),

			readUInt32Le(file),
			readUInt32Le(file),
			readUInt32Le(file),
			readUInt32Le(file),
			readUInt32Le(file)
		);

		file.seek(64, ESeekOrigin.SEEK_CUR);
		return bitmapRecord;
	}

	public static MaxRecordsInFile(file: SgFile): number
	{
		return file.header.version === 0xd3
			? 100 //SG2
			: 200; //SG3
	}
}
