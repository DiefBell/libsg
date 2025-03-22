import { SgBitmap, SgBitmapRecord } from "./SgBitmap";
import { SgImage } from "./SgImage";
import { readInt32Le, readUInt32Le } from "./util/readNumberLe";
import { ESeekOrigin, FileHandle } from "./util/FileHandle";
import * as fs from "fs";

export class SgHeader {
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
		public readonly filesizeExternal: number,
	){}

	public static FromFileHandle(file: FileHandle): SgHeader {
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
			readUInt32Le(file),
		);

		file.seek(SgHeader.SG_HEADER_SIZE, ESeekOrigin.SEEK_SET);
		return sgHeader;
	}
}

export class SgFile {
	public readonly bitmaps: SgBitmap[];
	public readonly images: SgImage[];

	protected constructor(
		public readonly filename: string,
		public readonly header: SgHeader,
	){
		this.bitmaps = [];
		this.images = [];

		if(!SgFile.FileSizeMatchesVersion(this)) {
			throw new Error("Invalid file version or size");
		}
	}

	public static FromFileHandle(fileHandle: FileHandle): SgFile {
		const sgFile = new SgFile(
			fileHandle.filepath,
			SgHeader.FromFileHandle(fileHandle)
		);

		for(let id = 0; id < sgFile.header.numBitmapRecords; id++) {
			sgFile.bitmaps.push(SgBitmap.FromFileHandle(fileHandle, id));
		}

		const pos = SgHeader.SG_HEADER_SIZE + (
			SgBitmapRecord.MaxRecordsInFile(sgFile) * SgBitmapRecord.SG_BITMAP_RECORD_SIZE
		);
		fileHandle.seek(pos, ESeekOrigin.SEEK_SET);

		const includeAlpha = sgFile.header.version >= 0xd6

		// The first one is a dummy/null record
		SgImage.FromFileHandle(fileHandle, 0, includeAlpha);

		for(let i = 0; i < sgFile.header.numImageRecords; i++) {
			const sgImage = SgImage.FromFileHandle(fileHandle, i + 1, includeAlpha);
			const invertOffset = sgImage.record.invert_offset;

			if(invertOffset < 0 && (i + invertOffset) >= 0) {
				sgImage.setInvert(sgFile.images[i + invertOffset]);
			}

			// TODO...
		}

		return sgFile;
	}

	/**
	 * Checks the version of the SgFile and validates the filesize based on the version.
	 * @returns 2 or 3, depending on the version, if the filesize is correct; otherwise, undefined.
	 */
	public static FileSizeMatchesVersion(sgFile: SgFile): boolean {
		const { header, filename } = sgFile;

		if (header.version === 0xd3) {
			// SG2 file: filesize = 74480 or 522680
			// (depending on whether it's a "normal" sg2 or an enemy sg2
			if (header.sgFilesize === 74480 || header.sgFilesize === 522680) {
				return true;
			}
		} else if (header.version === 0xd5 || header.version === 0xd6) {
			// SG3 file: filesize = the actual size of the sg3 file
			try {
				const stats = fs.statSync(filename);
				const filesize = stats.size;

				if (header.sgFilesize === 74480 || filesize === header.sgFilesize) {
					return true;
				}
			} catch (error) {
				// Handle file read error
				console.error("Error checking file size:", error);
			}
		}

		// All other cases:
		return false;
	}
}
