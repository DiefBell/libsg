import * as fs from "fs";

export const readNumber = (fd: number, byteSize: number, signed: boolean): number | null => {
    const buffer = Buffer.alloc(byteSize);
    const bytesRead = fs.readSync(fd, buffer, 0, byteSize, null);

    if (bytesRead < byteSize) {
        return null;
    }

    switch (byteSize) {
        case 1:
            return signed ? buffer.readInt8(0) : buffer.readUInt8(0);
        case 2:
            return signed ? buffer.readInt16LE(0) : buffer.readUInt16LE(0);
        case 4:
            return signed ? buffer.readInt32LE(0) : buffer.readUInt32LE(0);
        default:
            throw new Error(`Unsupported byte size: ${byteSize}`);
    }
}