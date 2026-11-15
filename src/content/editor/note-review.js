import { StateEffect, StateField, RangeSet } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, lineNumbers, gutter, GutterMarker } from '@codemirror/view';

class RemovedLines extends WidgetType {
 constructor(text, line) { super(); this.text = text; this.line = line; }
 eq(other) { return other.text === this.text && other.line === this.line; }
 toDOM(view) {
  const doc = view.dom.ownerDocument, block = doc.createElement('div');
  block.className = 'note-ai-deletion'; block.contentEditable = 'false'; block.setAttribute('aria-label', 'Removed lines (not in the saved note)');
  for (const [index, text] of this.text.split('\n').entries()) {
   const row = doc.createElement('div'), number = doc.createElement('span'), content = doc.createElement('span');
   row.className = 'note-ai-deleted-line'; number.className = 'note-ai-deleted-number'; number.textContent = (this.line + index) + ' −'; content.textContent = text || ' ';
   row.append(number, content); block.append(row);
  }
  return block;
 }
}
const changedLines = (doc, ranges) => {
 const lines = new Map();
 for (const range of ranges) {
  const first = doc.lineAt(range.from), last = doc.lineAt(Math.max(range.from, range.to - 1));
  for (let number = first.number; number <= last.number; number++) lines.set(doc.line(number).from, range.to > range.from ? '+' : lines.get(first.from) || '−');
 }
 return lines;
};

export const reviewRangesEffect = StateEffect.define();
export const reviewRangesField = StateField.define({
 create: () => [],
 update(ranges, transaction) {
  if (transaction.docChanged) ranges = ranges.map(range => ({ ...range,
   from: transaction.changes.mapPos(range.from, -1),
   to: transaction.changes.mapPos(range.to, 1),
  }));
  for (const effect of transaction.effects) if (effect.is(reviewRangesEffect)) ranges = effect.value;
  return ranges;
 },
 provide: field => EditorView.decorations.compute([field], state => {
  const ranges = state.field(field), decorations = [], removed = new Set();
  for (const [from, sign] of changedLines(state.doc, ranges)) if (sign === '+') decorations.push(Decoration.line({ class: 'note-ai-changed note-ai-added' }).range(from));
  for (const range of ranges) if (range.removed) {
   const from = state.doc.lineAt(range.from).from, key = from + ':' + range.oldLine + ':' + range.removed;
   if (removed.has(key)) continue; removed.add(key);
   decorations.push(Decoration.widget({ widget: new RemovedLines(range.removed, range.oldLine || 1), block: true, side: -1 }).range(from));
  }
  return Decoration.set(decorations, true);
 }),
});

// Rendered tables replace source lines with widgets. Mark the matching rows as
// well, without modifying their contents or interfering with cell focus.
const tableReview = ViewPlugin.fromClass(class {
 constructor(view) { this.view = view; this.schedule(); }
 update(update) {
  if (update.docChanged || update.viewportChanged || update.selectionSet && update.state.field(reviewRangesField).length ||
   update.transactions.some(transaction => transaction.effects.some(effect => effect.is(reviewRangesEffect)))) this.schedule();
 }
 schedule() {
  if (this.frame) return;
  this.frame = this.view.dom.ownerDocument.defaultView.requestAnimationFrame(() => {
   this.frame = null;
   const ranges = this.view.state.field(reviewRangesField), doc = this.view.state.doc;
   for (const row of this.view.dom.querySelectorAll('.mlp-table tr')) {
    const cell = row.querySelector('[data-mlp-from]');
    const from = Number(cell?.dataset.mlpFrom);
    const line = cell && from <= doc.length ? doc.lineAt(from) : null;
    const changed = !!line && ranges.some(range => range.to > range.from && range.from <= line.to && range.to - 1 >= line.from);
    row.classList.toggle('note-ai-changed', changed); row.classList.toggle('note-ai-added', changed);
   }
  });
 }
 destroy() { if (this.frame) this.view.dom.ownerDocument.defaultView.cancelAnimationFrame(this.frame); }
});

class ChangeMarker extends GutterMarker {
 constructor(sign) { super(); this.sign = sign; }
 eq(other) { return other.sign === this.sign; }
 toDOM(view) { const node = view.dom.ownerDocument.createElement('span'); node.textContent = this.sign; node.className = this.sign === '+' ? 'note-ai-plus' : this.sign === '−' ? 'note-ai-minus' : ''; return node; }
}
const addedMarker = new ChangeMarker('+'), removedMarker = new ChangeMarker('−');
export const noteReview = [reviewRangesField, tableReview, lineNumbers(), gutter({
 class: 'note-change-gutter',
 markers: view => RangeSet.of([...changedLines(view.state.doc, view.state.field(reviewRangesField))].sort(([a], [b]) => a - b).map(([from, sign]) => (sign === '+' ? addedMarker : removedMarker).range(from))),
 initialSpacer: () => new ChangeMarker(''),
}), EditorView.baseTheme({
 '.cm-line.note-ai-added, tr.note-ai-added > :is(td, th)': { backgroundColor: 'rgba(50, 160, 90, .13)', boxShadow: 'inset 3px 0 0 rgba(50, 160, 90, .65)' },
 '.note-ai-deletion': { backgroundColor: 'rgba(210, 50, 50, .12)', boxShadow: 'inset 3px 0 0 rgba(210, 50, 50, .6)', fontSize: '.95em', userSelect: 'text' },
 '.note-ai-deleted-line': { display: 'flex', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: '1.8' },
 '.note-ai-deleted-number': { flex: '0 0 5ch', paddingRight: '8px', opacity: '.7', textAlign: 'right', fontFamily: 'monospace', userSelect: 'none' },
 '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--editor-faint,GrayText)', border: 'none' },
 '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch', paddingRight: '3px' },
 '.note-change-gutter .cm-gutterElement': { width: '2ch', textAlign: 'center', padding: '0' },
 '.note-ai-plus': { color: '#32834b' }, '.note-ai-minus': { color: '#bd4646' },
})];
