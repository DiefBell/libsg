import { SgBitmap } from "./SgBitmap";
import { ESeekOrigin, FileHandle } from "./util/FileHandle";
import { readUInt16Le, readUInt32Le, readUInt8Le } from "./util/readNumberLe";

enum EIsometric {
    TILE_WIDTH = 58,
    TILE_HEIGHT = 30,
    TILE_BYTES = 1800,
    LARGE_TILE_WIDTH = 78,
    LARGE_TILE_HEIGHT = 40,
    LARGE_TILE_BYTES = 3200
};

export class SgImageRecord {
	protected constructor(
		public readonly offset: number,
		public readonly length: number,
		public readonly uncompressed_length: number,
		public readonly invert_offset: number,
		public readonly width: number,
		public readonly height: number,
		public readonly type: number,
		public readonly flags: [string, string, string, string],
		public readonly bitmap_id: number,
		public readonly alpha_offset: number,
		public readonly alpha_length: number,
	){}

	public static FromFileHandle(file: FileHandle, includeAlpha: boolean): SgImageRecord {
		const offset = readUInt32Le(file);
		const length = readUInt32Le(file);
		const uncompressed_length = readUInt32Le(file);

		file.seek(4, ESeekOrigin.SEEK_CUR);

		const invert_offset = readUInt32Le(file);
		const width = readUInt16Le(file);
		const height = readUInt16Le(file);

		file.seek(26, ESeekOrigin.SEEK_CUR);

		const type = readUInt16Le(file);
		const flags = Array.from(file.readString(4)) as [string, string, string, string];
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
			alpha_length,
		);
	}
}

export class SgImage {
	public readonly error: string | null;
	public readonly invert: boolean;
	protected _workRecord: SgImageRecord;
	public get workRecord() { return this._workRecord; }

	protected constructor(
		public readonly parent: SgBitmap | null,
		public readonly record: SgImageRecord,
		public readonly imageId: number,
	){
		this.error = "\0";
		this._workRecord = record;
		this.invert = this.record.invert_offset !== 0;
	}

	public static FromFileHandle(
		file: FileHandle,
		id: number,
		includeAlpha: boolean
	): SgImage {
		const sgImage = new SgImage(
			null,
			SgImageRecord.FromFileHandle(file, includeAlpha),
			id
		);
		return sgImage;
	}

	public setInvert(invert: SgImage): void {
		this._workRecord = invert.record;
	}
}
