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
 const fontControl = document.createElement('div'); fontControl.className = 'note-font-control';
 const font = document.createElement('button'); font.type = 'button'; font.className = 'note-font-button';
 font.setAttribute('aria-label', 'Note display font'); font.title = 'Display font'; font.setAttribute('aria-expanded', 'false'); font.setAttribute('aria-haspopup', 'listbox');
 const fontMenu = document.createElement('div'); fontMenu.className = 'note-font-menu'; fontMenu.hidden = true;
 fontMenu.setAttribute('role', 'listbox'); fontMenu.setAttribute('aria-label', 'Display fonts');
 const closeFont = () => { fontMenu.hidden = true; font.setAttribute('aria-expanded', 'false'); };
 for (const [value, label, family] of fonts) {
  const option = document.createElement('button'); option.type = 'button'; option.dataset.font = value;
  option.setAttribute('role', 'option'); option.textContent = label; option.style.fontFamily = family;
  option.onclick = () => { setFont(value); closeFont(); font.focus(); config.onFontChange?.(value); };
  fontMenu.append(option);
 }
 let current;
 const setFont = value => {
  const selected = fonts.find(item => item[0] === value) || fonts[0];
  font.dataset.font = selected[0]; font.textContent = selected[1];
  for (const option of fontMenu.children) option.setAttribute('aria-selected', String(option.dataset.font === selected[0]));
  if (current === selected[0]) return false; current = selected[0];
  document.documentElement.style.setProperty('--note-display-font', selected[2]);
  return true;
 };
 setFont(config.font);
 font.onclick = () => { fontMenu.hidden = !fontMenu.hidden; font.setAttribute('aria-expanded', String(!fontMenu.hidden)); };
 fontControl.append(font, fontMenu); toolbar.prepend(fontControl);
 fontControl.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation(); fontMenu.hidden = false; font.setAttribute('aria-expanded', 'true');
  const options = [...fontMenu.children], currentIndex = options.indexOf(document.activeElement);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : currentIndex < 0 ? event.key === 'ArrowUp' ? options.length - 1 : 0 : (currentIndex + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
  options[index].focus();
 });

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
 const outside = event => { if (!panel.contains(event.target) && event.target !== help) close(); if (!fontControl.contains(event.target)) closeFont(); };
 const keydown = event => {
  if (event.key !== 'Escape') return;
  if (!fontMenu.hidden) { closeFont(); font.focus(); event.preventDefault(); event.stopPropagation(); }
  if (!panel.hidden) { close(); help.focus(); event.preventDefault(); event.stopPropagation(); }
 };
 document.addEventListener('mousedown', outside); toolbar.addEventListener('keydown', keydown);
 return { setFont, destroy() { document.removeEventListener('mousedown', outside); toolbar.removeEventListener('keydown', keydown); } };
}
