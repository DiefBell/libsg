import * as fs from "fs";

/**
 * Interface representing a file descriptor with tracked position.
 */
export class FileHandle {
    public readonly fd: number;
    protected _position: number;
	
	constructor(filepath: string) {
		this.fd = fs.openSync(filepath, 'r');
		this._position = 0;
	}

	[Symbol.dispose]() {
		fs.closeSync(this.fd);
	}

	public incrememtPosition(increment: number) {
		this._position += increment;
	}

	public setPosition(position: number) {
		this._position = position;
	}

	public get position() {
		return this._position;
	}
}


/**
 * Reads a number from the file at the current position, updating the position after the read.
 * @param file - The file descriptor and tracked position.
 * @param byteSize - The number of bytes to read (1, 2, or 4).
 * @param signed - Whether the number is signed (true) or unsigned (false).
 * @returns The read number, or throws an error if the read fails.
 */
const readNumberLe = (file: FileHandle, byteSize: number, signed: boolean): number => {
    const buffer = Buffer.alloc(byteSize);
    const bytesRead = fs.readSync(file.fd, buffer, 0, byteSize, file.position);

    if (bytesRead < byteSize) {
        throw new Error(`Failed to read ${byteSize} bytes at position ${file.position}`);
    }

    file.incrememtPosition(byteSize); // Update position after read

    switch (byteSize) {
        case 1: return signed ? buffer.readInt8(0) : buffer.readUInt8(0);
        case 2: return signed ? buffer.readInt16LE(0) : buffer.readUInt16LE(0);
        case 4: return signed ? buffer.readInt32LE(0) : buffer.readUInt32LE(0);
        default: throw new Error(`Unsupported byte size: ${byteSize}`);
    }
};

/**
 * Reads an unsigned 8-bit integer (UInt8) from a file descriptor.
 * @param fd - The file descriptor.
 * @returns The read number, or null if the read fails.
 */
export const readUInt8Le = (file: FileHandle) => readNumberLe(file, 1, false);

/**
 * Reads a signed 8-bit integer (Int8) from a file descriptor.
 * @param fd - The file descriptor.
 * @returns The read number, or null if the read fails.
 */
export const readInt8Le = (file: FileHandle) => readNumberLe(file, 1, true);

/**
 * Reads an unsigned 16-bit integer (UInt16) in little-endian format from a file descriptor.
 * @param fd - The file descriptor.
 * @returns The read number, or null if the read fails.
 */
export const readUInt16Le = (file: FileHandle) => readNumberLe(file, 2, false);

/**
 * Reads a signed 16-bit integer (Int16) in little-endian format from a file descriptor.
 * @param fd - The file descriptor.
 * @returns The read number, or null if the read fails.
 */
export const readInt16Le = (file: FileHandle) => readNumberLe(file, 2, true);

/**
 * Reads an unsigned 32-bit integer (UInt32) in little-endian format from a file descriptor.
 * @param fd - The file descriptor.
 * @returns The read number, or null if the read fails.
 */
export const readUInt32Le = (file: FileHandle) => readNumberLe(file, 4, false);

/**
 * Reads a signed 32-bit integer (Int32) in little-endian format from a file descriptor.
 * @param fd - The file descriptor.
 * @returns The read number, or null if the read fails.
 */
export const readInt32Le = (file: FileHandle) => readNumberLe(file, 4, true);
