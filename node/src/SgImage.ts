import { SgBitmap } from "./SgBitmap";

enum EIsometric {
    TILE_WIDTH = 58,
    TILE_HEIGHT = 30,
    TILE_BYTES = 1800,
    LARGE_TILE_WIDTH = 78,
    LARGE_TILE_HEIGHT = 40,
    LARGE_TILE_BYTES = 3200
};

export class SgImageRecord {
    public readonly offset: number;
    public readonly length: number;
    public readonly uncompressed_length: number;
    public readonly invert_offset: number;
    public readonly width: number;
    public readonly height: number;
    public readonly type: number;
    public readonly flags: [string, string, string, string];
    public readonly bitmap_id: number;
    public readonly alpha_offset: number;
    public readonly alpha_length: number;
}

export class SgImage {
    public readonly record: SgImageRecord;
    public readonly workRecord: SgImageRecord;
    public readonly parent: SgBitmap;
    public readonly error: string | null;
    public readonly invert: boolean;
    public readonly imageId: number;
}
