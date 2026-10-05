// Resolve paths from this checkout, independent of the shell's working directory.
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
console.log(JSON.stringify({
	addonID: manifest.applications.zotero.id,
	sourceDirectory: fileURLToPath(new URL("../src/", import.meta.url)),
	skillsDirectory: fileURLToPath(new URL("../skills/", import.meta.url)),
}, null, 2));
