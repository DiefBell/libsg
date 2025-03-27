import * as path from "path";
import * as fs from "fs";
import sharp from "sharp";
import { SgFile } from "../src/index.js";
import { FileHandle } from "../src/util/FileHandle.js";
import { SgImageData } from "../src/SgImageData.js";

const main = async () =>
{
	const inputFolder = path.join(__dirname, "input");
	const outputFolder = path.join(__dirname, "output");
	if(!fs.existsSync(outputFolder))
	{
		fs.mkdirSync(outputFolder, { recursive: true });
	}

	const inputFiles = fs.readdirSync(inputFolder).filter((filename) => filename.endsWith(".sg3"));

	const fileHandles = inputFiles.map(
		(inputFilename) => new FileHandle(path.join(inputFolder, inputFilename))
	);
	const files = fileHandles.map((fileHandle) => SgFile.FromFileHandle(fileHandle))
	const file = files.find((file) => file.filename.includes("destruction"));
	if(!file) {
		throw new Error("Couldn't find file!");
	}

	const bitmap = file.bitmaps[0];
	const images = bitmap.images.filter((image) => !!image.parent);
	const image = images[10];

	const expectedFilename555 = bitmap.sgFilename.replace(".sg3", ".555");

	const { width, height, data } = new SgImageData(image, expectedFilename555);
	const s = sharp(
		data,
		{
			raw: { width, height, channels: 4 /* RGBA */}
		}
	);

	const filepath = path.join(outputFolder,
		`${path.basename(expectedFilename555, ".555")}_${bitmap.bitmapId}_${image.imageId}.png`
	);
	await s.toFile(filepath);
}

main();
