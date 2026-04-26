import type { IndexedDocument } from "src/globals/search-types";
import { loadCurrentActiveDocuments } from "./active-document-source";
import {
	materializeOverlayDocuments,
	type ActiveOverlayJournalStore,
} from "./active-overlay-journal";
import {
	publishActiveShardAppend,
	type ActiveShardPublishResult,
} from "./active-shard-publisher";
import type { CoverageLexicalV3ResidentShardArtifactStore } from "./artifact-loader";
import type { V3DocumentTokenizer } from "./query";
import {
	DEFAULT_SHARD_SEAL_SOURCE_BYTES,
	type ResidentShardDescriptor,
} from "./shards";
import type { CoverageLexicalV3ProductionStores } from "./stores";
import type { ActiveShardIndexedSnapshotReader } from "./active-document-source";

export type ActiveOverlayFoldPlan = Readonly<{
	activeShard: ResidentShardDescriptor;
	overlayEntryCount: number;
	overlaySourceBytes: number;
	shouldFold: boolean;
}>;

export type ActiveOverlayFoldResult = ActiveShardPublishResult &
	Readonly<{
		clearedOverlayEntries: number;
		oldActiveArtifactOwner: string;
	}>;

export async function planActiveOverlayFold(params: {
	overlayJournalStore: ActiveOverlayJournalStore;
	activeShard: ResidentShardDescriptor;
}): Promise<ActiveOverlayFoldPlan> {
	const entries = await params.overlayJournalStore.loadActiveOverlayEntries({
		activeShardId: params.activeShard.shardId,
		activeShardGeneration: params.activeShard.generation,
	});
	return {
		activeShard: params.activeShard,
		overlayEntryCount: entries.length,
		overlaySourceBytes: entries.reduce((sum, entry) => sum + entry.sourceBytes, 0),
		shouldFold: entries.length > 0,
	};
}

export async function runActiveOverlayFoldMaintenanceJob(params: {
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	overlayJournalStore: ActiveOverlayJournalStore;
	activeShard: ResidentShardDescriptor;
	indexedSnapshotReader: ActiveShardIndexedSnapshotReader;
	sealSourceBytes?: number;
	now?: number;
	tokenizeDocumentText?: V3DocumentTokenizer;
}): Promise<ActiveOverlayFoldResult | null> {
	const entries = await params.overlayJournalStore.loadActiveOverlayEntries({
		activeShardId: params.activeShard.shardId,
		activeShardGeneration: params.activeShard.generation,
	});
	if (entries.length === 0) {
		return null;
	}
	const currentDocuments = await loadCurrentActiveDocuments({
		activeShard: params.activeShard,
		residentShardArtifactLoader: params.residentShardArtifactStore,
		indexedSnapshotReader: params.indexedSnapshotReader,
	});
	const overlayDocuments = materializeOverlayDocuments(entries);
	const foldedDocuments = mergeFoldDocuments(currentDocuments, overlayDocuments);
	const activeShardForFold = {
		...params.activeShard,
		sourceBytes: 0,
		docCount: 0,
	};
	const result = await publishActiveShardAppend({
		stores: params.stores,
		residentShardArtifactStore: params.residentShardArtifactStore,
		activeShard: activeShardForFold,
		currentActiveDocuments: [],
		changes: foldedDocuments.map((document) => ({ document })),
		plannerOptions: {
			sealSourceBytes: params.sealSourceBytes ?? DEFAULT_SHARD_SEAL_SOURCE_BYTES,
			now: params.now,
			nextShardId: params.activeShard.shardId,
			nextCreatedOrder: params.activeShard.createdOrder,
		},
		tokenizeDocumentText: params.tokenizeDocumentText,
	});
	await params.overlayJournalStore.clearActiveOverlayEntries({
		activeShardId: params.activeShard.shardId,
		activeShardGeneration: params.activeShard.generation,
	});
	return {
		...result,
		clearedOverlayEntries: entries.length,
		oldActiveArtifactOwner: params.activeShard.artifactOwner,
	};
}

function mergeFoldDocuments(
	currentDocuments: readonly IndexedDocument[],
	overlayDocuments: readonly IndexedDocument[],
): readonly IndexedDocument[] {
	const documentByKey = new Map<string, IndexedDocument>();
	for (const document of currentDocuments) {
		documentByKey.set(buildDocumentKey(document), document);
	}
	for (const document of overlayDocuments) {
		documentByKey.set(buildDocumentKey(document), document);
	}
	return [...documentByKey.values()];
}

function buildDocumentKey(document: IndexedDocument): string {
	return `${document.docRef ?? document.path}@${document.generation ?? 0}`;
}
