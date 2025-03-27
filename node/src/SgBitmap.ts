import { SgBitmapRecord } from "./SgBitmapRecord";
import { type SgImage } from "./SgImage";
import { FileHandle } from "./util/FileHandle";

export class SgBitmap {
    images: SgImage[];

	protected constructor(
		public readonly bitmapId: number,
		public readonly sgFilename: string,
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
