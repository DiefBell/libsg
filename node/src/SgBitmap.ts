import { SgBitmapRecord } from "./SgBitmapRecord";
import { type SgImage } from "./SgImage";
import { FileHandle } from "./util/FileHandle";

/**
 * A bitmap group: one entry in the .sg3 bitmap table, together with the list
 * of SgImage instances that belong to it.
 *
 * SgFile.FromFileHandle populates the `images` array after reading all image
 * records — each SgImage is pushed here when its bitmapId matches this bitmap's
 * index.
 */
export class SgBitmap {
	/** All image records that belong to this bitmap group, in file order. */
    images: SgImage[];

	protected constructor(
		/** 0-based index of this bitmap within SgFile.bitmaps */
		public readonly bitmapId: number,
		/** Absolute path to the .sg3 file (inherited from the FileHandle at parse time) */
		public readonly sgFilename: string,
		/** The parsed 200-byte bitmap record from the .sg3 file */
		public readonly record: SgBitmapRecord,
	){
		this.images = [];
	}

	public static FromFileHandle(file: FileHandle, id: number): SgBitmap {
		const bitmap = new SgBitmap(
			id,
			file.filepath,
			SgBitmapRecord.FromFileHandle(file),
		);
		return bitmap;
	}
}
