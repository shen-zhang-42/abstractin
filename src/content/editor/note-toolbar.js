import { markdownShortcuts } from './markdown-shortcuts.js';

const fonts = [
 ['system', 'System', 'system-ui, sans-serif'], ['arial', 'Arial', 'Arial, sans-serif'],
 ['georgia', 'Georgia', 'Georgia, serif'], ['times', 'Times New Roman', '"Times New Roman", serif'],
 ['mono', 'Consolas', 'Consolas, ui-monospace, monospace'],
 ['yahei', 'Microsoft YaHei', '"Microsoft YaHei", sans-serif'], ['song', 'SimSun', 'SimSun, serif'],
];

// These controls live in the content iframe alongside the formatting commands.
// They do not depend on chrome-document popups or an object crossing the bridge.
export function noteToolbarControls(toolbar, config) {
 const font = document.createElement('select'); font.className = 'note-font-select';
 font.setAttribute('aria-label', 'Note display font'); font.title = 'Display font';
 for (const [value, label] of fonts) { const option = document.createElement('option'); option.value = value; option.textContent = label; font.append(option); }
 let current;
 const setFont = value => {
  const selected = fonts.find(item => item[0] === value) || fonts[0]; font.value = selected[0];
  if (current === selected[0]) return false; current = selected[0];
  document.documentElement.style.setProperty('--note-display-font', selected[2]);
  return true;
 };
 setFont(config.font); font.onchange = () => { setFont(font.value); config.onFontChange?.(font.value); };
 toolbar.prepend(font);

 const help = document.createElement('button'); help.type = 'button'; help.className = 'note-shortcuts-button';
 help.textContent = '?'; help.title = 'Keyboard shortcuts'; help.setAttribute('aria-label', 'Keyboard shortcuts'); help.setAttribute('aria-expanded', 'false');
 const panel = document.createElement('section'); panel.className = 'note-shortcuts-panel'; panel.hidden = true;
 panel.setAttribute('aria-label', 'Markdown shortcuts');
 const heading = document.createElement('strong'); heading.textContent = 'Markdown shortcuts';
 const table = document.createElement('table');
 const mac = config.isMac ?? /Mac/.test(navigator.platform);
 const basics = [{ key: 'Mod-s', label: 'Save' }, { key: 'Mod-z', label: 'Undo' }, { key: mac ? 'Mod-Shift-z' : 'Mod-y', label: 'Redo' }];
 for (const item of [...markdownShortcuts, ...basics]) {
  const row = document.createElement('tr'), label = document.createElement('td'), key = document.createElement('td'), kbd = document.createElement('kbd');
  label.textContent = item.label;
  kbd.textContent = item.key.split('-').map(part => part === 'Mod' ? mac ? 'Cmd' : 'Ctrl' : part === 'Alt' && mac ? 'Option' : part.length === 1 ? part.toUpperCase() : part).join('+');
  key.append(kbd); row.append(label, key); table.append(row);
 }
 panel.append(heading, table); toolbar.append(help, panel);
 const close = () => { panel.hidden = true; help.setAttribute('aria-expanded', 'false'); };
 help.onclick = () => { panel.hidden = !panel.hidden; help.setAttribute('aria-expanded', String(!panel.hidden)); };
 const outside = event => { if (!panel.contains(event.target) && event.target !== help) close(); };
 const keydown = event => { if (event.key === 'Escape' && !panel.hidden) { close(); help.focus(); event.preventDefault(); event.stopPropagation(); } };
 document.addEventListener('mousedown', outside); toolbar.addEventListener('keydown', keydown);
 return { setFont, destroy() { document.removeEventListener('mousedown', outside); toolbar.removeEventListener('keydown', keydown); } };
}
