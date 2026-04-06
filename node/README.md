# libsg

TypeScript library for reading and writing `.sg3` / `.555` art-asset files from
**Emperor: Rise of the Middle Kingdom** and related Impression/Sierra city-builder games
(Caesar 3, Pharaoh, Zeus).

---

## Installation

```sh
npm install libsg
# or
bun add libsg
```

Both CommonJS (`dist/cjs/`) and ES Module (`dist/esm/`) builds are included.

---

## Reading a file

```typescript
import { SgFile, SgImageData } from 'libsg'

// Parse the .sg3 index file
const sgFile = SgFile.fromPath('/path/to/Buildings.sg3')

console.log(`Version: 0x${sgFile.header.version.toString(16)}`)
console.log(`${sgFile.bitmaps.length} bitmaps, ${sgFile.images.length} images`)

// Walk every bitmap and its images
for (const [bi, bitmap] of sgFile.bitmaps.entries()) {
  console.log(`Bitmap ${bi}: ${bitmap.record.sgFilename}`)

  for (const [ii, img] of bitmap.images.entries()) {
    if (img.workRecord.length <= 0) continue  // empty slot

    const file555 = '/path/to/Buildings.555'
    const imgData = SgImageData.from555File(img, file555)

    // imgData.dataFlat is Uint8Array of RGBA bytes (4 bytes per pixel, R first)
    console.log(`  Image ${ii}: ${imgData.width}×${imgData.height}, type ${img.workRecord.type}`)
  }
}
```

---

## Writing / modifying a file

```typescript
import { SgFile, SgFileWriter } from 'libsg'

const sgFile = SgFile.fromPath('/path/to/Buildings.sg3')
const writer = new SgFileWriter(sgFile, '/path/to/Buildings.555')

// Replace image 3 in bitmap 0
// rgba must be width × height × 4 bytes, RGBA order (R at byte 0)
const rgba: Uint8Array = /* ... */
writer.replaceImage(0, 3, rgba, newWidth, newHeight)

// Remove image 7 in bitmap 1 (zeroes out its record, writes no .555 data)
writer.removeImage(1, 7)

// Write both output files
writer.write('/path/to/Buildings_modified.sg3', '/path/to/Buildings_modified.555')
```

---

## API reference

### `SgFile`

The top-level parsed representation of an `.sg3` file.

```typescript
class SgFile {
  readonly filename: string          // absolute path to the .sg3 file
  readonly header: SgHeader
  readonly bitmaps: SgBitmap[]       // populated bitmap groups
  readonly images: SgImage[]         // flat list, 1-based (index 0 is unused dummy)

  static fromPath(sg3Path: string): SgFile
}
```

---

### `SgHeader`

```typescript
class SgHeader {
  readonly version: number           // 0xd3=SG2, 0xd5=SG3, 0xd6=SG3+alpha
  readonly numImageRecords: number
  readonly numBitmapRecords: number
  readonly filesize555: number       // declared .555 size; updated by SgFileWriter
  // … (sgFilesize, totalFilesize, filesizeExternal, etc.)
}
```

---

### `SgBitmap`

```typescript
class SgBitmap {
  readonly bitmapId: number          // 0-based index in SgFile.bitmaps
  readonly record: SgBitmapRecord    // filename, dimensions, image count
  readonly images: SgImage[]         // images belonging to this group
}
```

---

### `SgBitmapRecord`

```typescript
class SgBitmapRecord {
  readonly sgFilename: string   // base name of the .555 file (no path, no extension)
  readonly comment: string
  readonly width: number
  readonly height: number
  readonly numImages: number
  readonly startIndex: number   // 1-based index of first image record
  readonly endIndex: number     // 1-based index of last image record (inclusive)
}
```

---

### `SgImage`

```typescript
class SgImage {
  readonly imageId: number           // 1-based index in SgFile.images
  readonly record: SgImageRecord     // this image's own on-disk record
  readonly workRecord: SgImageRecord // record to use for decoding (differs for mirrored images)
  readonly invert: boolean           // true if this is a horizontally-mirrored copy
  readonly parent: SgBitmap | null
}
```

**`record` vs `workRecord`**: for most images they are identical.  For *inverted* images
(`invert === true`), `workRecord` points to the source image's record (the one that has the
actual pixel data).  After decoding, the pixels are horizontally mirrored to produce this
image's appearance.  Always use `workRecord` when reading pixel metadata (width, height,
type, length).

---

### `SgImageRecord`

The low-level 64- or 72-byte record from the `.sg3` file.

```typescript
class SgImageRecord {
  readonly offset: number            // encoded .555 position (actual = offset - flags[0])
  readonly length: number            // pixel data byte length
  readonly uncompressedLength: number // isometric tile base byte length (0 for other types)
  readonly invertOffset: number      // signed; negative = mirror of image N positions back
  readonly width: number
  readonly height: number
  readonly type: number              // encoding type (see table below)
  readonly flags: Uint8Array         // [0]=extern offset delta, [3]=isometric grid size
  readonly bitmapId: number          // 0-based parent bitmap index
  readonly alphaOffset: number       // encoded .555 position of alpha mask (v0xd6+ only)
  readonly alphaLength: number       // alpha mask byte length (0 if none)
}
```

#### Image types

| Value(s)       | Name       | Encoding |
|----------------|------------|----------|
| 0, 1, 10, 12, 13 | Plain   | Row-major RGB555, 2 bytes/pixel |
| 30             | Isometric  | Tiled diamond base + sprite RLE overlay |
| 256, 257, 276  | Sprite     | RLE skip/run |

---

### `SgImageData`

Decoded pixel data for one image.

```typescript
class SgImageData {
  readonly width: number
  readonly height: number
  readonly data: Uint32Array         // one RGBA Uint32 per pixel, row-major
  readonly dataFlat: Uint8Array      // same data as flat [R,G,B,A, R,G,B,A, …] bytes

  static from555File(sgImage: SgImage, file555Path: string): SgImageData
}
```

`dataFlat` is a zero-copy `Uint8Array` view of `data`.  The byte layout is standard RGBA:
byte 0 = R, byte 1 = G, byte 2 = B, byte 3 = A.  This is directly compatible with
[sharp](https://sharp.pixelplumbing.com/)'s raw input format.

```typescript
// Example: convert to PNG using sharp
import sharp from 'sharp'

const imgData = SgImageData.from555File(img, file555)
const pngBuffer = await sharp(Buffer.from(imgData.dataFlat), {
  raw: { width: imgData.width, height: imgData.height, channels: 4 },
}).png().toBuffer()
```

---

### `SgFileWriter`

```typescript
class SgFileWriter {
  constructor(sgFile: SgFile, originalFile555Path: string)

  replaceImage(bitmapIndex: number, imageIndex: number,
               rgba: Uint8Array, width: number, height: number): void

  removeImage(bitmapIndex: number, imageIndex: number): void

  write(sg3OutPath: string, file555OutPath: string): void
}
```

`write()` performs two passes:
1. Builds the new `.555` file (re-encodes replaced images, raw-copies unchanged ones)
2. Patches the `.sg3` buffer in place (updates offsets, lengths, dimensions, type, alpha)

Notes:
- Replacing an isometric image (type 30) re-encodes it as sprite (type 256).
- Inverted images that are not replaced keep their `invertOffset` intact.
- Replacing an inverted image clears its `invertOffset` and stores new pixel data directly.
- Semi-transparent pixels in replacement images are preserved via an alpha mask blob.

---

### `SgImageEncoder` (low-level)

Rarely needed directly — `SgFileWriter` calls this internally.

```typescript
class SgImageEncoder {
  // Auto-select encoding based on original type; also produces alpha mask if needed
  static encode(rgba: Uint8Array, width: number, height: number, originalType: number):
    { data: Buffer, alpha: Buffer | null, type: number }

  // Uncompressed row-major RGB555
  static encodePlain(rgba: Uint8Array, width: number, height: number): Buffer

  // Sprite RLE (row-by-row; commands never cross row boundaries)
  static encodeSprite(rgba: Uint8Array, width: number, height: number): Buffer

  // Alpha mask blob; returns null if no partial-alpha pixels exist
  static encodeAlpha(rgba: Uint8Array, width: number, height: number): Buffer | null
}
```

`encode` type selection:
- Types 0, 1, 10, 12, 13 → `encodePlain`; type unchanged
- Types 256, 257, 276 → `encodeSprite`; type unchanged
- Type 30 (isometric) → `encodeSprite`; type becomes 256

---

## Building from source

```sh
cd libsg/node
bun run build    # emit CJS (dist/cjs/) and ESM (dist/esm/)
bun run watch    # watch mode (CJS only)
```

---

## Version compatibility

| Header version | File type | Max bitmaps | Alpha fields |
|----------------|-----------|-------------|--------------|
| 0xd3 | SG2 (Caesar 3, Pharaoh, Zeus) | 100 | No |
| 0xd5 | SG3 (Emperor, etc.) | 200 | No (64-byte records) |
| 0xd6 | SG3+ (Emperor with alpha) | 200 | Yes (72-byte records) |

---

## Further reading

See [AI.md](AI.md) for the complete binary format specification, including:
- Byte-level field tables for every record type
- The `flags[0]` offset adjustment gotcha
- The signed `invertOffset` gotcha (was a bug in an earlier version)
- The sprite RLE row-boundary encoder requirement
- Alpha mask encoding details
- Correspondence with the C reference implementation
