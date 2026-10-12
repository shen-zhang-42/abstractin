var results = { checks: [], errors: [] };
function check(name, ok, detail) { results.checks.push({ name, ok: !!ok, detail }); }
async function waitFor(fn, timeout = 20000) {
 const start = Date.now();
 while (Date.now() - start < timeout) { const value = fn(); if (value) return value; await Zotero.Promise.delay(100); }
 throw new Error("Timed out waiting for composer");
}
async function run() {
 const out = Zotero.Prefs.get("extensions.abstractin-tester.outDir", true);
 const repo = Zotero.Prefs.get("extensions.abstractin-tester.repo", true);
 try {
  await Zotero.uiReadyPromise;
  const plugin = await waitFor(() => Zotero.AbstractIn);
  results.version = Zotero.version;
  const scope = { Zotero, Cc, Ci, check, waitFor };
  Services.scriptloader.loadSubScript("file://" + repo + "/test/integration/tester/composer.js", scope);
  await scope.testComposer(Zotero.getMainWindow(), plugin);
 } catch (error) { results.errors.push(String(error) + "\n" + error.stack); }
 await IOUtils.writeUTF8(PathUtils.join(out, "results.json"), JSON.stringify(results, null, 2));
 Zotero.Utilities.Internal.quit();
}
function startup() { run(); }
function shutdown() {}
function install() {}
function uninstall() {}
