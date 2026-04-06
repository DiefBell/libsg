# libsg/node — Format Specification & Implementation Notes

This document is the authoritative reference for future AI sessions and contributors working
on this codebase.  It covers the binary file formats, implementation decisions, gotchas
discovered during development, and the correspondence between this TypeScript port and the
original C reference implementation in `libsg/c/`.

---

## 1. File pair overview

Each art asset is stored as two files with the same base name:

| File | Role |
|------|------|
| `<name>.sg3` (or `.sg2`) | Index file: header, bitmap records, image records |
| `<name>.555` | Pixel data: raw encoded pixels referenced by image records |

The `.sg3` file describes the structure; the `.555` file holds the actual pixels.
All multi-byte integers are **little-endian**.

---

## 2. .sg3 file layout

```
Offset    Size    Description
------    ----    -----------
0         680     SgHeader (only first 40 bytes are parsed; rest is unknown padding)
680       varies  Bitmap record table (fixed-size, always the maximum number of slots)
680 + T   varies  Image records (one dummy at index 0, then numImageRecords real records)
```

Where `T = MaxBitmapRecords × 200`:
- Version 0xd3 (SG2): `MaxBitmapRecords = 100`, so `T = 20000`
- Version 0xd5/0xd6 (SG3/SG3+): `MaxBitmapRecords = 200`, so `T = 40000`

The bitmap table is always fully allocated; unused slots are zeroed.

---

## 3. SgHeader (bytes 0–679)

Only the first 40 bytes are meaningful; bytes 40–679 are unknown/padding.

| Offset | Size | Type      | Field                        | Notes |
|--------|------|-----------|------------------------------|-------|
| 0      | 4    | UInt32LE  | sgFilesize                   | Declared .sg3 file size; for SG3 must match actual size |
| 4      | 4    | UInt32LE  | version                      | 0xd3=SG2, 0xd5=SG3, 0xd6=SG3+alpha |
| 8      | 4    | UInt32LE  | unknown1                     | Always 1 in practice |
| 12     | 4    | Int32LE   | maxImageRecords              | Upper bound on image count |
| 16     | 4    | Int32LE   | numImageRecords              | Actual number of image records (excludes dummy at index 0) |
| 20     | 4    | Int32LE   | numBitmapRecords             | Number of populated bitmap slots |
| 24     | 4    | Int32LE   | numBitmapRecordsWithoutSystem| Uncertain meaning; informational |
| 28     | 4    | UInt32LE  | totalFilesize                | sg3 + 555 + external combined |
| 32     | 4    | UInt32LE  | filesize555                  | Declared .555 file size — **patched by SgFileWriter** |
| 36     | 4    | UInt32LE  | filesizeExternal             | Usually 0 for single-asset files |
| 40     | 640  | —         | unknown/padding              | Skipped |

**Version validation**: For SG2, `sgFilesize` must be 74480 or 522680 (two canonical sizes).
For SG3, `sgFilesize` must equal the actual on-disk file size (or be the sentinel 74480).

---

## 4. Bitmap record (200 bytes each)

Immediately follows the header; the table has 100 (SG2) or 200 (SG3) fixed slots.

| Offset | Size | Type      | Field       | Notes |
|--------|------|-----------|-------------|-------|
| 0      | 65   | string    | sgFilename  | Null-terminated; base name of the .555 file (no path, no ext) |
| 65     | 51   | string    | comment     | Null-terminated; often empty |
| 116    | 4    | UInt32LE  | width       | Pixel width of the bitmap group |
| 120    | 4    | UInt32LE  | height      | Pixel height of the bitmap group |
| 124    | 4    | UInt32LE  | numImages   | Number of images in this group |
| 128    | 4    | UInt32LE  | startIndex  | 1-based index of the first image record |
| 132    | 4    | UInt32LE  | endIndex    | 1-based index of the last image record |
| 136    | 64   | —         | unknown     | See below |

**Unknown 64 bytes breakdown** (bytes 136–199):
- +0  4 bytes: UInt32 (purpose unclear; sometimes between startIndex and endIndex)
- +4  16 bytes: 4 × Int32 with unknown purpose
- +20  8 bytes: 2 × Int32 "real" width/height (sometimes set)
- +28 12 bytes: 3 × Int32; if any is non-zero this is an "internal" image group
- +40 24 bytes: miscellaneous, mostly zero

---

## 5. Image record (64 or 72 bytes each)

Begins immediately after the bitmap table.  Record 0 is a dummy placeholder with all fields
zero; real image records start at index 1.

Record size:
- **64 bytes** for version 0xd5 (SG3 without alpha)
- **72 bytes** for version 0xd6 (SG3 with alpha — appends 8 bytes for alpha fields)

| Offset | Size | Type      | Field              | Notes |
|--------|------|-----------|--------------------|-------|
| 0      | 4    | UInt32LE  | offset             | Encoded .555 position — see section 6 |
| 4      | 4    | UInt32LE  | length             | Pixel data byte length in .555 |
| 8      | 4    | UInt32LE  | uncompressedLength | Tile base length (isometric only; 0 otherwise) |
| 12     | 4    | —         | padding            | Always zero |
| 16     | 4    | **Int32LE** | invertOffset     | **Signed** — negative = mirror; see section 7 |
| 20     | 2    | UInt16LE  | width              | |
| 22     | 2    | UInt16LE  | height             | |
| 24     | 26   | —         | unknown            | First 4 bytes are two UInt16 fields; rest mostly zero |
| 50     | 2    | UInt16LE  | type               | Image encoding type; see section 8 |
| 52     | 4    | bytes     | flags[0..3]        | See section 6 and 5 (isometric) |
| 56     | 1    | UInt8     | bitmapId           | 0-based index into the bitmap table |
| 57     | 7    | —         | padding            | 3 unknown + 4 zero |
| 64     | 4    | UInt32LE  | alphaOffset        | (v0xd6+ only) Encoded .555 position of alpha mask |
| 68     | 4    | UInt32LE  | alphaLength        | (v0xd6+ only) Alpha mask byte length |

---

## 6. CRITICAL: The flags[0] offset adjustment

**This is the most counterintuitive part of the format.**

The game reads pixel data from: `record.offset - record.flags[0]`

`flags[0]` is called the "extern" flag in the C source (`sg_get_image_extern`).  It acts as a
small delta that shifts the read position.  For most images `flags[0]` is 0, but some images
have non-zero values.

### When reading from .555
```
readPosition = record.offset - record.flags[0]
```

### When writing to .sg3 (SgFileWriter)
```
record.offset = absolute_555_position + original_flags[0]
```
Leave `flags[0]` unchanged in the buffer.  If you set `record.offset = absolute_555_position`
without adding `flags[0]`, the game will subtract `flags[0]` and read from the wrong position.

This invariant applies to both the image offset and the alpha offset field.

---

## 7. CRITICAL: invertOffset is a signed Int32

`invertOffset` is declared `int32_t` in the C source.

When negative, this image has no pixel data of its own.  The source image is at index
`(thisImageId - 1) + invertOffset` in the flat images array (using the 0-based loop counter,
not the 1-based imageId).  The source image's pixels are decoded and then horizontally
mirrored to produce this image's appearance.

**Bug that existed in the Node port:** `invertOffset` was read with `readUInt32Le`, causing
negative values (e.g. -1 = 0xffffffff as uint32) to appear as ~4 billion.  The sign check
`invertOffset < 0` never fired, `setInvert()` was never called, and inverted frames used the
wrong workRecord — producing corrupted animation frames in-game.

**Fix:** use `readInt32Le` in `SgImageRecord.FromFileHandle`.

### CRITICAL: mirrorResult off-by-one

`SgImageData.mirrorResult` horizontally mirrors the pixel buffer by swapping pixel `(x, y)`
with pixel `(width-1-x, y)`.  In flat row-major indices:

```
p1 = y * width + x
p2 = y * width + (width - 1 - x)   ← correct
   = (y + 1) * width - 1 - x       ← equivalent, avoids a multiply
```

An easy mistake is to write `p2 = (y + 1) * width - x` (missing the `- 1`).  For `x = 0`
this gives `p2 = (y + 1) * width`, which is the first pixel of the **next row** rather than
the last pixel of the current row.  The swap then rotates the first column of pixels between
adjacent rows instead of reflecting them, producing completely scrambled pixel data.

**Why this was masked:** Before the `invertOffset` fix, inverted images had `workRecord.length
= 0` (they carry no pixel data of their own).  `from555File` threw "No image data available"
for them, the caller's `try/catch` skipped them, and `mirrorResult` was never reached.  After
fixing `invertOffset`, inverted images decode successfully, `mirrorResult` is called, and the
garbled result is re-encoded into the new `.555`.  The non-inverted frames look correct; the
inverted frames are scrambled — producing flickering "static" in the game as the animation
cycles through both.

---

## 8. Image encoding types

| Type(s)        | Name       | Encoding |
|----------------|------------|----------|
| 0, 1, 10, 12, 13 | Plain   | Row-major array of UInt16LE RGB555; `width × height × 2` bytes total |
| 30             | Isometric  | Uncompressed tile base + sprite RLE overlay (see section 10) |
| 256, 257, 276  | Sprite     | Sprite RLE (skip/run encoding; see section 9) |

---

## 9. RGB555 pixel format

Each pixel is a 16-bit unsigned integer in little-endian byte order:

```
Bit 15: unused (always 0)
Bits 14-10: Red   (5 bits, 0–31)
Bits  9-5:  Green (5 bits, 0–31)
Bits  4-0:  Blue  (5 bits, 0–31)
```

Magic transparent value: `0xf81f` — when the decoder sees this value it skips the pixel
(leaves it at the default transparent 0x00000000).

### 5-bit to 8-bit channel expansion
Each 5-bit channel is expanded to 8 bits using:
```
expanded = (value << 3) | (value >> 2)
```
This ensures 0x1f (31) maps to 0xff (255) rather than 0xf8 (248).

### Channel layout in output Uint32 (little-endian)
```
byte 0 = Red   (bits  7-0 )   rMask = 0x000000ff
byte 1 = Green (bits 15-8 )   gMask = 0x0000ff00
byte 2 = Blue  (bits 23-16)   bMask = 0x00ff0000
byte 3 = Alpha (bits 31-24)   aMask = 0xff000000
```

This is **standard RGBA** byte order, compatible with `sharp`'s raw RGBA input.

The C reference decoder uses Qt ARGB32 format (`rMask=0x000000ff, bMask=0x00ff0000` with
LE memory layout), which happens to be the same RGBA byte order — the names differ but the
bytes in memory are identical.

### Encoding back to RGB555 (SgImageEncoder)
```typescript
function rgbaTo555(r, g, b, a): number {
  if (a === 0) return 0xf81f   // fully transparent → magic value
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
}
```
Semi-transparent pixels (`0 < a < 255`) are encoded as opaque RGB555; their alpha is
carried separately in the alpha mask blob (see section 12).

---

## 10. Sprite RLE encoding (types 256, 257, 276 and the isometric overlay)

### Decoder (SgImageData.writeTransparentImage)
Commands are read sequentially from the data buffer:
```
byte 0xFF, byte N  → skip N pixels (leave transparent)
byte C (1–254)     → C opaque pixels follow; each is 2 bytes of UInt16LE RGB555
```
The cursor is a flat scan over the entire pixel grid.  When `x >= width`, advance `y` and
reset `x = 0`.  The decoder allows commands to cross row boundaries.

### Encoder (SgImageEncoder.encodeSprite)
**The encoder MUST NOT emit commands that cross row boundaries.**

The game's renderer does not wrap `x` within a single command; it only advances the row after
a complete run or skip.  If a run starts near the end of one row and extends into the next,
the game will paint the wrapped pixels at the wrong x position on the wrong row — causing the
classic horizontal-bar glitch where the top and bottom of each sprite are misaligned.

The encoder processes one row at a time, always resetting to the start of a new row when
`x` reaches `width`.

---

## 11. Isometric image encoding (type 30)

The .555 data for an isometric image has two back-to-back sections:
1. **Tile base** (bytes 0 to `uncompressedLength-1`): tightly packed diamond tiles
2. **Sprite overlay** (bytes `uncompressedLength` to `length-1`): sprite RLE for buildings etc.

`flags[3]` stores the grid size (number of tiles per side of the diamond grid).  When zero,
it is inferred from `imageHeight / TILE_HEIGHT`.

**Tile disambiguation edge case**: a 4×4 regular grid and a 3×3 large grid both have a height
of 120 px.  Regular tiles (30 px) take precedence over large tiles (40 px).

### Tile dimensions
| Variant | Width | Height | Bytes/tile |
|---------|-------|--------|------------|
| Regular | 58    | 30     | 1800       |
| Large   | 78    | 40     | 3200       |

Each tile is stored as packed diamond pixels (not a rectangular bounding box).  The
`writeIsometricTile` function reconstructs the diamond shape from the compact byte stream.

**Note on `ISOMETRIC_LARGE_TILE_BYTES`**: An earlier version of this code had this value as
`320` (missing a zero).  The correct value is `3200`.  This would cause large-tile isometric
images to decode garbage — fixed in the current version.

---

## 12. Alpha mask encoding (version 0xd6+)

The alpha mask immediately follows the pixel data in the .555 file:
- Stored at byte offset `alphaOffset - flags[0]` in the .555 file
- Has the same skip/run RLE structure as sprite data, but run bytes are **5-bit alpha values**

```
byte 0xFF, byte N   → skip N pixels (alpha unchanged)
byte C (1–254)      → C alpha bytes follow; each stores 5-bit alpha in its low 5 bits
```

The cursor is a **flat scan over ALL pixels** (both transparent and opaque), not just a single
row.  Unlike the sprite RLE, the alpha mask encoder may allow commands to cross row boundaries
because the alpha decoder in the C code also wraps `x` across rows.

Only pixels with `0 < alpha < 255` are encoded in run bytes.  Fully-opaque (255) and
fully-transparent (0) pixels are covered by skip commands.

### 5-bit alpha expansion
```typescript
expanded = ((value & 0x1f) << 3) | ((value & 0x1c) >> 2)  // same as RGB channels
```

### Alpha offset in the .sg3 record
Same flags[0] adjustment applies:
```
record.alphaOffset = absolute_555_alpha_position + flags[0]
```

---

## 13. The workRecord / record distinction

Every `SgImage` has two record references:
- `record` — the on-disk record for this specific image
- `workRecord` — the record whose pixel data to use (usually the same as `record`)

For inverted images (`invertOffset < 0`), `workRecord` is set to the **source image's
record** by `SgImage.setInvert()`.  The source image's width, height, offset, length, and
type are all used for decoding.  After decoding, the pixels are horizontally mirrored.

**SgFileWriter** must use `sgImage.record` (not `workRecord`) for the .sg3 patch because it
is writing to the inverted image's own record slot.  It uses `sgImage.workRecord.type` to
decide the encoding format for replaced images.

---

## 14. SgFileWriter internals

**Pass 1** — Build the new .555 file:
- Unchanged inverted images: contribute no bytes to the new .555 (their data lives in the
  source image's slot); their `writeInfo.offset` is set to 0 (the record's invertOffset
  field is preserved unmodified).
- Unchanged images with data: raw-copy from the original .555 at `(offset - flags[0])` for
  `(length + alphaLength)` bytes.
- Replaced images: re-encode with `SgImageEncoder.encode`, then append alpha blob if any.
- Removed images: no bytes written; all fields zeroed in the .sg3 patch.

**Pass 2** — Patch the .sg3 buffer:
- `imageRecordBase = SG_HEADER_SIZE + MaxBitmapRecords × 200`
- Image record position: `imageRecordBase + imageId × recordSize`  (`imageId` is 1-based)
- For every image: update `F_OFFSET = newAbsolutePosition + flags[0]`
- For modified images: update length, dimensions, type, alpha fields
- For unchanged images with alpha: update `F_ALPHA_OFFSET` to the new position

**F_ALPHA_OFFSET formula** (when alphaLength > 0):
```
alphaOffset = absoluteImageOffset + length + flags[0]
```
Alpha data sits immediately after pixel data in the new .555; `flags[0]` adjustment applies.

---

## 15. Correspondence with the C reference

| C function           | TypeScript equivalent |
|----------------------|-----------------------|
| `sg_load_image`      | `SgFile.FromFileHandle` |
| `sg_image_load_555`  | `SgImageData.from555File` |
| `write_plain_image`  | `SgImageData.loadPlainImage` |
| `write_isometric_image` | `SgImageData.loadIsometricImage` |
| `write_transparent_image` | `SgImageData.writeTransparentImage` |
| `load_alpha_mask`    | `SgImageData.loadAlphaMask` |
| `mirror_result`      | `SgImageData.mirrorResult` |
| `set_555_pixel`      | `SgImageData.set555Pixel` |
| `set_alpha_pixel`    | `SgImageData.setAlphaPixel` |
| `sg_get_image_extern`| `record.flags[0]` |

Key difference: the C code outputs Qt ARGB32 (`uint32` with `rMask=0x000000ff` in LE memory).
The TypeScript decoder outputs the same byte layout (RGBA) but names it explicitly.  `sharp`
expects this layout for raw RGBA input.

---

## 16. Known edge cases and quirks

1. **C3 EOF truncation**: Some Caesar 3 .555 files end 4 bytes short of the last image's
   declared length.  `fillBufferFromFileHandle` zero-pads the missing bytes rather than
   throwing.

2. **Single-bitmap multi-slot files**: Some .sg3 files declare many bitmap slots but all
   images actually belong to bitmap 0.  `SgFile.FromFileHandle` detects this and trims the
   extra empty bitmaps.

3. **SG3 filesize sentinel 74480**: Some SG3 headers declare `sgFilesize = 74480` (the SG2
   normal size) even though the file is larger.  This is treated as a valid sentinel meaning
   "no external .555 is required" and the actual file size is not checked.

4. **Image type 30 re-encoding**: `SgImageEncoder.encode` converts isometric images to sprite
   (type 256) when replacing them.  Full isometric tile re-encoding is not implemented.  The
   game will treat the re-encoded image as a sprite, which is visually equivalent for simple
   replacement use cases.

5. **bitmapId from workRecord**: `SgImage.getBitmapId()` reads from `workRecord.bitmapId`.
   For inverted images this is the source image's bitmapId — which is correct because inverted
   images belong to the same bitmap as their source.

6. **flags[3] tile size**: When `flags[3]` is 0 the grid size is inferred from the image
   height.  Prefer regular tile height (30) over large (40) when both divide evenly — the
   ambiguity arises at `height = 120` (4×4 regular vs 3×3 large).

7. **mirrorResult off-by-one (fixed)**: See section 7 for a detailed write-up.  The correct
   p2 formula is `(y + 1) * width - 1 - x`.  The wrong formula `(y + 1) * width - x` was
   harmless before the `invertOffset` fix but became a critical bug afterwards.

8. **ISOMETRIC_LARGE_TILE_BYTES was 320 (fixed)**: An earlier version had
   `ISOMETRIC_LARGE_TILE_BYTES = 320` instead of the correct `3200`.  This caused large-tile
   Emperor isometric images to decode/encode garbage.  The correct value is 3200 bytes per tile
   (78 × 40 px diamond, packed).
