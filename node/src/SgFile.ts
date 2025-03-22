import { SgBitmap } from "./SgBitmap";
import { SgImage } from "./SgImage";

const SG_HEADER_SIZE = 680;
const SG_BITMAP_RECORD_SIZE = 200;

export class SgHeader {
	public readonly sgFilesize: number;
	public readonly version: number;
	public readonly unknown1: number;

	public readonly maxImageRecords: number;
	public readonly numImageRecords: number;
	
	public readonly numBitmapRecords: number;
	public readonly numBitmapRecordsWithoutSystem: number; /* ? */

	public readonly totalFilesize: number;
	public readonly filesize555: number;
	public readonly filesizeExternal: number;
}

export class SgFile {
	public readonly bitmaps: SgBitmap[];
	public readonly images: SgImage[];
	public readonly filename: string;
	public readonly header: SgHeader;
}
