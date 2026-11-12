import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { extractHeadings, headingAtLine, type HeadingItem } from '../shared/headings';
import type { DocumentOutline } from '../shared/messages';

/** Keep headings and cursor position together while the host's edits are debounced. */
export function outlineTrackingExtension(post: (outline: DocumentOutline) => void) {
	return ViewPlugin.fromClass(class {
		private headings: HeadingItem[];
		private activeHeadingLine: number | null;

		constructor(view: EditorView) {
			this.headings = extractHeadings(view.state.doc.toString());
			this.activeHeadingLine = this.headingFor(view);
			this.publish();
		}

		update(update: ViewUpdate): void {
			if (!update.docChanged && !update.selectionSet) return;
			let headingsChanged = false;
			if (update.docChanged) {
				const next = extractHeadings(update.state.doc.toString());
				headingsChanged = next.length !== this.headings.length || next.some((heading, index) => {
					const previous = this.headings[index];
					return heading.line !== previous.line || heading.level !== previous.level || heading.text !== previous.text;
				});
				if (headingsChanged) this.headings = next;
			}
			const active = this.headingFor(update.view);
			if (headingsChanged || active !== this.activeHeadingLine) {
				this.activeHeadingLine = active;
				this.publish();
			}
		}

		private headingFor(view: EditorView): number | null {
			const line = view.state.doc.lineAt(view.state.selection.main.head).number;
			return headingAtLine(this.headings, line)?.line ?? null;
		}

		private publish(): void {
			post({ headings: this.headings, activeHeadingLine: this.activeHeadingLine });
		}
	});
}
