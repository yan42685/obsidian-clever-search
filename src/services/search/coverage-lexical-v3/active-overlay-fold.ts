import type { IndexedDocument } from "src/globals/search-types";
import { loadCurrentActiveDocuments } from "./active-document-source";
import type {
	ActiveOverlayJournalEntry,
	ActiveOverlayJournalStore,
} from "./active-overlay-journal";
import {
	publishActiveShardAppend,
	type ActiveShardPublishResult,
	type ActiveShardColdEvidencePublisher,
} from "./active-shard-publisher";
import type { CoverageLexicalV3ResidentShardArtifactStore } from "./artifact-loader";
import type { V3DocumentTokenizer } from "./query";
import {
	DEFAULT_SHARD_SEAL_SOURCE_BYTES,
	type ResidentShardDescriptor,
} from "./shards";
import type { CoverageLexicalV3ProductionStores } from "./stores";
import {
	MissingIndexedTextSnapshotsError,
	MissingResidentShardArtifactsError,
	type ActiveShardIndexedSnapshotReader,
} from "./active-document-source";

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
	coldEvidencePublisher?: ActiveShardColdEvidencePublisher;
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
	const foldedDocuments = foldOverlayEntriesIntoCurrentDocuments(currentDocuments, entries);
	const nextGeneration = params.activeShard.generation + 1;
	const activeShardForFold = {
		...params.activeShard,
		generation: nextGeneration,
		sourceBytes: 0,
		docCount: 0,
		artifactOwner: `${params.activeShard.shardId}@fold-${nextGeneration}`,
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
		coldEvidencePublisher: params.coldEvidencePublisher,
	});
	const latestRegistry = await params.stores.shardRegistry.loadRegistry();
	const activeStillVisible = latestRegistry.some(
		(shard) =>
			shard.shardId === params.activeShard.shardId &&
			shard.generation === params.activeShard.generation &&
			shard.artifactOwner === params.activeShard.artifactOwner,
	);
	if (activeStillVisible) {
		throw new Error("Active overlay fold did not publish replacement registry before clearing overlay.");
	}
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

export function isMissingIndexedTextSnapshotsError(
	error: unknown,
): error is MissingIndexedTextSnapshotsError {
	return error instanceof MissingIndexedTextSnapshotsError;
}

export function isMissingActiveDocumentSourceError(
	error: unknown,
): error is MissingIndexedTextSnapshotsError | MissingResidentShardArtifactsError {
	return (
		error instanceof MissingIndexedTextSnapshotsError ||
		error instanceof MissingResidentShardArtifactsError
	);
}

function foldOverlayEntriesIntoCurrentDocuments(
	currentDocuments: readonly IndexedDocument[],
	entries: readonly ActiveOverlayJournalEntry[],
): readonly IndexedDocument[] {
	const documentByLiveKey = new Map<string, IndexedDocument>();
	for (const document of currentDocuments) {
		documentByLiveKey.set(buildLiveDocumentKey(document), document);
	}
	for (const entry of [...entries].sort((left, right) => left.sequence - right.sequence)) {
		const previousKey = buildPreviousVersionLiveKey(entry);
		if (previousKey != null) {
			documentByLiveKey.delete(previousKey);
		}
		if (entry.operation === "delete") {
			continue;
		}
		if (entry.document != null) {
			documentByLiveKey.set(buildLiveDocumentKey(entry.document), entry.document);
		}
	}
	return [...documentByLiveKey.values()];
}

function buildLiveDocumentKey(document: IndexedDocument): string {
	return typeof document.docRef === "number" && document.docRef > 0
		? `docref:${document.docRef}`
		: `path:${document.path}`;
}

function buildPreviousVersionLiveKey(entry: ActiveOverlayJournalEntry): string | null {
	const previousVersion = entry.previousVersion;
	return previousVersion == null ? null : `docref:${previousVersion.docRef}`;
}
