import {
	estimateDocumentSourceBytes,
	type ActiveShardAppendChange,
} from "./append-planner";
import {
	buildActiveOverlayJournalEntryId,
	type ActiveOverlayJournalEntry,
	type ActiveOverlayJournalStore,
} from "./active-overlay-journal";
import type { ResidentShardDescriptor } from "./shards";
import type { CoverageLexicalV3ProductionStores } from "./stores";

export type ActiveOverlayWriteResult = Readonly<{
	entries: readonly ActiveOverlayJournalEntry[];
	invalidationCount: number;
}>;

export async function writeActiveOverlayChanges(params: {
	stores: CoverageLexicalV3ProductionStores;
	overlayJournalStore: ActiveOverlayJournalStore;
	activeShard: ResidentShardDescriptor;
	changes: readonly ActiveShardAppendChange[];
	sequenceStart: number;
	now?: number;
}): Promise<ActiveOverlayWriteResult> {
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
	const invalidations = entries.flatMap((entry) => {
		const previousVersion = entry.previousVersion;
		if (previousVersion == null) {
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
	await params.overlayJournalStore.appendOverlayEntries(entries);
	if (invalidations.length > 0) {
		await params.stores.invalidations.appendInvalidations(invalidations);
	}
	return {
		entries,
		invalidationCount: invalidations.length,
	};
}
