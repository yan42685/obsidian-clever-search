import {
	estimateDocumentSourceBytes,
	type ActiveShardAppendChange,
} from "./append-planner";
import {
	buildActiveOverlayJournalEntryId,
	buildOverlayShardId,
	type ActiveOverlayJournalEntry,
	type ActiveOverlayJournalStore,
} from "./active-overlay-journal";
import type { ResidentShardDescriptor } from "./shards";
import {
	recordShardInvalidationStaleStats,
	type CoverageLexicalV3ProductionStores,
} from "./stores";

export type ActiveOverlayWriteResult = Readonly<{
	entries: readonly ActiveOverlayJournalEntry[];
	invalidationCount: number;
}>;

export type ActiveOverlayWritePlan = Readonly<{
	entries: readonly ActiveOverlayJournalEntry[];
	invalidations: Parameters<CoverageLexicalV3ProductionStores["invalidations"]["appendInvalidations"]>[0];
}>;

export type ActiveOverlayWriteAtomicStore = Readonly<{
	appendOverlayEntriesWithInvalidations: (params: {
		entries: readonly ActiveOverlayJournalEntry[];
		invalidations: Parameters<CoverageLexicalV3ProductionStores["invalidations"]["appendInvalidations"]>[0];
	}) => Promise<void>;
}>;

export async function writeActiveOverlayChanges(params: {
	stores: CoverageLexicalV3ProductionStores;
	overlayJournalStore: ActiveOverlayJournalStore;
	activeShard: ResidentShardDescriptor;
	changes: readonly ActiveShardAppendChange[];
	sequenceStart: number;
	now?: number;
}): Promise<ActiveOverlayWriteResult> {
	const plan = planActiveOverlayChanges(params);
	await commitActiveOverlayWritePlan({
		stores: params.stores,
		overlayJournalStore: params.overlayJournalStore,
		plan,
	});
	return {
		entries: plan.entries,
		invalidationCount: plan.invalidations.length,
	};
}

export function planActiveOverlayChanges(params: {
	activeShard: ResidentShardDescriptor;
	changes: readonly ActiveShardAppendChange[];
	sequenceStart: number;
	now?: number;
}): ActiveOverlayWritePlan {
	const now = params.now ?? Date.now();
	const entries = params.changes.map((change, index): ActiveOverlayJournalEntry => {
		const sequence = params.sequenceStart + index;
		return {
			id: buildActiveOverlayJournalEntryId({
				activeShardId: params.activeShard.shardId,
				activeShardGeneration: params.activeShard.generation,
				sequence,
			}),
			sequence,
			activeShardId: params.activeShard.shardId,
			activeShardGeneration: params.activeShard.generation,
			operation: change.deleted === true ? "delete" : "append",
			document: change.deleted === true ? undefined : change.document,
			previousVersion: change.previousVersion ?? null,
			sourceBytes: change.deleted === true ? 0 : estimateDocumentSourceBytes(change.document),
			createdAt: now,
		};
	});
	const movedActiveOverlayVersions = new Set(
		entries
			.filter((entry) => entry.operation === "append" && entry.document != null)
			.map((entry) => {
				const previousVersion = entry.previousVersion;
				const document = entry.document;
				if (
					previousVersion == null ||
					document == null ||
					previousVersion.shardId !== buildOverlayShardId(params.activeShard.shardId) ||
					previousVersion.shardGeneration !== params.activeShard.generation ||
					previousVersion.docRef !== document.docRef ||
					previousVersion.docGeneration !== document.generation
				) {
					return null;
				}
				return buildOverlayVersionKey(previousVersion);
			})
			.filter((key): key is string => key != null),
	);
	const invalidations = entries.flatMap((entry) => {
		const previousVersion = entry.previousVersion;
		if (
			previousVersion == null ||
			isSameOverlayDocumentVersion(params.activeShard, entry, previousVersion) ||
			(entry.operation === "delete" &&
				movedActiveOverlayVersions.has(buildOverlayVersionKey(previousVersion)))
		) {
			return [];
		}
		return [
			{
				shardId: previousVersion.shardId,
				shardGeneration: previousVersion.shardGeneration,
				docRef: previousVersion.docRef,
				docGeneration: previousVersion.docGeneration,
				reason: entry.operation === "delete" ? "deleted" : "superseded",
				createdAt: now,
			} as const,
		];
	});
	return { entries, invalidations };
}

function buildOverlayVersionKey(version: {
	shardId: string;
	shardGeneration: number;
	docRef: number;
	docGeneration: number;
}): string {
	return `${version.shardId}@${version.shardGeneration}:${version.docRef}@${version.docGeneration}`;
}

function isSameOverlayDocumentVersion(
	activeShard: ResidentShardDescriptor,
	entry: ActiveOverlayJournalEntry,
	previousVersion: NonNullable<ActiveOverlayJournalEntry["previousVersion"]>,
): boolean {
	const document = entry.document;
	return (
		entry.operation === "append" &&
		document != null &&
		previousVersion.shardId === buildOverlayShardId(activeShard.shardId) &&
		previousVersion.shardGeneration === activeShard.generation &&
		previousVersion.docRef === document.docRef &&
		previousVersion.docGeneration === document.generation
	);
}

export async function commitActiveOverlayWritePlan(params: {
	stores: CoverageLexicalV3ProductionStores;
	overlayJournalStore: ActiveOverlayJournalStore;
	plan: ActiveOverlayWritePlan;
}): Promise<void> {
	const { entries, invalidations } = params.plan;
	const atomicStore = params.overlayJournalStore as unknown as Partial<ActiveOverlayWriteAtomicStore>;
	if (typeof atomicStore.appendOverlayEntriesWithInvalidations === "function") {
		await atomicStore.appendOverlayEntriesWithInvalidations({ entries, invalidations });
	} else {
		await params.overlayJournalStore.appendOverlayEntries(entries);
		if (invalidations.length > 0) {
			await params.stores.invalidations.appendInvalidations(invalidations);
		}
	}
	await recordShardInvalidationStaleStats({
		stores: params.stores,
		entries: invalidations,
	});
}
