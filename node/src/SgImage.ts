import { SgBitmap } from "./SgBitmap";
import { SgImageRecord } from "./SgImageRecord";
import { FileHandle } from "./util/FileHandle";

// Isometric tile constants — defined here for historical reasons alongside the
// per-image enum that was present in the original C code.  The canonical values
// used by the decoder live in SgImageData.
enum EIsometric {
    TILE_WIDTH        = 58,
    TILE_HEIGHT       = 30,
    TILE_BYTES        = 1800,
    LARGE_TILE_WIDTH  = 78,
    LARGE_TILE_HEIGHT = 40,
    LARGE_TILE_BYTES  = 3200
};

/**
 * One image record loaded from the .sg3 file.
 *
 * The key design point is the `workRecord` / `record` distinction:
 *
 *   record      — the SgImageRecord as it appears on disk for this image.
 *   workRecord  — the record that describes the pixel data to decode.
 *
 * For normal images these are the same object.  For "inverted" images
 * (record.invertOffset < 0) the pixel data is stored under a different image
 * (the source of the mirror), so setInvert() is called to point workRecord at
 * the source image's record.  After decoding the source's pixels, SgImageData
 * applies a horizontal mirror to produce this image's final appearance.
 *
 * The invert flag is true when invertOffset !== 0.  The C reference uses
 * `invertOffset < 0` since the field is a signed int32 and only negative values
 * appear in real files; `!== 0` is equivalent in practice.
 */
export class SgImage {
	public readonly error: string | null;

	/**
	 * True if this image is a horizontally-mirrored copy of another image.
	 * When true, `workRecord` points to the source image's record, and the
	 * decoded pixel buffer is flipped horizontally after decoding.
	 */
	public readonly invert: boolean;

	protected _workRecord: SgImageRecord;

	/** The record used for decoding: own record unless this is an inverted image. */
	public get workRecord() { return this._workRecord; }

	protected constructor(
		protected _parent: SgBitmap | null,
		/** The image's own on-disk record (offset, length, dimensions, type, flags …) */
		public readonly record: SgImageRecord,
		/** 1-based index in the flat SgFile.images array (0 is the dummy record) */
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

	/**
	 * Wire up the invert chain: make this image's workRecord point at the source
	 * image's record.  Called by SgFile.FromFileHandle when invertOffset < 0.
	 *
	 * @param source  The image whose pixel data this image mirrors.
	 */
	public setInvert(source: SgImage): void {
		this._workRecord = source.record;
	}

	/** The bitmapId that determines which SgBitmap this image belongs to. */
	public getBitmapId(): number {
		return this.workRecord.bitmapId;
	}

	public get parent(): SgBitmap | null { return this._parent; }
	public setParent(parent: SgBitmap): void {
		this._parent = parent;
	}
}


