import test from "node:test";
import assert from "node:assert/strict";
import { latexSourceBlocks, latexHighlightRanges } from "../src/content/editor/latex-highlights.js";

test("unfinished inline and multiline formulas highlight immediately without consuming following prose", () => {
	const text = "Before $x+1\nNormal prose\n$$\\frac{a}{b}\n+c";
	const blocks = latexSourceBlocks(text);
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].complete, false);
	assert.equal(text.slice(blocks[0].start, blocks[0].end), "$x+1");
	assert.equal(blocks[1].complete, false);
	assert.equal(text.slice(blocks[1].start, blocks[1].end), "$$\\frac{a}{b}\n+c");
	assert.equal(latexSourceBlocks("$ ")[0].complete, false);
	assert.equal(latexSourceBlocks("$")[0].end, 1);
});

test("highlighting distinguishes both delimiters, contents and LaTeX syntax", () => {
	const text = String.raw`Before $\frac{x_1+23}{\alpha}$ after`;
	const [block] = latexSourceBlocks(text);
	const ranges = latexHighlightRanges(text, block);
	const sources = kind => ranges.filter(range => range.className === "composer-latex-" + kind).map(range => text.slice(range.from, range.to));
	assert.deepEqual(sources("delimiter"), ["$", "$"]);
	assert.deepEqual(sources("content"), [String.raw`\frac{x_1+23}{\alpha}`]);
	assert.deepEqual(sources("command"), [String.raw`\frac`, String.raw`\alpha`]);
	assert.deepEqual(sources("bracket"), ["{", "}", "{", "}"]);
	assert.deepEqual(sources("number"), ["1", "23"]);
	assert.deepEqual(sources("operator"), ["_", "+"]);
	for (const range of ranges) assert.ok(range.from >= block.start && range.to <= block.end && range.to > range.from);
});

test("escaped dollar signs stay literal and comments do not highlight embedded commands", () => {
	const text = String.raw`Price \$5, $$a+\$b % \alpha{123}` + "\n+c$$ after";
	const blocks = latexSourceBlocks(text);
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].complete, true);
	const ranges = latexHighlightRanges(text, blocks[0]);
	const sources = kind => ranges.filter(range => range.className === "composer-latex-" + kind).map(range => text.slice(range.from, range.to));
	assert.deepEqual(sources("delimiter"), ["$$", "$$"]);
	assert.deepEqual(sources("command"), [String.raw`\$`]);
	assert.deepEqual(sources("comment"), [String.raw`% \alpha{123}`]);
	assert.deepEqual(sources("number"), []);
});
