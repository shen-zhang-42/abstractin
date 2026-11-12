import { ChangeSet } from '@codemirror/state';
import type { DocumentAction, EditorToHostMessage, TextChange } from '../shared/messages';

/** One acknowledged batch at a time; offsets always belong to that version. */
export class EditSync {
	private version = 0;
	private pending: ChangeSet | null = null;
	private inFlight: ChangeSet | null = null;
	private waitingAction = false;
	private flushRequested = false;
	private actions: DocumentAction[] = [];

	constructor(private readonly post: (message: EditorToHostMessage) => void) {}

	reset(version: number): void {
		this.version = version;
		this.pending = null;
		this.inFlight = null;
		this.waitingAction = this.flushRequested = false;
		this.actions = [];
	}

	add(changes: ChangeSet): void {
		this.pending = this.pending ? this.pending.compose(changes) : changes;
	}

	flush(): void {
		this.flushRequested = true;
		if (this.inFlight || this.waitingAction) return;
		if (this.pending && !this.pending.empty) {
			const changes: TextChange[] = [];
			this.pending.iterChanges((from, to, _fromB, _toB, inserted) => {
				changes.push({ from, to, insert: inserted.toString() });
			});
			this.inFlight = this.pending;
			this.pending = null;
			this.post({ type: 'edit', baseVersion: this.version, changes });
			return;
		}
		this.pending = null;
		this.flushRequested = false;
		const type = this.actions.shift();
		if (type) {
			this.waitingAction = true;
			this.post({ type });
		}
	}

	acknowledge(version: number): void {
		this.version = version;
		this.inFlight = null;
		if (this.flushRequested) this.flush();
	}

	requestAction(type: DocumentAction): void {
		this.actions.push(type);
		this.flush();
	}

	actionDone(version: number): void {
		this.version = version;
		this.waitingAction = false;
		this.flush();
	}

	/** Remote offsets refer to the acknowledged document, before pending typing. */
	receive(changes: TextChange[], version: number, localLength: number): ChangeSet {
		const remote = ChangeSet.of(changes, this.inFlight?.length ?? this.pending?.length ?? localLength);
		// An external edit may beat an in-flight batch to the host. The host
		// rejects that stale batch with init; map it here too so even the
		// intervening frame cannot apply remote offsets to the wrong text.
		const afterSent = this.inFlight ? remote.map(this.inFlight) : remote;
		const mapped = this.pending ? afterSent.map(this.pending) : afterSent;
		if (this.pending) this.pending = this.pending.map(afterSent, true);
		if (this.inFlight) this.inFlight = this.inFlight.map(remote, true);
		this.version = version;
		return mapped;
	}
}
