import * as fs from "fs";

export enum ESeekOrigin {
    /**
     * SEEK_SET: 
     * The offset is set relative to the start of the file (beginning of the file).
     * This means the position is directly set to the offset value.
     */
    SEEK_SET = 0,

    /**
     * SEEK_CUR: 
     * The offset is set relative to the current position in the file.
     * This means the position is moved forward or backward by the given offset.
     */
    SEEK_CUR = 1,

    /**
     * SEEK_END: 
     * The offset is set relative to the end of the file.
     * This means the position is set to the end of the file, plus the offset value.
     */
    SEEK_END = 2
}

/**
 * Interface representing a file descriptor with tracked position.
 */
export class FileHandle
{
	public readonly filepath: string;
	public readonly fd: number;
	protected _position: number;

	constructor(filepath: string, openMode: fs.Mode = "r")
	{
		this.filepath = filepath;
		this.fd = fs.openSync(filepath, openMode);
		this._position = 0;
	}

	/**
	 * Cleans up the file handle by closing the file descriptor.
	 */
	[Symbol.dispose]()
	{
		fs.closeSync(this.fd);
	}

	public close()
	{
		fs.closeSync(this.fd);
	}

	/**
	 * Sets the position to a specified value.
	 * @param position - The new position to set.
	 */
	public set position(position: number)
	{
		this._position = position;
	}

	/**
	 * Returns the current position.
	 * @returns The current position of the file handle.
	 */
	public get position(): number
	{
		return this._position;
	}

	/**
	 * Reads from the file, starting at the current position, and updates the position.
	 * @param buffer - The buffer to store the data.
	 * @param offset - The offset within the buffer to start writing to.
	 * @param length - The number of bytes to read.
	 * @returns The number of bytes read.
	 */
	public read(buffer: Buffer, offset: number, length: number): number
	{
		const bytesRead = fs.readSync(this.fd, buffer, offset, length, this._position);
		if (bytesRead < length)
		{
			throw new Error(`Failed to read ${length} bytes at position ${this._position}`);
		}
		// Update the position after reading
		this._position += bytesRead;
		return bytesRead;
	}

	/**
	 * Reads a string of `length` bytes from the current position in the file.
	 * @param length - The number of bytes to read.
	 * @returns The string read from the file.
	 */
	public readString(length: number): string {
		// Create a buffer to hold the data
		const buffer = Buffer.alloc(length);
		
		// Read the specified number of bytes from the current position
		this.read(buffer, 0, length);
		
		// Convert the buffer to a string and return it
		return buffer.toString('utf-8').replace(/\0/g, '');  // Remove any null byte padding
	}

	public seek(offset: number, whence: ESeekOrigin)
	{
		switch (whence)
		{
			case ESeekOrigin.SEEK_SET:
				this._position = offset;
				break;
			case ESeekOrigin.SEEK_CUR:
				this._position += offset;
				break;
			case ESeekOrigin.SEEK_END:
				const fileStats = fs.fstatSync(this.fd); // Get file stats
				this._position = fileStats.size + offset; // Size of the file + offset
				break;
			default:
				throw new Error(`Invalid whence value: ${whence}`);
		}
	}

	public eof(): boolean {
        const fileStats = fs.fstatSync(this.fd);
        return this._position >= fileStats.size;
    }
}
