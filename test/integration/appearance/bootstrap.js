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
 const out = Zotero.Prefs.get('extensions.abstractin-tester.outDir', true);
 try {
  await Zotero.uiReadyPromise;
  let p;
  for (let i = 0; i < 200 && !p; i++) { p = Zotero.AbstractIn; if (!p) await Zotero.Promise.delay(100); }
  if (!p) throw new Error('Plugin startup timed out');
  const win = Zotero.getMainWindow(), doc = win.document;
  const catalogFixture = Zotero.Prefs.get('extensions.abstractin-tester.catalogFixture', true);
  if (catalogFixture) {
   const findBinary = p.findBinary;
   try {
    p.findBinary = async key => key === 'codex' ? catalogFixture : findBinary.call(p, key);
    await p.loadCodexModels(true);
    check('native subprocess reads paginated Codex model catalog', p.getModels('codex').some(m => m.id === 'fixture-sol') && p.getModels('codex').some(m => m.id === 'fixture-second'), p._codexModelsError);
    check('hidden Codex models excluded', !p.getModels('codex').some(m => m.id === 'fixture-hidden'));
   } finally { p.findBinary = findBinary; }
  }
  win.resizeTo(1000, 900);
  const panel = p.el(doc, 'section', 'abstractin-reader-panel');
  panel.style.cssText = 'position:fixed;top:10px;left:10px;height:800px;z-index:10000;max-width:none;';
  const toolbar = p.el(doc, 'div'); panel.append(toolbar);
  p.renderReaderToolbar({ reader: { type: 'pdf', itemID: 1, _window: win }, doc, append: node => toolbar.append(node) });
  const body = p.el(doc, 'div', 'abstractin-reader-view'); panel.append(body);
  doc.documentElement.append(panel);
  p.renderSkeleton(doc, body);
  const root = body.querySelector('.abstractin-root');
  const view = { doc, root, ctx: { dir: '/tmp/appearance', paperItem: { getField: () => 'Theory of Statistics', getCreators: () => [] }, reading: { type: 'book', language: 'English' } }, logEl: root.querySelector('.abstractin-log'), input: root.querySelector('.abstractin-input') };
  p._views.set(root, view);
  Zotero.Prefs.set('extensions.abstractin.readingEvidenceMode', 'knowledge', true);
  Zotero.Prefs.set('ui.prefersReducedMotion', 0, true);
  p.renderMessages(view, []); p.updateReadingControls(view);
  const missing = [...root.querySelectorAll('.abstractin-i')].filter(icon => icon.dataset.icon !== 'stop' && !icon.querySelector('svg')).map(icon => icon.dataset.icon);
  check('every header and composer control contains SVG', !missing.length, missing);
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
    const anchor = root.querySelector('.abstractin-reading-evidence-mode'); p.openReadingEvidenceMenu(root, anchor);
    await Zotero.Promise.delay(350);
    const menu = root.querySelector('.abstractin-reading-mode-menu');
    const rows = [...menu.querySelectorAll('.abstractin-menu-item')];
    for (const selector of ['.abstractin-header-icon svg', '.abstractin-empty .abstractin-mascot svg', '.abstractin-start-reading svg']) {
     const svg = root.querySelector(selector), r = svg && rect(svg);
     check(tag + ' visible ' + selector, !!r && r.width > 0 && r.height > 0, r);
    }
    check(tag + ' toolbar avatar', !!toolbar.querySelector('svg[stroke="#808088"]'));
    check(tag + ' distinct app and reading icons', root.querySelector('.abstractin-header-icon').dataset.icon === 'app' && root.querySelector('.abstractin-start-reading .abstractin-i').dataset.icon === 'book');
    check(tag + ' separated menu rows', rect(rows[1]).top >= rect(rows[0]).bottom, rows.map(rect));
    for (const row of rows) {
     const symbol = rect(row.querySelector('.abstractin-reading-menu-icon'));
     const text = rect(row.querySelector('.abstractin-menu-text'));
     const label = rect(row.querySelector('.abstractin-menu-label'));
     const desc = rect(row.querySelector('.abstractin-menu-desc'));
     check(tag + ' symbol before text', symbol.right <= text.left, { symbol, text });
     check(tag + ' description below label', desc.top >= label.bottom, { label, desc });
     check(tag + ' description contained', desc.bottom <= rect(row).bottom && desc.right <= rect(menu).right, { desc, row: rect(row), menu: rect(menu) });
    }
    await snapshot(win, p, panel, PathUtils.join(out, tag + '.png'));
   }
  }

  p.closeMenu(root);
  const companion = root.querySelector('.abstractin-empty .abstractin-mascot > svg');
  const float = companion.getAnimations().find(animation => animation.animationName === 'abstractin-mascot-float');
  check('companion has continuous float animation', !!float && float.effect.getTiming().iterations === Infinity);
  if (float) {
   float.pause();
   float.currentTime = 0; const start = companion.getBoundingClientRect().top;
   float.currentTime = 2000; const raised = companion.getBoundingClientRect().top;
   float.currentTime = 4000; const returned = companion.getBoundingClientRect().top;
   check('companion moves vertically by six pixels', Math.abs(start - raised - 6) < 0.5, { start, raised });
   check('companion returns to original position', Math.abs(start - returned) < 0.5, { start, returned });
   float.play();
  }
  for (const width of [280, 380, 520, 900]) {
   panel.style.width = width + 'px';
   p.renderMessages(view, []);
   const bar = root.querySelector('.abstractin-reading-bar');
   const emptyHeight = rect(bar).height;
   p.renderMessages(view, [{ role: 'user', text: 'Explain this passage.' }, { role: 'assistant', backend: 'codex', text: 'Here is the explanation.' }]);
   const dock = root.querySelector('.abstractin-discussion-companion');
   const dockSvg = dock.querySelector('svg');
   const tag = 'discussion-' + width;
   check(tag + ' companion uses reading control area', dock.parentElement === bar);
   check(tag + ' no extra row', Math.abs(rect(bar).height - emptyHeight) < 0.5);
   check(tag + ' companion fits controls', rect(dock).right <= rect(bar).right && rect(dock).bottom <= rect(bar).bottom);
   check(tag + ' companion scales to space', rect(dockSvg).width >= 32 && rect(dockSvg).width <= 80);
   check(tag + ' companion is stationary', win.getComputedStyle(dockSvg).animationName === 'none' && win.getComputedStyle(dock.querySelector('.abstractin-mascot-spark')).animationName === 'none');
   for (const button of bar.querySelectorAll('button')) {
    const r = rect(button), d = rect(dock);
    if (!r.width || !r.height) continue;
    check(tag + ' no button overlap ' + button.textContent, r.right <= d.left || r.left >= d.right || r.bottom <= d.top || r.top >= d.bottom, { button: r, companion: d });
   }
   await snapshot(win, p, panel, PathUtils.join(out, tag + '.png'));
   p.renderMessages(view, []);
   check(tag + ' new chat hides small companion', win.getComputedStyle(dock).display === 'none');
  }
  Zotero.Prefs.set('ui.prefersReducedMotion', 1, true);
  await Zotero.Promise.delay(100);
  check('reduced motion stops companion floating', win.getComputedStyle(root.querySelector('.abstractin-empty .abstractin-mascot > svg')).animationName === 'none');

 }
 catch(e) { results.errors.push(String(e) + '\n' + e.stack); }
 await IOUtils.writeUTF8(PathUtils.join(out, 'results.json'), JSON.stringify(results, null, 2));
 Zotero.Utilities.Internal.quit();
}
function startup() { run(); }
function shutdown() {}
function install() {}
function uninstall() {}
