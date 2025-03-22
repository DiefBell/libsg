import * as path from "path";
import * as fs from "fs";
import { SgFile } from "../src";
import { FileHandle } from "../src/util/FileHandle";

const inputFolder = path.join(__dirname, "input");
const inputFiles = fs.readdirSync(inputFolder).filter((filename) => filename.endsWith(".sg3"));

const fileHandle = new FileHandle(path.join(inputFolder, inputFiles[0]))
const file = SgFile.FromFileHandle(fileHandle);
console.log(file);
