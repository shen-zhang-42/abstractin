import { EditorSelection, EditorState, Facet, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, undo, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from './gfmTableFix';
import { parser } from '@lezer/markdown';

const inlineParser = parser.configure({ remove: ['HTMLBlock'] });

export const cellInlinePreview = Facet.define<boolean, boolean>({ combine: values => values.some(Boolean) });
export const tableHistoryRequest = Facet.define<(type: 'undo' | 'redo') => void>();

export function cellEditorText(source: string): string {
	const breaks: { from: number; to: number }[] = [];
	inlineParser.parse(source).iterate({ enter(node) {
		if (node.name === 'HTMLTag' && /^<br\s*\/?>$/i.test(source.slice(node.from, node.to))) breaks.push({ from: node.from, to: node.to });
	} });
	let text = source;
	for (const { from, to } of breaks.reverse()) text = text.slice(0, from) + '\n' + text.slice(to);
	return text;
}

export function cellEditorSource(text: string): string {
	return text.replace(/\r\n?|\n/g, '<br>');
}

/** A cell uses the same caret-aware inline decorations as ordinary prose. */
export function createCellEditor(
	cell: HTMLElement,
	source: string,
	caret: 'all' | 'end' | { x: number; y: number },
	preview: Extension,
	onKey: (event: KeyboardEvent) => void,
	onHistory: (type: 'undo' | 'redo') => void,
): EditorView {
	const doc = cellEditorText(source);
	cell.textContent = '';
	const editor = new EditorView({
		parent: cell,
		state: EditorState.create({
			doc,
			selection: caret === 'all' ? EditorSelection.single(0, doc.length) : { anchor: doc.length },
			extensions: [
				markdown({ extensions: GFM }), cellInlinePreview.of(true), preview, history(),
				EditorView.editorAttributes.of({ class: 'mlp-cell-editor' }),
				EditorView.lineWrapping,
				keymap.of([
					{ key: 'Mod-z', run: view => { if (!undo(view)) onHistory('undo'); return true; } },
					{ key: 'Mod-y', run: view => { if (!redo(view)) onHistory('redo'); return true; } },
					{ key: 'Mod-Shift-z', run: view => { if (!redo(view)) onHistory('redo'); return true; } },
					// Tab and finishing/cancelling belong to the table. Native CM keys
					// keep deletion and arrows within this cell's own document.
					...defaultKeymap.filter(binding => !['Enter', 'Mod-Enter'].includes(binding.key ?? '')),
				]),
				EditorView.domEventHandlers({
					keydown(event) {
						onKey(event);
						event.stopPropagation();
						return event.defaultPrevented;
					},
					beforeinput(event) { event.stopPropagation(); return false; },
					mousedown(event) { event.stopPropagation(); return false; },
					mouseup(event) { event.stopPropagation(); return false; },
					click(event) { event.stopPropagation(); return false; },
				}),
			],
		}),
	});
	if (typeof caret === 'object') {
		const pos = editor.posAtCoords(caret);
		if (pos !== null) editor.dispatch({ selection: { anchor: pos } });
	}
	editor.focus();
	return editor;
}
