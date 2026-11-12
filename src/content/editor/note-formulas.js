import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Reuse AbstractIn's existing delimiter scanner. This adapter adds only formula
// display/editing; the upstream editor still owns all other editing behavior.
class Formula extends WidgetType {
 constructor(token) { super(); this.token = token; }
 eq(other) { return this.token.source === other.token.source && this.token.start === other.token.start; }
 toDOM(view) {
  const node = document.createElement(this.token.display ? 'div' : 'span');
  node.className = 'note-formula'; node.title = 'Click to edit LaTeX';
  katex.render(this.token.tex, node, { displayMode: this.token.display, throwOnError: false, trust: false });
  node.addEventListener('mousedown', event => {
   if (event.button !== 0 || view.state.readOnly) return;
   event.preventDefault();
   view.dispatch({ selection: { anchor: this.token.end - (this.token.display ? 2 : 1) }, scrollIntoView: true });
   view.focus();
  });
  return node;
 }
 ignoreEvent() { return true; }
}
export function noteFormulas(tokens) {
function decorate(state) {
 const excluded = [];
 syntaxTree(state).iterate({ enter(node) { if (['FencedCode', 'CodeBlock', 'InlineCode', 'Table'].includes(node.name)) { excluded.push([node.from, node.to]); return false; } } });
 const found = tokens(state.doc.toString());
 return Decoration.set(found.filter(token =>
  !excluded.some(([from, to]) => token.start < to && token.end > from) &&
  !state.selection.ranges.some(range => range.from <= token.end && range.to >= token.start)
 ).map(token => Decoration.replace({ widget: new Formula(token), block: token.display }).range(token.start, token.end)), true);
}
const math = StateField.define({ create: decorate, update(value, transaction) { return transaction.docChanged || transaction.selection || transaction.reconfigured || syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ? decorate(transaction.state) : value; }, provide: field => EditorView.decorations.from(field) });
return math;
}
