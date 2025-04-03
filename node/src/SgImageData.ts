import { SgImage } from "./SgImage";
import { FileHandle } from "./util/FileHandle";
import { fillBufferFromFileHandle } from "./util/fillBufferFromFileHandle";


export class SgImageData
{
    public static readonly ISOMETRIC_TILE_WIDTH = 58;
    public static readonly ISOMETRIC_TILE_HEIGHT = 30;
    public static readonly ISOMETRIC_TILE_BYTES = 1800;
    public static readonly ISOMETRIC_LARGE_TILE_WIDTH = 78;
    public static readonly ISOMETRIC_LARGE_TILE_HEIGHT = 40;
    public static readonly ISOMETRIC_LARGE_TILE_BYTES = 320;
	/**
	 * A flat array of numbers where each group of four is a single RGBA pixel.
	 */
	public get dataFlat(): Uint8Array {
		return new Uint8Array(this.data.buffer);
	}

	constructor(
		public readonly width: number,
		public readonly height: number,
	
		public readonly rMask: number,
		public readonly gMask: number,
		public readonly bMask: number,
		public readonly aMask: number,
	
		public readonly data: Uint32Array
	)
	{
	}

	public static from555File(
		sgImage: SgImage,
		filename555: string
	): SgImageData {
		if (!sgImage.parent)
		{
			throw new Error("Image has no bitmap parent");
		}
		if (sgImage.workRecord.width <= 0 || sgImage.workRecord.height <= 0)
		{
			throw new Error("Invalid image dimensions");
		}
		if (sgImage.workRecord.length <= 0)
		{
			throw new Error("No image data available");
		}

		const fileHandle555 = new FileHandle(filename555, "r");
		const buffer = fillBufferFromFileHandle(sgImage, fileHandle555);
		if (!buffer)
		{
			throw new Error("Failed to read image data");
		}

		const pixels = new Uint32Array(
			sgImage.workRecord.width * sgImage.workRecord.height
		).fill(0);

		switch(sgImage.workRecord.type)
		{
			case 0:
			case 1:
			case 10:
			case 12:
			case 13:
				this.loadPlainImage(sgImage, pixels, buffer);
				break;
		
			case 30:
				this.loadIsometricImage(sgImage, pixels, buffer);
				break;
		
			case 256:
			case 257:
			case 276:
				this.loadSpriteImage(sgImage, pixels, buffer);
				break;
		
			default:
				throw new Error(`Unknown image type: ${sgImage.workRecord.type}`)
		}

		if (sgImage.workRecord.alphaLength) {
			const alphaBuffer = buffer.subarray(sgImage.workRecord.length);
			this.loadAlphaMask(sgImage, pixels, alphaBuffer);
		}

		if(sgImage.invert) this.mirrorResult(sgImage, pixels);

		const width = sgImage.workRecord.width;
		const height = sgImage.workRecord.height;
		const rMask = 0x000000ff;
		const gMask = 0x0000ff00;
		const bMask = 0x00ff0000;
		const aMask = 0xff000000;

		return new SgImageData(
			width, height,
			rMask, gMask, bMask, aMask,
			pixels
		);
	}

	private static loadPlainImage(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		if(sgImage.workRecord.height * sgImage.workRecord.width * 2 !== sgImage.workRecord.length) {
			throw new Error("Image data length does not match image size");
		}

		for(let y = 0, i = 0; y < sgImage.workRecord.height; y++)
		{
			for(let x = 0; x < sgImage.workRecord.width; x++, i += 2)
			{
				this.set555Pixel(sgImage, pixels, x, y, buffer[i] | (buffer[i+1] << 8));
			}
		}
	}

	/**
	 * Fills the pixel array with the image data from the buffer.
	 * The image data is in 555 format, which means that each pixel is represented by 16 bits (2 bytes).
	 * The above sentence was written by Co-Pilot - idk if it's correct.
	 * @param sgImage
	 * @param pixels 
	 * @param buffer 
	 */
	private static loadIsometricImage(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		this.writeIsometricBase(sgImage, pixels, buffer);
		this.writeTransparentImage(
			sgImage,
			pixels,
			buffer.subarray(sgImage.workRecord.uncompressedLength),
			sgImage.workRecord.length - sgImage.workRecord.uncompressedLength);
	}

	private static loadSpriteImage(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		this.writeTransparentImage(sgImage, pixels, buffer, sgImage.workRecord.length);
	}

	private static loadAlphaMask(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		const width = sgImage.workRecord.width;
		const length = sgImage.workRecord.alphaLength;

		for(let i = 0, x = 0, y = 0; i < length; )
		{
			const c = buffer[i++];
			if(c === 255)
			{
				/* The next byte is the number of pixels to skip */
				x += buffer[i++];
				while (x >= width) {
					y++;
					x -= width;
				}
			}
			else
			{
				/* `c' is the number of image data bytes */
				for (let j = 0; j < c; j++, i++)
				{
					this.setAlphaPixel(sgImage, pixels, x, y, buffer[i]);
					x++;
					if (x >= width) {
						y++;
						x = 0;
					}
				}
			}
		}
	}

	private static writeIsometricBase(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer): void
	{
		const width = sgImage.workRecord.width;
		const height = (width + 2) / 2;
		const heightOffset = sgImage.workRecord.height - height;

		let size = sgImage.workRecord.flags[3];
		if(size === 0)
		{
			/* Derive the tile size from the height (more regular than width) */
			/* Note that this causes a problem with 4x4 regular vs 3x3 large: */
			/* 4 * 30 = 120; 3 * 40 = 120 -- give precedence to regular */
			if (height % SgImageData.ISOMETRIC_TILE_HEIGHT == 0) {
				size = height / SgImageData.ISOMETRIC_TILE_HEIGHT;
			} else if (height % SgImageData.ISOMETRIC_LARGE_TILE_HEIGHT == 0) {
				size = height / SgImageData.ISOMETRIC_LARGE_TILE_HEIGHT;
			}
		}

		let tileBytes: number,
			tileHeight: number,
			tileWidth: number;
		/* Determine whether we should use the regular or large (emperor) tiles */
		if (SgImageData.ISOMETRIC_TILE_HEIGHT * size == height) {
			/* Regular tile */
			tileBytes  = SgImageData.ISOMETRIC_TILE_BYTES;
			tileHeight = SgImageData.ISOMETRIC_TILE_HEIGHT;
			tileWidth  = SgImageData.ISOMETRIC_TILE_WIDTH;
		} else if (SgImageData.ISOMETRIC_LARGE_TILE_HEIGHT * size == height) {
			/* Large (emperor) tile */
			tileBytes  = SgImageData.ISOMETRIC_LARGE_TILE_BYTES;
			tileHeight = SgImageData.ISOMETRIC_LARGE_TILE_HEIGHT;
			tileWidth  = SgImageData.ISOMETRIC_LARGE_TILE_WIDTH;
		} else {
			throw new Error("Unknown tile size");
		}

		/* Check if buffer length is enough: (width + 2) * height / 2 * 2bpp */
		if ((width + 2) * height != sgImage.workRecord.uncompressedLength) {
			throw new Error("Data length doesn't match footprint size");
			return;
		}
	
		for (
			let i = 0, y = 0, yOffset = heightOffset;
			y < (size + (size - 1));
			y++
		) {
			let xOffset = (y < size ? (size - y - 1) : (y - size + 1)) * tileHeight;

			for (
				let x = 0;
				x < (y < size ? y + 1 : 2 * size - y - 1);
				x++, i++
			) {
				this.writeIsometricTile(
					sgImage,
					pixels,
					buffer.subarray(i * tileBytes, (i + 1) * tileBytes),
					xOffset,
					yOffset,
					tileWidth,
					tileHeight
				);
				xOffset += tileWidth + 2;
			}
			yOffset += tileHeight / 2;
		}
	}

	private static writeIsometricTile(
		sgImage: SgImage,
		pixels: Uint32Array,
		buffer: Buffer,
		offsetX: number,
		offsetY: number,
		tileWidth: number,
		tileHeight: number
	): void
	{
		const halfHeight = Math.floor(tileHeight / 2);

		let i = 0;
		for(let y = 0; y < halfHeight; y++)
		{
			const start = tileHeight - 2 * (y + 1);
			const end = tileWidth - start;

			for(let x = start; x < end; x++, i += 2)
			{
				this.set555Pixel(
					sgImage,
					pixels,
					offsetX + x,
					offsetY + y,
					(buffer[i+1] << 8) | buffer[i]
				);
			}
		}

		for(let y = halfHeight; y < tileHeight; y++)
		{
			const start = (2 * y) - halfHeight;
			const end = tileWidth - start;

			for(let x = start; x < end; x++, i += 2)
			{
				this.set555Pixel(
					sgImage,
					pixels,
					offsetX + x,
					offsetY + y,
					(buffer[i+1] << 8) | buffer[i]
				);
			}
		}
	}

	private static writeTransparentImage(sgImage: SgImage, pixels: Uint32Array, buffer: Buffer, length: number): void
	{
		let i = 0;
		let x = 0, y = 0;
		const width = sgImage.workRecord.width;
	
		while (i < length) {
			const c = buffer[i++];
			if (c === 255) {
				// The next byte is the number of pixels to skip
				x += buffer[i++];
				while (x >= width) {
					y++;
					x -= width;
				}
			} else {
				// `c` is the number of image data bytes
				for (let j = 0; j < c; j++, i += 2) {
					this.set555Pixel(sgImage, pixels, x, y, buffer[i] | (buffer[i + 1] << 8));
					x++;
					if (x >= width) {
						y++;
						x = 0;
					}
				}
			}
		}
	}

	private static set555Pixel(sgImage: SgImage, pixels: Uint32Array, x: number, y: number, color: number): void
	{
		if(color === 0xf81f) return;

		let rgb = 0xff000000;

		// Red: bits 11-15, should go to bits 17-24
		rgb |= ((color & 0x7c00) << 9) | ((color & 0x7000) << 4);
	
		// Green: bits 6-10, should go to bits 9-16
		rgb |= ((color & 0x3e0) << 6) | ((color & 0x300));
	
		// Blue: bits 1-5, should go to bits 1-8
		rgb |= ((color & 0x1f) << 3) | ((color & 0x1c) >> 2);
	
		pixels[y * sgImage.workRecord.width + x] = rgb;
	}

	private static setAlphaPixel(sgImage: SgImage, pixels: Uint32Array, x: number, y: number, color: number): void
	{

		/* Only the first five bits of the alpha channel are used */
		const alpha = ((color & 0x1f) << 3) | ((color & 0x1c) >> 2);

		const p = y * sgImage.workRecord.width + x;
		pixels[p] = (pixels[p] & 0x00ffffff) | (alpha << 24);
	}

	private static mirrorResult(sgImage: SgImage, pixels: Uint32Array): void {
		for(let x = 0; x < (sgImage.workRecord.width - 1) / 2; x++)
		{
			for(let y = 0; y < sgImage.workRecord.height; y++)
			{
				const p1 = y * sgImage.workRecord.width + x;
				const p2 = ((y + 1) * sgImage.workRecord.width) - x;

				const tmp = pixels[p1];
				pixels[p1] = pixels[p2];
				pixels[p2] = tmp;
			}
		}
	}
}
