import * as fs from 'node:fs'
import { SgBitmapRecord } from './SgBitmapRecord'
import { SgFile } from './SgFile'
import { SgHeader } from './SgHeader'
import { SgImageEncoder } from './SgImageEncoder'

type Modification =
  | { op: 'replace'; rgba: Uint8Array; width: number; height: number }
  | { op: 'remove' }

// SgImageRecord field offsets (within a single record buffer)
const F_OFFSET             = 0   // UInt32LE: byte offset into .555 file (+flags[0])
const F_LENGTH             = 4   // UInt32LE: image data length in .555
const F_UNCOMPRESSED_LEN   = 8   // UInt32LE: uncompressed base length (isometric only)
// bytes 12–15: padding (zero)
const F_INVERT_OFFSET      = 16  // Int32LE: relative index of mirror source (negative)
const F_WIDTH              = 20  // UInt16LE
const F_HEIGHT             = 22  // UInt16LE
// bytes 24–49: unknown (26 bytes)
const F_TYPE               = 50  // UInt16LE
const F_FLAGS              = 52  // 4 bytes: flags[0..3]
const F_BITMAP_ID          = 56  // UInt8
// bytes 57–63: padding (7 bytes)
const F_ALPHA_OFFSET       = 64  // UInt32LE (version 0xd6+ only)
const F_ALPHA_LENGTH       = 68  // UInt32LE (version 0xd6+ only)

// SgHeader field offsets (within the 680-byte header)
const H_FILESIZE_555       = 32  // UInt32LE

const RECORD_SIZE_V5 = 64  // version 0xd5
const RECORD_SIZE_V6 = 72  // version 0xd6 (adds alpha fields)

interface ImageWriteInfo {
  /** Absolute byte offset in the new .555 file (0 = no data) */
  offset: number
  /** Encoded data byte length (0 = empty/removed) */
  length: number
  /** Alpha data byte length (0 = no alpha, or modified image) */
  alphaLength: number
  /** True when the image was replaced or removed (fields beyond offset need patching) */
  modified: boolean
  /** New width (only meaningful when modified=true) */
  width: number
  /** New height (only meaningful when modified=true) */
  height: number
  /** New image type (only meaningful when modified=true) */
  type: number
  /** Clear invertOffset to 0 in the record (used when a formerly-inverted image is replaced) */
  clearInvert: boolean
}

/**
 * Mutates a loaded SgFile by replacing or removing images, then writes the result
 * as a new pair of .sg3 and .555 files.
 *
 * Usage:
 *   const writer = new SgFileWriter(sgFile, '/path/to/original.555')
 *   writer.replaceImage(0, 3, rgbaPixels, 64, 64)
 *   writer.removeImage(0, 7)
 *   writer.write('/path/to/out.sg3', '/path/to/out.555')
 *
 * Notes:
 * - Replacing an isometric image (type 30) re-encodes it as sprite (type 256).
 *   Full isometric tiled re-encoding is not yet implemented.
 * - Inverted images (those whose record has invertOffset != 0) that are NOT
 *   replaced keep their invertOffset chain intact; the chain remains valid as long
 *   as no images are added or removed.
 * - Replacing an inverted image clears its invertOffset and stores new data directly.
 */
export class SgFileWriter {
  private readonly modifications = new Map<string, Modification>()

  constructor(
    private readonly sgFile: SgFile,
    private readonly originalFile555Path: string
  ) {}

  /**
   * Schedule an image replacement.  The new RGBA buffer must be width × height × 4 bytes
   * (R, G, B, A in that byte order, one byte per channel).
   */
  replaceImage(
    bitmapIndex: number,
    imageIndex: number,
    rgba: Uint8Array,
    width: number,
    height: number
  ): void {
    this.modifications.set(`${bitmapIndex}:${imageIndex}`, { op: 'replace', rgba, width, height })
  }

  /** Schedule an image removal.  The image record will be zeroed out (length = 0). */
  removeImage(bitmapIndex: number, imageIndex: number): void {
    this.modifications.set(`${bitmapIndex}:${imageIndex}`, { op: 'remove' })
  }

  /**
   * Write the modified sg3 and 555 files to disk.
   *
   * The .sg3 file is patched in-place from the original (all unknown/padding bytes
   * are preserved).  The .555 file is rebuilt from scratch with images at new sequential
   * offsets, then all image records in the .sg3 are updated to match.
   */
  write(sg3OutPath: string, file555OutPath: string): void {
    const { sgFile, modifications, originalFile555Path } = this
    const includeAlpha = sgFile.header.version >= 0xd6
    const recordSize = includeAlpha ? RECORD_SIZE_V6 : RECORD_SIZE_V5
    const maxBitmapRecords = sgFile.header.version === 0xd3 ? 100 : 200

    // Build imageId → modification lookup (modifications are keyed by bitmapIndex:imageIndex)
    const modByImageId = new Map<number, Modification>()
    for (const [key, mod] of modifications) {
      const [bi, ii] = key.split(':').map(Number)
      const img = sgFile.bitmaps[bi]?.images[ii]
      if (img) modByImageId.set(img.imageId, mod)
    }

    // Read the entire original .555 file into memory for raw-copy of unchanged images.
    // (Emperor .555 files are typically 5–50 MB.)
    const originalFile555 = fs.readFileSync(originalFile555Path)

    // --- Pass 1: determine encoded data and new offsets for every image ---

    const writeInfo = new Map<number, ImageWriteInfo>()
    const parts: Buffer[] = []
    let currentOffset = 0

    for (const sgImage of sgFile.images) {
      const rec = sgImage.record   // always the image's own record
      const mod = modByImageId.get(sgImage.imageId)

      // --- Removed ---
      if (mod?.op === 'remove') {
        writeInfo.set(sgImage.imageId, {
          offset: 0, length: 0, alphaLength: 0,
          modified: true, width: 0, height: 0, type: rec.type, clearInvert: false,
        })
        continue
      }

      // --- Replaced ---
      if (mod?.op === 'replace') {
        const { rgba, width, height } = mod
        // Use workRecord.type (the actual displayed type) as the source type, since
        // for inverted images workRecord points to the original they mirror.
        const sourceType = sgImage.workRecord.type
        const { data, type } = SgImageEncoder.encode(rgba, width, height, sourceType)
        writeInfo.set(sgImage.imageId, {
          offset: currentOffset, length: data.byteLength, alphaLength: 0,
          modified: true, width, height, type,
          clearInvert: sgImage.invert,
        })
        parts.push(data)
        currentOffset += data.byteLength
        continue
      }

      // --- Unchanged inverted image ---
      // The image has no data of its own; its pixels come from the non-inverted original
      // via the invertOffset chain.  Don't copy data; preserve invertOffset in the record.
      if (sgImage.invert) {
        writeInfo.set(sgImage.imageId, {
          offset: 0, length: rec.length, alphaLength: rec.alphaLength,
          modified: false, width: rec.width, height: rec.height, type: rec.type, clearInvert: false,
        })
        continue
      }

      // --- Unchanged empty slot ---
      if (rec.length <= 0) {
        writeInfo.set(sgImage.imageId, {
          offset: 0, length: 0, alphaLength: 0,
          modified: false, width: rec.width, height: rec.height, type: rec.type, clearInvert: false,
        })
        continue
      }

      // --- Unchanged image with data: copy raw bytes from original .555 ---
      const rawOffset = rec.offset - rec.flags[0]
      const rawLength = rec.length + rec.alphaLength

      // Clamp read to available bytes and zero-pad the rest (C3 EOF special case)
      const available = originalFile555.byteLength - rawOffset
      const rawBuf = Buffer.alloc(rawLength)
      if (available > 0) {
        originalFile555.copy(rawBuf, 0, rawOffset, rawOffset + Math.min(rawLength, available))
      }

      writeInfo.set(sgImage.imageId, {
        offset: currentOffset, length: rec.length, alphaLength: rec.alphaLength,
        modified: false, width: rec.width, height: rec.height, type: rec.type, clearInvert: false,
      })
      parts.push(rawBuf)
      currentOffset += rawLength
    }

    // --- Write new .555 file ---
    const file555Buffer = Buffer.concat(parts)
    fs.writeFileSync(file555OutPath, file555Buffer)

    // --- Pass 2: patch the .sg3 buffer ---
    const sg3Buffer = fs.readFileSync(sgFile.filename)

    // Base offset of the first image record (index 0 = dummy, index 1..N = real images)
    const imageRecordBase =
      SgHeader.SG_HEADER_SIZE + maxBitmapRecords * SgBitmapRecord.SG_BITMAP_RECORD_SIZE

    for (const sgImage of sgFile.images) {
      const info = writeInfo.get(sgImage.imageId)
      if (!info) continue

      // sgImage.imageId is 1-based (dummy is 0)
      const base = imageRecordBase + sgImage.imageId * recordSize

      // Always: update offset and clear flags[0] so the offset is now absolute
      sg3Buffer.writeUInt32LE(info.offset, base + F_OFFSET)
      sg3Buffer.writeUInt8(0, base + F_FLAGS)  // flags[0] = 0

      if (info.clearInvert) {
        sg3Buffer.writeInt32LE(0, base + F_INVERT_OFFSET)
      }

      if (info.modified) {
        // Full patch for replaced/removed images
        sg3Buffer.writeUInt32LE(info.length, base + F_LENGTH)
        sg3Buffer.writeUInt32LE(0, base + F_UNCOMPRESSED_LEN)  // not used for sprite/plain
        sg3Buffer.writeUInt16LE(info.width, base + F_WIDTH)
        sg3Buffer.writeUInt16LE(info.height, base + F_HEIGHT)
        sg3Buffer.writeUInt16LE(info.type, base + F_TYPE)
        if (includeAlpha) {
          sg3Buffer.writeUInt32LE(0, base + F_ALPHA_OFFSET)
          sg3Buffer.writeUInt32LE(0, base + F_ALPHA_LENGTH)
        }
      } else if (includeAlpha && info.alphaLength > 0) {
        // Update alphaOffset for unchanged images that have alpha data
        // (alpha immediately follows the image data in the .555 file)
        sg3Buffer.writeUInt32LE(info.offset + info.length, base + F_ALPHA_OFFSET)
      }
    }

    // Patch header: filesize555
    sg3Buffer.writeUInt32LE(file555Buffer.byteLength, H_FILESIZE_555)

    // Write new .sg3 file
    fs.writeFileSync(sg3OutPath, sg3Buffer)
  }
}
