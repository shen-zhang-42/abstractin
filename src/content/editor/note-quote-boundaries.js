import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// CommonMark accepts unmarked prose as a lazy quote continuation. During user
// edits, keep an explicit paragraph boundary instead. The saved Markdown then
// has the same meaning in Zotero, exports and the editor, without a custom parser.
export const noteQuoteBoundaries = EditorState.transactionFilter.of(transaction => {
 if (!transaction.docChanged || transaction.isUserEvent('input.ai') ||
     !(transaction.isUserEvent('input') || transaction.isUserEvent('delete'))) return transaction;

 const doc = transaction.newDoc;
 const tree = syntaxTree(transaction.state), candidates = new Set();
 transaction.changes.iterChangedRanges((_from, _to, from, to) => {
  const first = Math.max(2, doc.lineAt(from).number);
  const last = Math.min(doc.lines, doc.lineAt(to).number + 1);
  for (let number = first; number <= last; number++) candidates.add(number);
 });
 const changes = [];
 for (const number of candidates) {
  const previous = doc.line(number - 1), line = doc.line(number);
  if (!/^ {0,3}>/.test(previous.text) || !line.text.trim() || /^\s*>/.test(line.text)) continue;
  // Only a genuine lazy paragraph continuation needs a separator. Fenced code,
  // explicit quote continuations and blocks that already end the quote stay literal.
  let node = tree.resolveInner(line.from + line.text.search(/\S/), 1);
  let paragraph = false, quote = false, literal = false;
  for (; node; node = node.parent) {
   if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'Table'].includes(node.name)) literal = true;
   if (node.name === 'Paragraph') paragraph = true;
   if (node.name === 'Blockquote') quote = true;
  }
  if (paragraph && quote && !literal) changes.push({ from: line.from, insert: '\n' });
 }
 if (!changes.length) return transaction;
 changes.sort((a, b) => a.from - b.from);
 const separators = transaction.state.changes(changes);
 return [transaction, {
  changes: separators,
  // A backward deletion lands on the separator, so the caret can continue into
  // the previous line instead of repeatedly getting stuck at the same position.
  selection: transaction.newSelection.map(separators, -1),
  sequential: true,
 }];
});
