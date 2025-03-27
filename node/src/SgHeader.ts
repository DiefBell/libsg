import { FileHandle, ESeekOrigin } from "./util/FileHandle";
import { readUInt32Le, readInt32Le } from "./util/readNumberLe";


export class SgHeader
{
	public static readonly SG_HEADER_SIZE = 680;

	constructor(
		public readonly sgFilesize: number,
		public readonly version: number,
		public readonly unknown1: number,

		public readonly maxImageRecords: number,
		public readonly numImageRecords: number,

		public readonly numBitmapRecords: number,
		public readonly numBitmapRecordsWithoutSystem: number, /* ? */

		public readonly totalFilesize: number,
		public readonly filesize555: number,
		public readonly filesizeExternal: number
	) { }

	public static FromFileHandle(file: FileHandle): SgHeader
	{
		const sgHeader = new SgHeader(
			readUInt32Le(file),
			readUInt32Le(file),
			readUInt32Le(file),

			readInt32Le(file),
			readInt32Le(file),

			readInt32Le(file),
			readInt32Le(file),

			readUInt32Le(file),
			readUInt32Le(file),
			readUInt32Le(file)
		);

		file.seek(SgHeader.SG_HEADER_SIZE, ESeekOrigin.SEEK_SET);
		return sgHeader;
	}
}
