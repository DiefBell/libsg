import { SgImage } from "../SgImage";
import { ESeekOrigin, FileHandle } from "./FileHandle";

/**
 * Read (length + alphaLength) bytes from a .555 file into a single Buffer,
 * using the workRecord's offset and flags to find the correct file position.
 *
 * Offset formula:
 *   The game stores the pixel data position as (absolute_offset + flags[0]).
 *   To get the real byte position in the .555 file, subtract flags[0]:
 *     readPosition = workRecord.offset - workRecord.flags[0]
 *   flags[0] is the "extern" flag in the C source.  For most images it is 0,
 *   but some images have a non-zero value and the subtraction is always required.
 *
 * Buffer layout:
 *   bytes [0,           length)                     → pixel data
 *   bytes [length,      length + alphaLength)        → alpha mask (may be empty)
 *
 * C3 EOF edge case:
 *   Some Caesar 3 graphics files have their last image truncated by exactly
 *   4 bytes.  If we hit EOF exactly 4 bytes short of the expected length, the
 *   missing bytes are zero-padded rather than throwing an error.
 *
 * Returns the populated Buffer (never null; throws on error instead).
 */
export const fillBufferFromFileHandle = (img: SgImage, file: FileHandle): Buffer | null =>
{
	const dataLength = img.workRecord.length + img.workRecord.alphaLength;
	if (dataLength <= 0)
	{
		throw new Error(`Data length invalid (${dataLength})`);
	}

	const buffer = Buffer.alloc(dataLength);

	// workRecord.offset is stored as (absolute_555_position + flags[0]);
	// subtract flags[0] to get the actual byte offset to read from.
	const offset = img.workRecord.offset - img.workRecord.flags[0];
	try
	{
		file.seek(offset, ESeekOrigin.SEEK_SET);
	} catch (error)
	{
		throw new Error(`Could not seek to ${offset} in file`);
	}

	const bytesRead = file.read(buffer, 0, dataLength);
	if (bytesRead !== dataLength)
	{
		// C3 special case: last image may be 4 bytes short at EOF
		if (bytesRead + 4 === dataLength && file.eof())
		{
			buffer[bytesRead]     = 0;
			buffer[bytesRead + 1] = 0;
			buffer[bytesRead + 2] = 0;
			buffer[bytesRead + 3] = 0;
		} else
		{
			throw new Error(`Unable to read from file (read ${bytesRead} of ${dataLength})`);
		}
	}

	return buffer;
};
