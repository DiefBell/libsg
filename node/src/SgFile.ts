import { SgBitmap } from "./SgBitmap";
import { SgBitmapRecord } from "./SgBitmapRecord";
import { SgImage } from "./SgImage";
import { ESeekOrigin, FileHandle } from "./util/FileHandle";
import * as fs from "fs";
import { SgHeader } from "./SgHeader";

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

	public static fromPath(sg3Path: string): SgFile {
		const fileHandle = new FileHandle(sg3Path);
		return SgFile.FromFileHandle(fileHandle);
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

			const invertOffset = sgImage.record.invertOffset;
			if(invertOffset < 0 && (i + invertOffset) >= 0) {
				sgImage.setInvert(sgFile.images[i + invertOffset]);
			}

			const bitmapId = sgImage.getBitmapId();
			if(bitmapId >= 0 && bitmapId < sgFile.bitmaps.length) {
				sgFile.bitmaps[bitmapId].images.push(sgImage);
				sgImage.setParent(sgFile.bitmaps[bitmapId]);
			}
			else {
				console.warn(`Image ${i} has no parent: ${bitmapId}`);
			}

			sgFile.images.push(sgImage);
		}

		if(sgFile.bitmaps.length > 1 && sgFile.images.length === sgFile.bitmaps[0].images.length) {
			console.warn(`SG File has ${sgFile.bitmaps.length} bitmaps but only the first is in use`);
			// Remove the bitmaps other than the first
			sgFile.bitmaps.splice(1);
		}

		fileHandle.close();
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
