import Vditor from 'vditor';
import { createVditorNote } from './note-vditor.js';

// Loaded exclusively by NoteOut, never by ordinary literature discussions.
window.AbstractInComposer = { create: config => createVditorNote(config, Vditor) };
