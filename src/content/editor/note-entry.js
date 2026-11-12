import { createRichNote } from './note-rich.js';

// Loaded exclusively by NoteOut, never by ordinary literature discussions.
window.AbstractInComposer = { create: createRichNote };
