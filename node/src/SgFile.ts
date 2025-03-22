import { SgBitmap } from "./SgBitmap";
import { SgImage } from "./SgImage";
import { FileHandle, readInt32Le, readUInt32Le } from "./util";
import * as fs from "fs";

export class SgHeader {
	public static readonly SG_HEADER_SIZE = 680;

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

	constructor(file: FileHandle) {
		this.sgFilesize = readUInt32Le(file);
		this.version = readUInt32Le(file);
		this.unknown1 = readUInt32Le(file);

		this.maxImageRecords = readInt32Le(file);
		this.numImageRecords = readInt32Le(file);

		this.numBitmapRecords = readInt32Le(file);
		this.numBitmapRecordsWithoutSystem = readInt32Le(file);

		this.totalFilesize = readUInt32Le(file);
		this.filesize555 = readUInt32Le(file);
		this.filesizeExternal = readUInt32Le(file);

		if (file.position < SgHeader.SG_HEADER_SIZE) {
            file.setPosition(SgHeader.SG_HEADER_SIZE);
        }
	}
}

export class SgFile {
	public readonly bitmaps: SgBitmap[];
	public readonly images: SgImage[];
	public readonly filename: string;
	public readonly header: SgHeader;

	constructor(filepath: string) {
		this.filename = filepath;

		using fileHandle = new FileHandle(filepath);
		this.header = new SgHeader(fileHandle);

		this.bitmaps = [];
		this.images = [];
	}
}
