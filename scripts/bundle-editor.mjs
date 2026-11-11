import { build } from "esbuild";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
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
const result = await build({ entryPoints: [fileURLToPath(new URL("../src/content/editor/composer-entry.js", import.meta.url))], outfile: fileURLToPath(new URL("../src/content/editor/composer.bundle.js", import.meta.url)), bundle: true, format: "iife", target: "firefox115", supported: { 'template-literal': false }, minify: true, legalComments: "eof", metafile: true });
const packages = new Map(), project = fileURLToPath(new URL("../", import.meta.url));
for (const input of Object.keys(result.metafile.inputs)) {
 if (!input.includes('node_modules/')) continue;
 let dir = dirname(resolve(project, input));
 while (!existsSync(join(dir, 'package.json')) && dirname(dir) !== dir) dir = dirname(dir);
 const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
 if ((components.includes(pkg.name) && versions[pkg.name] === pkg.version) || packages.has(pkg.name + '@' + pkg.version)) continue;
 const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'].map(name => join(dir, name)).find(path => existsSync(path));
 if (!license) throw new Error('Missing bundled editor license: ' + pkg.name);
 packages.set(pkg.name + '@' + pkg.version, { pkg, license });
}
let richLicenses = 'Tiptap, ProseMirror and visual Markdown editor dependencies\n\n';
const richVersions = {};
for (const [name, {pkg, license}] of [...packages].sort(([a],[b]) => a.localeCompare(b))) { richVersions[name] = pkg.license; richLicenses += name + '\n' + readFileSync(license, 'utf8') + '\n\n'; }
writeFileSync(new URL('../src/content/editor/RICH-EDITOR-LICENSES.txt', import.meta.url), richLicenses);
writeFileSync(new URL('../src/content/editor/rich-dependencies.json', import.meta.url), JSON.stringify(richVersions, null, '\t') + '\n');
console.log('Bundled CodeMirror discussion input and visual Markdown note editor');
