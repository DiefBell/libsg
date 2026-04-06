import { SgBitmap } from "./SgBitmap";
import { SgBitmapRecord } from "./SgBitmapRecord";
import { SgImage } from "./SgImage";
import { ESeekOrigin, FileHandle } from "./util/FileHandle";
import * as fs from "fs";
import { SgHeader } from "./SgHeader";

/**
 * A fully-parsed .sg3 (or .sg2) file.
 *
 * Physical file layout:
 *   bytes 0–679         SgHeader (680 bytes)
 *   bytes 680–…         Bitmap record table:
 *                         100 × 200-byte records for version 0xd3 (SG2)
 *                         200 × 200-byte records for version 0xd5/0xd6 (SG3/SG3+)
 *                         Unused slots are zeroed out.
 *   bytes after table   Image records:
 *                         (1 + numImageRecords) records at 64 or 72 bytes each
 *                         Record 0 is a dummy placeholder; real records are 1-based.
 *
 * After parsing, the `bitmaps` and `images` arrays are cross-linked:
 *   - Each SgImage has a `parent` pointing to its SgBitmap.
 *   - Each SgBitmap has an `images` array listing its child SgImages.
 *   - Inverted/mirrored images have their workRecord pointed at the source image.
 *
 * The companion .555 file (pixel data) is NOT loaded here.  Call
 * SgImageData.from555File(image, file555Path) to decode individual images.
 */
export class SgFile {
	/** All bitmap groups in the file, in file order, with unused slots omitted. */
	public readonly bitmaps: SgBitmap[];

	/**
	 * Flat list of all image records in file order (1-based).
	 * Index 0 is never populated (the dummy record is discarded during load).
	 * Each SgImage's `imageId` matches its position in this array.
	 */
	public readonly images: SgImage[];

	protected constructor(
		/** Absolute path to the .sg3 file */
		public readonly filename: string,
		public readonly header: SgHeader,
	){
		this.bitmaps = [];
		this.images = [];

		if(!SgFile.FileSizeMatchesVersion(this)) {
			throw new Error("Invalid file version or size");
		}
	}

	/** Parse an .sg3 file from disk.  The preferred public entry point. */
	public static fromPath(sg3Path: string): SgFile {
		const fileHandle = new FileHandle(sg3Path);
		return SgFile.FromFileHandle(fileHandle);
	}

	public static FromFileHandle(fileHandle: FileHandle): SgFile {
		const sgFile = new SgFile(
			fileHandle.filepath,
			SgHeader.FromFileHandle(fileHandle)
		);

		// Read only numBitmapRecords entries, but seek past the full fixed-size table
		// so the file position lands on the first image record regardless.
		for(let id = 0; id < sgFile.header.numBitmapRecords; id++) {
			sgFile.bitmaps.push(SgBitmap.FromFileHandle(fileHandle, id));
		}

		// Seek past the remainder of the bitmap table (unused slots)
		const pos = SgHeader.SG_HEADER_SIZE + (
			SgBitmapRecord.MaxRecordsInFile(sgFile) * SgBitmapRecord.SG_BITMAP_RECORD_SIZE
		);
		fileHandle.seek(pos, ESeekOrigin.SEEK_SET);

		const includeAlpha = sgFile.header.version >= 0xd6;

		// Record 0 is a dummy/null placeholder — parse and discard it to advance position
		SgImage.FromFileHandle(fileHandle, 0, includeAlpha);

		for(let i = 0; i < sgFile.header.numImageRecords; i++) {
			const sgImage = SgImage.FromFileHandle(fileHandle, i + 1, includeAlpha);

			// Wire up the invert chain for mirrored images.
			// invertOffset is a negative int32; add it to the current 0-based loop index
			// to get the index into sgFile.images (which is 0-based here, unlike imageId).
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

		// Special case: some files declare multiple bitmap slots but all images belong
		// to bitmap 0.  Trim the unused tail entries to avoid confusing callers.
		if(sgFile.bitmaps.length > 1 && sgFile.images.length === sgFile.bitmaps[0].images.length) {
			console.warn(`SG File has ${sgFile.bitmaps.length} bitmaps but only the first is in use`);
			sgFile.bitmaps.splice(1);
		}

		fileHandle.close();
		return sgFile;
	}

	/**
	 * Validate that the header's declared file size is consistent with the
	 * actual file on disk and the known version-specific size constants.
	 *
	 * SG2 (0xd3) files have two canonical sizes (normal vs enemy variant).
	 * SG3 (0xd5/0xd6) files declare their own actual size in the header.
	 * Returns false for unknown versions, or when the size does not match.
	 */
	public static FileSizeMatchesVersion(sgFile: SgFile): boolean {
		const { header, filename } = sgFile;

		if (header.version === 0xd3) {
			// SG2: two valid sizes — "normal" (74480) and "enemy" (522680)
			if (header.sgFilesize === 74480 || header.sgFilesize === 522680) {
				return true;
			}
		} else if (header.version === 0xd5 || header.version === 0xd6) {
			// SG3: the header's sgFilesize should equal the actual file size
			try {
				const stats    = fs.statSync(filename);
				const filesize = stats.size;
				// 74480 appears as a sentinel "no external 555" value in some SG3 headers
				if (header.sgFilesize === 74480 || filesize === header.sgFilesize) {
					return true;
				}
			} catch (error) {
				console.error("Error checking file size:", error);
			}
		}

		return false;
	}
}
