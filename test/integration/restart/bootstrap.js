// Installs the built XPI through AddonManager, then checks the same profile
// on subsequent launches. No source-directory pointer is used for AbstractIn.
async function run() {
 const out = Zotero.Prefs.get('extensions.zusia-tester.outDir', true);
 const stage = Zotero.Prefs.get('extensions.zusia-tester.restartStage', true) || 0;
 const result = { stage, checks: [], errors: [] };
 const check = (name, ok, detail) => result.checks.push({ name, ok: !!ok, detail });
 try {
  await Zotero.uiReadyPromise;
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const id = 'abstractin@shen-zhang-42.github.io';
  if (stage === 0) {
   const path = Zotero.Prefs.get('extensions.zusia-tester.xpi', true);
   const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(path);
   const install = await AddonManager.getInstallForFile(file);
   await install.install();
  }
  const addon = await AddonManager.getAddonByID(id);
  check('installed addon remains in AddonManager', !!addon, addon && { version: addon.version, isActive: addon.isActive, appDisabled: addon.appDisabled, userDisabled: addon.userDisabled, temporarilyInstalled: addon.temporarilyInstalled, rootURI: addon.getResourceURI().spec });
  check('addon is active', addon?.isActive && !addon.appDisabled && !addon.userDisabled);
  check('addon is installed permanently', !!addon && !addon.temporarilyInstalled && addon.getResourceURI().spec.includes('/extensions/'));
  let p;
  for (let i = 0; i < 100 && !p; i++) { p = Zotero.AbstractIn; if (!p) await Zotero.Promise.delay(100); }
  check('plugin startup completed', !!p?.initialized, p?.version);
  const win = Zotero.getMainWindow(), doc = win.document;
  check('main window stylesheet attached', !!doc.querySelector('#abstractin-stylesheet'));
  if (p) {
   check('native item pane entry registered', !!p.paneID, p.paneID);
   const body = p.el(doc, 'div'); doc.documentElement.append(body); p.renderSkeleton(doc, body);
   check('chat can render after startup', !!body.querySelector('.zs-root .zs-header-icon svg'));
   const loaded = await Promise.all(Object.keys(p.ICON_FILES).map(async name => ({name, loaded: !!(await p.loadIcon(doc, name))})));
   check('every packaged control icon loads', loaded.every(icon => icon.loaded), loaded.filter(icon => !icon.loaded));
   await Zotero.Promise.delay(100);
   const missing = [...body.querySelectorAll('.zs-i')].filter(icon => icon.dataset.icon !== 'stop' && !icon.querySelector('svg')).map(icon => icon.dataset.icon);
   check('all rendered controls contain SVG', !missing.length, missing);

  }
  Zotero.Prefs.set('extensions.zusia-tester.restartStage', stage + 1, true);
 }
 catch (e) { result.errors.push(String(e) + '\n' + e.stack); }
 await IOUtils.writeUTF8(PathUtils.join(out, 'stage-' + stage + '.json'), JSON.stringify(result, null, 2));
 Zotero.Utilities.Internal.quit();
}
function startup() { run(); }
function shutdown() {}
function install() {}
function uninstall() {}
