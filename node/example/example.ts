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


	if(fs.existsSync(outputFolder))
	{
		fs.rmdirSync(outputFolder, { recursive: true });
	}
	fs.mkdirSync(outputFolder, { recursive: true });

	const inputFiles = fs.readdirSync(inputFolder).filter((filename) => filename.endsWith(".sg3"));

	const fileHandles = inputFiles.map(
		(inputFilename) => new FileHandle(path.join(inputFolder, inputFilename))
	);
	const files = fileHandles.map((fileHandle) => SgFile.FromFileHandle(fileHandle))

	for(const file of files)
	{
		for(const bitmap of file.bitmaps)
		{
			const filename555 = bitmap.sgFilename.replace(".sg3", ".555");
			if(!fs.existsSync(filename555))
			{
				// console.log("No matching filename; skipping...");
				continue;
			}

			for(const image of bitmap.images) {
				if(!image.parent) {
					// console.log("Image has no parent; skipping...");
					continue;
				}

				let imageData: SgImageData;
				try {
					imageData = new SgImageData(image, filename555);
				}
				catch (err) {
					// console.error((err as Error).message);
					continue;
				}

				const { width, height, dataFlat } = imageData;

				const s = sharp(
					dataFlat,
					{
						raw: { width, height, channels: 4 /* RGBA */}
					}
				);

				const filepath = path.join(outputFolder,
					`${path.basename(filename555, ".555")}_${bitmap.bitmapId}_${image.imageId}.png`
				);
				console.log(`Saving to ${path.basename(filepath)}`);
				await s.toFile(filepath);
			}
		}
	}

	// const file = files.find((file) => file.filename.includes("destruction"));
	// if(!file) {
	// 	throw new Error("Couldn't find file!");
	// }

	// const bitmap = file.bitmaps[0];
	// const images = bitmap.images.filter((image) => !!image.parent);
	// const image = images[10];

	// const expectedFilename555 = bitmap.sgFilename.replace(".sg3", ".555");

	// const { width, height, data } = new SgImageData(image, expectedFilename555);
	// const s = sharp(
	// 	data,
	// 	{
	// 		raw: { width, height, channels: 4 /* RGBA */}
	// 	}
	// );

	// const filepath = path.join(outputFolder,
	// 	`${path.basename(expectedFilename555, ".555")}_${bitmap.bitmapId}_${image.imageId}.png`
	// );
	// await s.toFile(filepath);
}

main();
