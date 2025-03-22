import { FileHandle } from "./FileHandle";

/**
 * Reads a number from the file at the current position, updating the position after the read.
 * @param file - The FileHandle instance that tracks the file and its current position.
 * @param byteSize - The number of bytes to read (1, 2, or 4).
 * @param signed - Whether the number is signed (true) or unsigned (false).
 * @returns The read number, or throws an error if the read fails.
 */
const readNumberLe = (file: FileHandle, byteSize: number, signed: boolean): number => {
    const buffer = Buffer.alloc(byteSize);
    const bytesRead = file.read(buffer, 0, byteSize);

    if (bytesRead < byteSize) {
        throw new Error(`Failed to read ${byteSize} bytes at position ${file.position}`);
    }

    switch (byteSize) {
        case 1: return signed ? buffer.readInt8(0) : buffer.readUInt8(0);
        case 2: return signed ? buffer.readInt16LE(0) : buffer.readUInt16LE(0);
        case 4: return signed ? buffer.readInt32LE(0) : buffer.readUInt32LE(0);
        default: throw new Error(`Unsupported byte size: ${byteSize}`);
    }
};

/**
 * Reads an unsigned 8-bit integer (UInt8) from a FileHandle.
 * @param file - The FileHandle instance.
 * @returns The read number, or null if the read fails.
 */
export const readUInt8Le = (file: FileHandle) => readNumberLe(file, 1, false);

/**
 * Reads a signed 8-bit integer (Int8) from a FileHandle.
 * @param file - The FileHandle instance.
 * @returns The read number, or null if the read fails.
 */
export const readInt8Le = (file: FileHandle) => readNumberLe(file, 1, true);

/**
 * Reads an unsigned 16-bit integer (UInt16) in little-endian format from a FileHandle.
 * @param file - The FileHandle instance.
 * @returns The read number, or null if the read fails.
 */
export const readUInt16Le = (file: FileHandle) => readNumberLe(file, 2, false);

/**
 * Reads a signed 16-bit integer (Int16) in little-endian format from a FileHandle.
 * @param file - The FileHandle instance.
 * @returns The read number, or null if the read fails.
 */
export const readInt16Le = (file: FileHandle) => readNumberLe(file, 2, true);

/**
 * Reads an unsigned 32-bit integer (UInt32) in little-endian format from a FileHandle.
 * @param file - The FileHandle instance.
 * @returns The read number, or null if the read fails.
 */
export const readUInt32Le = (file: FileHandle) => readNumberLe(file, 4, false);

/**
 * Reads a signed 32-bit integer (Int32) in little-endian format from a FileHandle.
 * @param file - The FileHandle instance.
 * @returns The read number, or null if the read fails.
 */
export const readInt32Le = (file: FileHandle) => readNumberLe(file, 4, true);
