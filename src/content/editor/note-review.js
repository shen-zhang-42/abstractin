import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';

export const reviewRangesEffect = StateEffect.define();
export const reviewRangesField = StateField.define({
 create: () => [],
 update(ranges, transaction) {
  if (transaction.docChanged) ranges = ranges.map(range => ({
   from: transaction.changes.mapPos(range.from, -1),
   to: transaction.changes.mapPos(range.to, 1),
  }));
  for (const effect of transaction.effects) if (effect.is(reviewRangesEffect)) ranges = effect.value;
  return ranges;
 },
 provide: field => EditorView.decorations.compute([field], state => {
  const lines = new Set();
  for (const range of state.field(field)) {
   const first = state.doc.lineAt(range.from), last = state.doc.lineAt(Math.max(range.from, range.to - 1));
   for (let number = first.number; number <= last.number; number++) lines.add(state.doc.line(number).from);
  }
  return Decoration.set([...lines].sort((a, b) => a - b).map(from => Decoration.line({ class: 'note-ai-changed' }).range(from)));
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
    row.classList.toggle('note-ai-changed', !!line && ranges.some(range => range.from <= line.to && Math.max(range.from, range.to - 1) >= line.from));
   }
  });
 }
 destroy() { if (this.frame) this.view.dom.ownerDocument.defaultView.cancelAnimationFrame(this.frame); }
});

export const noteReview = [reviewRangesField, tableReview, EditorView.baseTheme({
 '.cm-line.note-ai-changed, tr.note-ai-changed > :is(td, th)': {
  color: '#c43434', backgroundColor: 'rgba(210, 50, 50, .09)', boxShadow: 'inset 3px 0 0 rgba(210, 50, 50, .7)',
 },
 '&dark .cm-line.note-ai-changed, &dark tr.note-ai-changed > :is(td, th)': { color: '#ff9999' },
})];
