import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

let queue = Promise.resolve();
const cache = new Map();
const pending = new Map();
function svgNode(svg) {
 const node = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
 if (node.localName !== 'svg') throw new Error('TikZJax returned invalid SVG.');
 // TeX specials must never add executable markup to the note document.
 node.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(element => element.remove());
 for (const element of [node, ...node.querySelectorAll('*')]) for (const attribute of [...element.attributes]) {
  if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && !attribute.value.startsWith('#'))) element.removeAttributeNode(attribute);
 }
 const width = node.getAttribute('width');
 if (width?.endsWith('pt')) node.style.width = (parseFloat(width) * 1.5) + 'pt';
 return node;
}
function render(source) {
 if (pending.has(source)) return pending.get(source);
 if (!document.querySelector('[data-tikz-fonts]')) {
  const fonts = document.createElement('link'); fonts.rel = 'stylesheet'; fonts.href = new URL('./tikzjax/fonts.css', location.href).href; fonts.dataset.tikzFonts = 'true'; document.head.append(fonts);
 }
 const job = queue.then(() => new Promise((resolve, reject) => {
  // Isolate the engine's DOM observer and TeX state from CodeMirror. Dispose
  // the frame (and its Worker) after each compile; unchanged SVGs stay cached.
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-10000px;width:1px;height:1px;visibility:hidden';
  frame.setAttribute('aria-hidden', 'true');
  let finished = false;
  const finish = (error, svg) => { if (finished) return; finished = true; clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); error ? reject(error) : resolve(svg); };
  const receive = event => {
   if (event.source !== frame.contentWindow) return;
   // Gecko resource frames can omit the parent's iframe load notification.
   // The child's explicit handshake works in Zotero and ordinary browsers.
   if (event.data?.type === 'tikz-ready') { frame.contentWindow.postMessage({ type: 'render-tikz', source }, '*'); return; }
   if (event.data?.type !== 'tikz-result') return;
   finish(event.data.error ? new Error(event.data.error) : null, event.data.svg);
  };
  const timer = setTimeout(() => finish(new Error('Diagram compilation timed out after 60 seconds; edit its source to retry.')), 60000);
  window.addEventListener('message', receive);
  frame.onerror = () => finish(new Error('TikZJax compiler page could not be loaded.'));
  frame.src = new URL('./tikz-renderer.html', location.href).href; document.body.append(frame);
 }));
 pending.set(source, job);
 const cleanup = () => pending.delete(source);
 job.then(cleanup, cleanup);
 queue = job.catch(() => {}); return job;
}
class Diagram extends WidgetType {
 constructor(source, from, editAt) { super(); Object.assign(this, { source, from, editAt }); }
 eq(other) { return this.source === other.source && this.from === other.from; }
 toDOM(view) {
  const host = document.createElement('div'); host.className = 'note-diagram';
  const tools = document.createElement('div'), edit = document.createElement('button'), status = document.createElement('span'), preview = document.createElement('div');
  tools.className = 'note-diagram-tools'; preview.className = 'note-diagram-preview'; edit.type = 'button'; edit.textContent = 'Edit source';
  status.textContent = 'Loading diagram…';
  edit.addEventListener('mousedown', event => event.preventDefault());
  edit.addEventListener('click', () => { if (view.state.readOnly) return; view.dispatch({ selection: { anchor: this.editAt }, scrollIntoView: true }); view.focus(); });
  tools.append(status, edit); host.append(tools, preview);
  const started = performance.now();
  const complete = () => { host.dataset.ready = 'true'; const ms = Math.round(performance.now() - started); status.textContent = 'tikz-cd · ' + ms + ' ms'; view.requestMeasure(); };
  if (cache.has(this.source)) {
   preview.append(svgNode(cache.get(this.source))); complete();
  } else {
   render(this.source).then(svg => {
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(this.source, svg);
    if (!host.isConnected) return;
    preview.append(svgNode(svg)); complete();
   }).catch(error => { status.textContent = error.message; host.dataset.error = 'true'; });
  }
  return host;
 }
 ignoreEvent() { return true; }
}
function decorate(state) {
 const result = [];
 syntaxTree(state).iterate({ enter(node) {
  if (node.name !== 'FencedCode') return;
  const info = node.node.getChild('CodeInfo');
  if (!info || state.sliceDoc(info.from, info.to).trim() !== 'tikzcd') return;
  if (state.selection.ranges.some(range => range.from <= node.to && range.to >= node.from)) return false;
  const code = node.node.getChild('CodeText');
  if (code) result.push(Decoration.replace({ widget: new Diagram(state.sliceDoc(code.from, code.to), node.from, code.from), block: true }).range(node.from, node.to));
  return false;
 } });
 return Decoration.set(result, true);
}
const diagrams = StateField.define({ create: decorate, update(value, tr) { return tr.docChanged || tr.selection || tr.reconfigured || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? decorate(tr.state) : value; }, provide: field => EditorView.decorations.from(field) });
export const noteDiagrams = diagrams;
