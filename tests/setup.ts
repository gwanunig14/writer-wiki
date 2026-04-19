import { rmSync } from "node:fs";
import { join } from "node:path";

const testRoot = join(process.cwd(), ".tmp-test-data");

rmSync(testRoot, { force: true, recursive: true });
process.env.ACK_DATA_DIR = testRoot;
process.env.ACK_DB_PATH = join(testRoot, "author-canon-keeper.sqlite");
process.env.ACK_PROJECT_DATA_DIR = join(testRoot, "project-data");
