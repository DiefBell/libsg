import { ESeekOrigin, FileHandle } from "./FileHandle";

export const fillBufferFromFileHandle = (img: any, file: FileHandle): Buffer | null => {
	const dataLength = img.workRecord.length + img.workRecord.alpha_length;
	if (dataLength <= 0) {
	  throw new Error(`Data length invalid (${dataLength})`);
	}
  
	// Allocate a buffer
	const buffer = Buffer.alloc(dataLength);
	if (!buffer) {
	  throw new Error("Could not allocate buffer");
	}
  
	// Seek to the appropriate position in the file
	const offset = img.workRecord.offset - img.workRecord.flags[0];
	try {
	  file.seek(offset, ESeekOrigin.SEEK_SET);
	} catch (error) {
	  throw new Error(`Could not seek to ${offset} in file`);
	}
  
	// Read data from file
	const bytesRead = file.read(buffer, 0, dataLength);
	if (bytesRead !== dataLength) {
	  // Handle C3 graphics special case (last 4 bytes missing)
	  if (bytesRead + 4 === dataLength && file.eof()) {
		buffer[bytesRead] = 0;
		buffer[bytesRead + 1] = 0;
		buffer[bytesRead + 2] = 0;
		buffer[bytesRead + 3] = 0;
	  } else {
		throw new Error(`Unable to read from file (read ${bytesRead} of ${dataLength})`);
	  }
	}
  
	return buffer;
  };
  