// Source ranges include unfinished formulas, so highlighting starts as soon as
// the opening delimiter is typed. Offsets refer to CodeMirror's plain document.
export function latexSourceBlocks(text) {
	const blocks = [];
	const escaped = index => {
		let slashes = 0;
		while (index > 0 && text[--index] === "\\") slashes++;
		return slashes % 2 === 1;
	};
	for (let start = 0; start < text.length; start++) {
		if (text[start] !== "$" || escaped(start)) continue;
		const size = text[start + 1] === "$" ? 2 : 1;
		const contentStart = start + size;
		let close = contentStart, complete = false;
		for (; close < text.length; close++) {
			if (size === 1 && text[close] === "\n") break;
			if (text[close] !== "$" || escaped(close)) continue;
			if (size === 2 && text[close + 1] !== "$") continue;
			if (size === 1 && text[close + 1] === "$") break;
			complete = true;
			break;
		}
		const end = close + (complete ? size : 0);
		blocks.push({ start, end, contentStart, contentEnd: close, size, complete });
		start = Math.max(start, end - 1);
	}
	return blocks;
}

export function latexHighlightRanges(text, block) {
	const ranges = [{ from: block.start, to: block.contentStart, className: "composer-latex-delimiter" }];
	if (block.complete) ranges.push({ from: block.contentEnd, to: block.end, className: "composer-latex-delimiter" });
	if (block.contentEnd > block.contentStart) {
		ranges.push({ from: block.contentStart, to: block.contentEnd, className: "composer-latex-content" });
		const body = text.slice(block.contentStart, block.contentEnd);
		const pattern = /%[^\n]*|\\(?:[A-Za-z]+|[^A-Za-z\s])|[{}\[\]()]|\d+(?:\.\d+)?|[_^&=+\-*/<>|,:;!]/g;
		for (const match of body.matchAll(pattern)) {
			const value = match[0];
			const kind = value[0] === "%" ? "comment" : value[0] === "\\" ? "command"
				: /^[{}\[\]()]$/.test(value) ? "bracket" : /^\d/.test(value) ? "number" : "operator";
			ranges.push({ from: block.contentStart + match.index, to: block.contentStart + match.index + value.length, className: "composer-latex-" + kind });
		}
	}
	return ranges;
}
