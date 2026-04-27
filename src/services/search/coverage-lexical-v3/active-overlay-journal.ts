import type { IndexedDocument } from "src/globals/search-types";
import type { ExistingShardDocVersion } from "./append-planner";
import { buildResidentHotBaseArtifacts } from "./build";
import type { ShardInvalidationEntry } from "./invalidation";
import type { ResidentShard } from "./layout/types";
import type { V3DocumentTokenizer } from "./query";

export type ActiveOverlayJournalOperation = "append" | "delete";

export type ActiveOverlayJournalEntry = Readonly<{
	id: string;
	sequence: number;
	activeShardId: string;
	activeShardGeneration: number;
	operation: ActiveOverlayJournalOperation;
	document?: IndexedDocument;
	previousVersion?: ExistingShardDocVersion | null;
	sourceBytes: number;
	createdAt: number;
}>;

export type ActiveOverlayJournalStore = Readonly<{
	appendOverlayEntries: (entries: readonly ActiveOverlayJournalEntry[]) => Promise<void>;
	loadActiveOverlayEntries: (params: {
		activeShardId: string;
		activeShardGeneration: number;
	}) => Promise<readonly ActiveOverlayJournalEntry[]>;
	clearActiveOverlayEntries: (params: {
		activeShardId: string;
		activeShardGeneration: number;
	}) => Promise<void>;
	appendEntries: (entries: readonly ActiveOverlayJournalEntry[]) => Promise<void>;
	loadEntries: (params: {
		activeShardId: string;
		activeShardGeneration: number;
	}) => Promise<readonly ActiveOverlayJournalEntry[]>;
	removeEntries: (ids: readonly string[]) => Promise<void>;
	clearEntriesForActiveShard: (params: {
		activeShardId: string;
		activeShardGeneration: number;
	}) => Promise<void>;
}>;

type AsyncOverlayTable<Row, Key> = Readonly<{
	toArray: () => Promise<Row[]>;
	bulkPut: (rows: readonly Row[]) => Promise<unknown>;
	delete: (key: Key) => Promise<unknown>;
	clear: () => Promise<unknown>;
}>;

type AsyncInvalidationTable<Row> = Readonly<{
	bulkPut: (rows: readonly Row[]) => Promise<unknown>;
}>;

type AsyncTransactionScope = Readonly<{
	transaction: (
		mode: "rw",
		...args: [...unknown[], () => Promise<void>]
	) => Promise<unknown>;
}>;

export type ActiveOverlayJournalRow = ActiveOverlayJournalEntry;
type ActiveOverlayInvalidationRow = ShardInvalidationEntry & Readonly<{ id: string }>;

export class MemoryActiveOverlayJournalStore implements ActiveOverlayJournalStore {
	private entries: ActiveOverlayJournalEntry[];

	constructor(initialEntries: readonly ActiveOverlayJournalEntry[] = []) {
		this.entries = [...initialEntries];
	}

	async appendEntries(entries: readonly ActiveOverlayJournalEntry[]): Promise<void> {
		await this.appendOverlayEntries(entries);
	}

	async appendOverlayEntries(entries: readonly ActiveOverlayJournalEntry[]): Promise<void> {
		const entryById = new Map(this.entries.map((entry) => [entry.id, entry]));
		for (const entry of entries) {
			entryById.set(entry.id, entry);
		}
		this.entries = [...sortEntries([...entryById.values()])];
	}

	async loadEntries(params: {
		activeShardId: string;
		activeShardGeneration: number;
	}): Promise<readonly ActiveOverlayJournalEntry[]> {
		return await this.loadActiveOverlayEntries(params);
	}

	async loadActiveOverlayEntries(params: {
		activeShardId: string;
		activeShardGeneration: number;
	}): Promise<readonly ActiveOverlayJournalEntry[]> {
		return sortEntries(
			this.entries.filter((entry) => isEntryForActiveShard(entry, params)),
		);
	}

	async removeEntries(ids: readonly string[]): Promise<void> {
		const removedIds = new Set(ids);
		this.entries = this.entries.filter((entry) => !removedIds.has(entry.id));
	}

	async clearEntriesForActiveShard(params: {
		activeShardId: string;
		activeShardGeneration: number;
	}): Promise<void> {
		await this.clearActiveOverlayEntries(params);
	}

	async clearActiveOverlayEntries(params: {
		activeShardId: string;
		activeShardGeneration: number;
	}): Promise<void> {
		this.entries = this.entries.filter((entry) => !isEntryForActiveShard(entry, params));
	}
}

export class DexieActiveOverlayJournalStore implements ActiveOverlayJournalStore {
	constructor(protected readonly table: AsyncOverlayTable<ActiveOverlayJournalRow, string>) {}

	async appendEntries(entries: readonly ActiveOverlayJournalEntry[]): Promise<void> {
		await this.appendOverlayEntries(entries);
	}

	async appendOverlayEntries(entries: readonly ActiveOverlayJournalEntry[]): Promise<void> {
		await this.table.bulkPut([...entries]);
	}

	async loadEntries(params: {
		activeShardId: string;
		activeShardGeneration: number;
	}): Promise<readonly ActiveOverlayJournalEntry[]> {
		return await this.loadActiveOverlayEntries(params);
	}

	async loadActiveOverlayEntries(params: {
		activeShardId: string;
		activeShardGeneration: number;
	}): Promise<readonly ActiveOverlayJournalEntry[]> {
		return sortEntries(
			(await this.table.toArray()).filter((entry) => isEntryForActiveShard(entry, params)),
		);
	}

	async removeEntries(ids: readonly string[]): Promise<void> {
		await Promise.all(ids.map((id) => this.table.delete(id)));
	}

	async clearEntriesForActiveShard(params: {
		activeShardId: string;
		activeShardGeneration: number;
	}): Promise<void> {
		await this.clearActiveOverlayEntries(params);
	}

	async clearActiveOverlayEntries(params: {
		activeShardId: string;
		activeShardGeneration: number;
	}): Promise<void> {
		const keptEntries = (await this.table.toArray()).filter(
			(entry) => !isEntryForActiveShard(entry, params),
		);
		await this.table.clear();
		await this.table.bulkPut(keptEntries);
	}
}

export class AtomicDexieActiveOverlayJournalStore extends DexieActiveOverlayJournalStore {
	constructor(
		table: AsyncOverlayTable<ActiveOverlayJournalRow, string>,
		private readonly invalidationTable: AsyncInvalidationTable<ActiveOverlayInvalidationRow>,
		private readonly transactionScope: AsyncTransactionScope,
	) {
		super(table);
	}

	async appendOverlayEntriesWithInvalidations(params: {
		entries: readonly ActiveOverlayJournalEntry[];
		invalidations: readonly ShardInvalidationEntry[];
	}): Promise<void> {
		await this.transactionScope.transaction(
			"rw",
			this.table,
			this.invalidationTable,
			async () => {
				await this.appendOverlayEntries(params.entries);
				if (params.invalidations.length > 0) {
					await this.invalidationTable.bulkPut(
						params.invalidations.map(toInvalidationRow),
					);
				}
			},
		);
	}
}

export function createDexieActiveOverlayJournalStore(
	table: AsyncOverlayTable<ActiveOverlayJournalRow, string>,
): ActiveOverlayJournalStore {
	return new DexieActiveOverlayJournalStore(table);
}

export function createAtomicDexieActiveOverlayJournalStore(params: {
	overlayTable: AsyncOverlayTable<ActiveOverlayJournalRow, string>;
	invalidationTable: AsyncInvalidationTable<ActiveOverlayInvalidationRow>;
	transactionScope: AsyncTransactionScope;
}): ActiveOverlayJournalStore {
	return new AtomicDexieActiveOverlayJournalStore(
		params.overlayTable,
		params.invalidationTable,
		params.transactionScope,
	);
}

export function buildActiveOverlayJournalEntryId(params: {
	activeShardId: string;
	activeShardGeneration: number;
	sequence: number;
}): string {
	return `${params.activeShardId}@${params.activeShardGeneration}:${params.sequence}`;
}

export function buildOverlayResidentShard(params: {
	activeShardId: string;
	activeShardGeneration: number;
	entries: readonly ActiveOverlayJournalEntry[];
	tokenizeDocumentText?: V3DocumentTokenizer;
}): ResidentShard | null {
	const documents = materializeOverlayDocuments(params.entries);
	if (documents.length === 0) {
		return null;
	}
	const artifacts = buildResidentHotBaseArtifacts(documents, params.tokenizeDocumentText);
	return {
		shardId: buildOverlayShardId(params.activeShardId),
		generation: params.activeShardGeneration,
		base: {
			...artifacts.base,
			fuzzyRescue: artifacts.fuzzyRescueIndex,
		},
	};
}

export function buildOverlayShardId(activeShardId: string): string {
	return `${activeShardId}:overlay`;
}

export function materializeOverlayDocuments(
	entries: readonly ActiveOverlayJournalEntry[],
): readonly IndexedDocument[] {
	const documentByKey = new Map<string, IndexedDocument>();
	for (const entry of sortEntries(entries)) {
		const key = buildOverlayDocumentKey(entry);
		if (entry.operation === "delete") {
			documentByKey.delete(key);
			continue;
		}
		if (entry.document != null) {
			documentByKey.set(key, entry.document);
		}
	}
	return [...documentByKey.values()];
}

function buildOverlayDocumentKey(entry: ActiveOverlayJournalEntry): string {
	const document = entry.document;
	if (document != null) {
		return `${document.docRef ?? document.path}@${document.generation ?? 0}`;
	}
	const previousVersion = entry.previousVersion;
	return previousVersion == null
		? entry.id
		: `${previousVersion.docRef}@${previousVersion.docGeneration}`;
}

function isEntryForActiveShard(
	entry: ActiveOverlayJournalEntry,
	params: { activeShardId: string; activeShardGeneration: number },
): boolean {
	return (
		entry.activeShardId === params.activeShardId &&
		entry.activeShardGeneration === params.activeShardGeneration
	);
}

function sortEntries(
	entries: readonly ActiveOverlayJournalEntry[],
): readonly ActiveOverlayJournalEntry[] {
	return [...entries].sort((left, right) => left.sequence - right.sequence);
}

function toInvalidationRow(entry: ShardInvalidationEntry): ActiveOverlayInvalidationRow {
	return {
		...entry,
		id: `${entry.shardId}@${entry.shardGeneration}:docref:${entry.docRef}@${entry.docGeneration}`,
	};
}
