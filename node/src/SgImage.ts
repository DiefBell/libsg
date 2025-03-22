import { SgBitmap } from "./SgBitmap";

enum EIsometric {
    TILE_WIDTH = 58,
    TILE_HEIGHT = 30,
    TILE_BYTES = 1800,
    LARGE_TILE_WIDTH = 78,
    LARGE_TILE_HEIGHT = 40,
    LARGE_TILE_BYTES = 3200
};

export interface ISgImageRecord {
    offset: number;
    length: number;
    uncompressed_length: number;
    invert_offset: number;
    width: number;
    height: number;
    type: number;
    flags: [string, string, string, string];
    bitmap_id: number;
    alpha_offset: number;
    alpha_length: number;
}

export interface ISgImage {
    record: ISgImageRecord;
    workRecord: ISgImageRecord;
    parent: SgBitmap;
    error: string | null;
    invert: boolean;
    imageId: number;
}

export class SgImage
{
	
}
