// Fixed note-editor bindings. The same catalog supplies the in-app reference.
export const markdownShortcuts = [
 { key: "Mod-b", action: "bold", label: "Bold" },
 { key: "Mod-i", action: "italic", label: "Italic" },
 { key: "Mod-Shift-x", action: "strike", label: "Strikethrough" },
 { key: "Mod-e", action: "code", label: "Inline code" },
 { key: "Mod-k", action: "link", label: "Link" },
 { key: "Mod-Shift-k", action: "fence", label: "Code block" },
 ...[1, 2, 3, 4, 5, 6].map(level => ({ key: "Mod-Alt-" + level, action: "heading" + level, label: "Heading " + level })),
 { key: "Mod-Alt-0", action: "heading0", label: "Plain paragraph" },
 { key: "Mod-Shift-8", action: "bullet", label: "Bullet list" },
 { key: "Mod-Shift-7", action: "number", label: "Numbered list" },
 { key: "Mod-Shift-l", action: "task", label: "Task list" },
 { key: "Mod-Shift-9", action: "quote", label: "Blockquote" },
];

