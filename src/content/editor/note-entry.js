import { createLiveNote } from './note-live.js';

// Loaded exclusively by NoteOut, never by ordinary literature discussions.
window.AbstractInComposer = { create: createLiveNote };
