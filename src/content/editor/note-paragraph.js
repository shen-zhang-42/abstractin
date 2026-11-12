import Paragraph from '@tiptap/extension-paragraph';

// A rich-text paragraph may contain literal leading tabs/spaces. Serialize those
// as entities so reopening Markdown cannot reinterpret the paragraph as code.
// Explicit codeBlock nodes retain their normal fenced-code representation.
export const NoteParagraph = Paragraph.extend({
 renderMarkdown(node, helpers, context) {
  return this.parent(node, helpers, context).replace(/^[ \t]+/gm, prefix => {
   let columns = 0;
   for (const character of prefix) columns += character === '\t' ? 4 - columns % 4 : 1;
   return columns >= 4 ? prefix.replace(/ /g, '&#32;').replace(/\t/g, '&#9;') : prefix;
  });
 },
});
