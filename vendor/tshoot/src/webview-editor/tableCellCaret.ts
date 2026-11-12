/** Native contenteditable navigation can leave a table cell at visual edges. */
export function keepTableCellCaretInside(event: KeyboardEvent, cell: HTMLElement): void {
	if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace', 'Delete', 'Home', 'End'].includes(event.key)) return;
	const selection = cell.ownerDocument.getSelection();
	if (!selection?.focusNode || !cell.contains(selection.focusNode)) {
		event.preventDefault();
		return;
	}
	const moveToBoundary = (end: boolean) => {
		const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
		const first = walker.nextNode();
		let last = first;
		while (walker.nextNode()) last = walker.currentNode;
		const node = (end ? last : first) ?? cell;
		const offset = end ? (node === cell ? cell.childNodes.length : node.textContent?.length ?? 0) : 0;
		if (event.shiftKey) selection.extend(node, offset);
		else selection.collapse(node, offset);
	};
	if ((event.key === 'Home' || event.key === 'End') && (event.ctrlKey || event.metaKey)) {
		event.preventDefault();
		moveToBoundary(event.key === 'End');
		return;
	}
	const before = cell.ownerDocument.createRange();
	before.selectNodeContents(cell);
	before.setEnd(selection.focusNode, selection.focusOffset);
	const atStart = before.toString().length === 0;
	const atEnd = before.toString().length === (cell.textContent ?? '').length;
	if ((event.key === 'ArrowLeft' && atStart) || (event.key === 'ArrowRight' && atEnd) ||
		(selection.isCollapsed && ((event.key === 'Backspace' && atStart) || (event.key === 'Delete' && atEnd)))) {
		event.preventDefault();
		if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey) moveToBoundary(event.key === 'ArrowRight');
		return;
	}
	if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
	const content = cell.ownerDocument.createRange();
	content.selectNodeContents(cell);
	const textRects = Array.from(content.getClientRects()).filter(rect => rect.height > 0);
	const caret = cell.ownerDocument.createRange();
	caret.setStart(selection.focusNode, selection.focusOffset);
	caret.collapse(true);
	const caretRect = caret.getBoundingClientRect();
	const firstLine = !textRects.length || (caretRect.height === 0 ? atStart : caretRect.top <= Math.min(...textRects.map(rect => rect.top)) + 1);
	const lastLine = !textRects.length || (caretRect.height === 0 ? atEnd : caretRect.bottom >= Math.max(...textRects.map(rect => rect.bottom)) - 1);
	if ((event.key === 'ArrowUp' && firstLine) || (event.key === 'ArrowDown' && lastLine)) {
		event.preventDefault();
		moveToBoundary(event.key === 'ArrowDown');
	}
}
