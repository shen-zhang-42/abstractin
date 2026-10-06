// Focused visual checks in a disposable Zotero profile, with native window CSS.
var results = { checks: [], errors: [] };
function check(name, ok, detail) { results.checks.push({ name, ok: !!ok, detail }); }
async function snapshot(win, p, panel, path) {
 const r = panel.getBoundingClientRect(), canvas = p.el(win.document, 'canvas');
 canvas.width = Math.ceil(r.width * 2); canvas.height = 1000;
 const ctx = canvas.getContext('2d'); ctx.scale(2, 2);
 ctx.drawWindow(win, r.left, r.top, r.width, 500, 'rgb(255,255,255)');
 const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
 await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
}
async function run() {
 const out = Zotero.Prefs.get('extensions.zusia-tester.outDir', true);
 try {
  await Zotero.uiReadyPromise;
  let p;
  for (let i = 0; i < 200 && !p; i++) { p = Zotero.AbstractIn; if (!p) await Zotero.Promise.delay(100); }
  if (!p) throw new Error('Plugin startup timed out');
  const win = Zotero.getMainWindow(), doc = win.document;
  win.resizeTo(1000, 900);
  const panel = p.el(doc, 'section', 'zs-reader-panel');
  panel.style.cssText = 'position:fixed;top:10px;left:10px;height:800px;z-index:10000;max-width:none;';
  const toolbar = p.el(doc, 'div'); panel.append(toolbar);
  p.renderReaderToolbar({ reader: { type: 'pdf', itemID: 1, _window: win }, doc, append: node => toolbar.append(node) });
  const body = p.el(doc, 'div', 'zs-reader-view'); panel.append(body);
  doc.documentElement.append(panel);
  p.renderSkeleton(doc, body);
  const root = body.querySelector('.zs-root');
  const view = { doc, root, ctx: { dir: '/tmp/appearance', paperItem: { getField: () => 'Theory of Statistics', getCreators: () => [] }, reading: { type: 'book', language: 'English' } }, logEl: root.querySelector('.zs-log'), input: root.querySelector('.zs-input') };
  p._views.set(root, view);
  Zotero.Prefs.set('extensions.abstractin.readingEvidenceMode', 'knowledge', true);
  p.renderMessages(view, []); p.updateReadingControls(view);
  const rect = node => { const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
  for (const dark of [false, true]) {
   Zotero.Prefs.set('ui.systemUsesDarkTheme', dark ? 1 : 0, true);
   Zotero.Prefs.set('layout.css.prefers-color-scheme.content-override', dark ? 0 : 1, true);
   doc.documentElement.setAttribute('data-color-scheme', dark ? 'dark' : 'light');
   for (const width of [280, 380, 520]) {
    panel.style.width = width + 'px';
    const tag = (dark ? 'dark' : 'light') + '-' + width;
    p.closeMenu(root);
    await Zotero.Promise.delay(150);
    check(tag + ' theme applied', win.matchMedia('(prefers-color-scheme: dark)').matches === dark);
    await snapshot(win, p, panel, PathUtils.join(out, tag + '-empty.png'));
    const anchor = root.querySelector('.zs-reading-evidence-mode'); p.openReadingEvidenceMenu(root, anchor);
    await Zotero.Promise.delay(350);
    const menu = root.querySelector('.zs-reading-mode-menu');
    const rows = [...menu.querySelectorAll('.zs-menu-item')];
    for (const selector of ['.zs-header-icon svg', '.zs-mascot svg', '.zs-start-reading svg']) {
     const svg = root.querySelector(selector), r = svg && rect(svg);
     check(tag + ' visible ' + selector, !!r && r.width > 0 && r.height > 0, r);
    }
    check(tag + ' toolbar avatar', !!toolbar.querySelector('svg rect[fill="#b84459"]'));
    check(tag + ' distinct app and reading icons', root.querySelector('.zs-header-icon').dataset.icon === 'app' && root.querySelector('.zs-start-reading .zs-i').dataset.icon === 'book');
    check(tag + ' separated menu rows', rect(rows[1]).top >= rect(rows[0]).bottom, rows.map(rect));
    for (const row of rows) {
     const symbol = rect(row.querySelector('.zs-reading-menu-icon'));
     const text = rect(row.querySelector('.zs-menu-text'));
     const label = rect(row.querySelector('.zs-menu-label'));
     const desc = rect(row.querySelector('.zs-menu-desc'));
     check(tag + ' symbol before text', symbol.right <= text.left, { symbol, text });
     check(tag + ' description below label', desc.top >= label.bottom, { label, desc });
     check(tag + ' description contained', desc.bottom <= rect(row).bottom && desc.right <= rect(menu).right, { desc, row: rect(row), menu: rect(menu) });
    }
    await snapshot(win, p, panel, PathUtils.join(out, tag + '.png'));
   }
  }
 }
 catch(e) { results.errors.push(String(e) + '\n' + e.stack); }
 await IOUtils.writeUTF8(PathUtils.join(out, 'results.json'), JSON.stringify(results, null, 2));
 Zotero.Utilities.Internal.quit();
}
function startup() { run(); }
function shutdown() {}
function install() {}
function uninstall() {}
