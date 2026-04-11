import type {
	CoverageLexicalV2IndexStoreJournalEntry,
	CoverageLexicalV2IndexStoreSnapshotState,
} from "./coverage-lexical-v2-index-store-types";

const SNAPSHOT_MAGIC = "clxv2idx";
const SNAPSHOT_VERSION = 2;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type CoverageLexicalV2EncodedSnapshotEnvelope = {
	magic: typeof SNAPSHOT_MAGIC;
	version: typeof SNAPSHOT_VERSION;
	state: CoverageLexicalV2IndexStoreSnapshotState;
};

export function encodeCoverageLexicalV2IndexStoreSnapshot(
	state: CoverageLexicalV2IndexStoreSnapshotState,
): ArrayBuffer {
	const envelope: CoverageLexicalV2EncodedSnapshotEnvelope = {
		magic: SNAPSHOT_MAGIC,
		version: SNAPSHOT_VERSION,
		state,
	};
	return textEncoder.encode(JSON.stringify(envelope)).buffer;
}

export function decodeCoverageLexicalV2IndexStoreSnapshot(
	data: ArrayBuffer,
): CoverageLexicalV2IndexStoreSnapshotState {
	const encoded = JSON.parse(
		textDecoder.decode(new Uint8Array(data)),
	) as Partial<CoverageLexicalV2EncodedSnapshotEnvelope> | null;
	if (!encoded || encoded.magic !== SNAPSHOT_MAGIC || encoded.version !== SNAPSHOT_VERSION) {
		throw new Error("Unsupported coverage lexical V2 index-store snapshot");
	}
	if (
		!encoded.state ||
		typeof encoded.state.schemaVersion !== "number" ||
		!Array.isArray(encoded.state.documents) ||
		!Array.isArray(encoded.state.segments) ||
		!encoded.state.overlay
	) {
		throw new Error("Invalid coverage lexical V2 index-store snapshot payload");
	}
	return encoded.state;
}

export function encodeCoverageLexicalV2IndexStoreJournalEntry(
	entry: CoverageLexicalV2IndexStoreJournalEntry,
): string {
	return JSON.stringify(entry);
}

export function decodeCoverageLexicalV2IndexStoreJournalEntry(
	value: string,
): CoverageLexicalV2IndexStoreJournalEntry {
	const entry = JSON.parse(value) as CoverageLexicalV2IndexStoreJournalEntry | null;
	if (
		!entry ||
		typeof entry !== "object" ||
		typeof entry.kind !== "string" ||
		typeof entry.path !== "string" ||
		typeof entry.updatedAt !== "number" ||
		!entry.transaction ||
		typeof entry.transaction.transactionId !== "string"
	) {
		throw new Error("Invalid coverage lexical V2 index-store journal entry");
	}
	return entry;
}
