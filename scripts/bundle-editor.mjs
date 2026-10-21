import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const components = ["@codemirror/state", "@codemirror/view", "@codemirror/commands", "@codemirror/language", "@marijn/find-cluster-break", "crelt", "style-mod", "w3c-keyname", "@lezer/common", "@lezer/highlight", "@lezer/lr"];
let licenses = "CodeMirror 6 and bundled dependencies\n\n";
const versions = {};
for (const name of components) {
 const root = new URL("../node_modules/" + name + "/", import.meta.url);
 const pkg = JSON.parse(readFileSync(new URL("package.json", root)));
 versions[name] = pkg.version;
 licenses += `${name} ${pkg.version}\n${readFileSync(new URL("LICENSE", root), "utf8")}\n\n`;
}
writeFileSync(new URL("../src/content/editor/CODEMIRROR-LICENSES.txt", import.meta.url), licenses);
writeFileSync(new URL("../src/content/editor/dependencies.json", import.meta.url), JSON.stringify(versions, null, "\t") + "\n");
await build({ entryPoints: [fileURLToPath(new URL("../src/content/editor/composer-entry.js", import.meta.url))], outfile: fileURLToPath(new URL("../src/content/editor/composer.bundle.js", import.meta.url)), bundle: true, format: "iife", target: "firefox115", minify: true, legalComments: "eof" });
console.log("Bundled CodeMirror 6 editor");
