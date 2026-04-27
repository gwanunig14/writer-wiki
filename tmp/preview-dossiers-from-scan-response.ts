// tmp/preview-dossiers-from-scan-response.ts
// Script to preview character dossiers generated from a scan response JSON file
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCharacterArticleBody } from "../src/lib/server/canon/dossier-manager";
import type { ScanEntity } from "../src/lib/types/scan-result";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scanPath = path.join(__dirname, "chapter-4-scan-response.json");
const raw = fs.readFileSync(scanPath, "utf-8");
const scan = JSON.parse(raw);

for (const entity of scan.entities) {
  if (entity.category === "character") {
    const md = buildCharacterArticleBody(entity as ScanEntity);
    console.log("\n==== " + entity.name + " ====");
    console.log(md);
  }
}
