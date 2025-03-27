import { SgBitmap } from "./SgBitmap";
import { SgImageRecord } from "./SgImageRecord";
import { FileHandle } from "./util/FileHandle";

enum EIsometric {
    TILE_WIDTH = 58,
    TILE_HEIGHT = 30,
    TILE_BYTES = 1800,
    LARGE_TILE_WIDTH = 78,
    LARGE_TILE_HEIGHT = 40,
    LARGE_TILE_BYTES = 3200
};

export class SgImage {
	public readonly error: string | null;
	public readonly invert: boolean;
	protected _workRecord: SgImageRecord;
	public get workRecord() { return this._workRecord; }

	protected constructor(
		protected _parent: SgBitmap | null,
		public readonly record: SgImageRecord,
		public readonly imageId: number,
	){
		this.error = "\0";
		this._workRecord = record;
		this.invert = this.record.invertOffset !== 0;
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

	public getBitmapId(): number {
		return this.workRecord.bitmapId;
	}

	public get parent(): SgBitmap | null { return this._parent; }
	public setParent(parent: SgBitmap): void {
		this._parent = parent;
	}

}


