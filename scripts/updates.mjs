// Writes the update manifest Zotero polls to offer in-place upgrades. The release
// workflow uploads it next to the .xpi, and manifest.json's update_url points at
// the /releases/latest/download/ redirect so the URL never has to change.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
export function createUpdates(repo = process.env.GITHUB_REPOSITORY || "shen-zhang-42/abstractin") {
	const { id, strict_min_version, strict_max_version } = manifest.applications.zotero;
	return {
		addons: {
			[id]: {
				updates: [{
					version: manifest.version,
					update_link: `https://github.com/${repo}/releases/download/v${manifest.version}/abstractin.xpi`,
					applications: { zotero: { strict_min_version, strict_max_version } },
				}],
			},
		},
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const out = new URL("../updates.json", import.meta.url);
	writeFileSync(out, JSON.stringify(createUpdates(), null, "\t") + "\n");
	console.log(`Wrote updates.json for ${manifest.applications.zotero.id} ${manifest.version}`);
}
