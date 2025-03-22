import * as path from "path";
import * as fs from "fs";
import { SgFile } from "../src";

const inputFolder = path.join(__dirname, "input");
const inputFiles = fs.readdirSync(inputFolder).filter((filename) => filename.endsWith(".sg3"));

const file = new SgFile(path.join(inputFolder, inputFiles[0]));
console.log(file.header);
