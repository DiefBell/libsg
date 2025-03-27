import { FileHandle, ESeekOrigin } from "./util/FileHandle";
import { readUInt32Le, readUInt16Le, readUInt8Le } from "./util/readNumberLe";


export class SgImageRecord
{
	protected constructor(
		public readonly offset: number,
		public readonly length: number,
		public readonly uncompressedLength: number,
		/* 4 zero bytes: */
		public readonly invertOffset: number,
		public readonly width: number,
		public readonly height: number,
		/* 26 unknown bytes, mostly zero, first four are 2 shorts */
		public readonly type: number,
		/* 4 flag/option-like bytes: */
		public readonly flags: Uint8Array,
		public readonly bitmapId: number,
		/* 3 bytes + 4 zero bytes */
		/* For D6 and up SG3 versions: alpha masks */
		public readonly alphaOffset: number,
		public readonly alphaLength: number
	) { }

	public static FromFileHandle(file: FileHandle, includeAlpha: boolean): SgImageRecord
	{
		const offset = readUInt32Le(file);
		const length = readUInt32Le(file);
		const uncompressed_length = readUInt32Le(file);

		file.seek(4, ESeekOrigin.SEEK_CUR);

		const invert_offset = readUInt32Le(file);
		const width = readUInt16Le(file);
		const height = readUInt16Le(file);

		file.seek(26, ESeekOrigin.SEEK_CUR);

		const type = readUInt16Le(file);
		
		const flagsBuffer = Buffer.alloc(4)
		file.read(flagsBuffer, 0, 4)
		const flags = new Uint8Array(flagsBuffer);
		
		const bitmap_id = readUInt8Le(file);

		file.seek(7, ESeekOrigin.SEEK_CUR);

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
