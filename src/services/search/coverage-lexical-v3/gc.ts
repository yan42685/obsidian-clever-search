import type {
	CoverageLexicalV3CompactJobManifestRow,
	CoverageLexicalV3CompactTempArtifactRow,
	LexicalBodyEvidenceRow,
	LexicalHanBodyEvidenceRow,
	LexicalHanDocEvidenceRow,
} from "src/services/database/database";
import type { ActiveOverlayJournalRow } from "./active-overlay-journal";
import { buildOverlayShardId } from "./active-overlay-journal";
import type { CoverageLexicalV3ResidentShardArtifactRow } from "./artifact-loader";
import {
	buildLexicalBlockEvidenceRowId,
	buildLexicalDocEvidenceRowId,
} from "../shared/file-snapshot-store";
import type { CoverageLexicalV3SnapshotManifest } from "./snapshot";
import { isReadableShardState, type ResidentShardDescriptor } from "./shards";
import type {
	CoverageLexicalV3InvalidationRow,
	CoverageLexicalV3ShardRegistryRow,
} from "./stores";

type GcTable<Row extends Record<string, unknown>, Key extends string> = Readonly<{
	toArray: () => Promise<Row[]>;
	delete: (key: Key) => Promise<unknown>;
}>;

export type CoverageLexicalV3StorageGcTables = Readonly<{
	residentShardArtifacts: GcTable<CoverageLexicalV3ResidentShardArtifactRow, string>;
	snapshotManifests: GcTable<CoverageLexicalV3SnapshotManifest, string>;
	shardRegistry: GcTable<CoverageLexicalV3ShardRegistryRow, string>;
	activeOverlayJournal: GcTable<ActiveOverlayJournalRow, string>;
	invalidations: GcTable<CoverageLexicalV3InvalidationRow, string>;
	compactJobs: GcTable<CoverageLexicalV3CompactJobManifestRow, string>;
	compactTempArtifacts: GcTable<CoverageLexicalV3CompactTempArtifactRow, string>;
	lexicalBodyEvidence?: GcTable<LexicalBodyEvidenceRow, string>;
	lexicalHanDocEvidence?: GcTable<LexicalHanDocEvidenceRow, string>;
	lexicalHanBodyEvidence?: GcTable<LexicalHanBodyEvidenceRow, string>;
}>;

export type CoverageLexicalV3StorageGcResult = Readonly<{
	gcMs: number;
	orphanArtifactRowsRemoved: number;
	snapshotManifestsRemoved: number;
	overlayEntriesRemoved: number;
	invalidationsRemoved: number;
	compactTempArtifactsRemoved: number;
	coldEvidenceRowsRemoved: number;
	deleteBudgetExhausted: boolean;
}>;

export async function runCoverageLexicalV3StorageGc(params: {
	tables: CoverageLexicalV3StorageGcTables;
	maxRowsToDelete?: number;
}): Promise<CoverageLexicalV3StorageGcResult> {
	const startedAt = Date.now();
	const maxRowsToDelete = params.maxRowsToDelete ?? 256;
	let remainingDeletes = Math.max(0, maxRowsToDelete);
	const deleteIfBudgetAllows = async <Row extends Record<string, unknown>>(
		rows: readonly Row[],
		table: GcTable<Row, string>,
		keyOf: (row: Row) => string,
	): Promise<number> => {
		let deleted = 0;
		for (const row of rows) {
			if (remainingDeletes <= 0) {
				break;
			}
			await table.delete(keyOf(row));
			remainingDeletes -= 1;
			deleted += 1;
		}
		return deleted;
	};

	const [
		artifactRows,
		snapshotManifests,
		registryRows,
		overlayRows,
		invalidationRows,
		compactJobs,
		compactTempArtifacts,
		bodyEvidenceRows,
		hanDocEvidenceRows,
		hanBodyEvidenceRows,
	] = await Promise.all([
		params.tables.residentShardArtifacts.toArray(),
		params.tables.snapshotManifests.toArray(),
		params.tables.shardRegistry.toArray(),
		params.tables.activeOverlayJournal.toArray(),
		params.tables.invalidations.toArray(),
		params.tables.compactJobs.toArray(),
		params.tables.compactTempArtifacts.toArray(),
		params.tables.lexicalBodyEvidence?.toArray() ?? Promise.resolve([]),
		params.tables.lexicalHanDocEvidence?.toArray() ?? Promise.resolve([]),
		params.tables.lexicalHanBodyEvidence?.toArray() ?? Promise.resolve([]),
	]);

	const latestCommitted = latestCommittedSnapshot(snapshotManifests);
	const readableRegistry = registryRows.filter((descriptor) =>
		isReadableShardState(descriptor.state),
	);
	const readableManifestShards =
		latestCommitted?.shardDescriptors.filter((descriptor) =>
			isReadableShardState(descriptor.state),
		) ?? [];
	const readableShardKeys = new Set([
		...readableRegistry.map(shardKey),
		...readableManifestShards.map(shardKey),
	]);
	const rootedArtifactIds = new Set([
		...readableRegistry.map(artifactRowIdForDescriptor),
		...(latestCommitted?.artifactRefs.map(
			(ref) => `${ref.artifactOwner}@${ref.generation}`,
		) ?? []),
	]);
	const activeShardDescriptors = [
		...readableRegistry.filter((descriptor) => descriptor.state === "active"),
		...readableManifestShards.filter((descriptor) => descriptor.state === "active"),
	];
	const activeShardKeys = new Set(activeShardDescriptors.map(shardKey));
	// Snapshot overlay refs are an integrity floor, not the replay upper bound:
	// restore replays the whole active-shard tail for the committed snapshot.
	const latestReferencedOverlayEntryIds = new Set(
		latestCommitted?.overlayJournalRefs.map((ref) => ref.entryId) ?? [],
	);
	const keptOverlayRows = overlayRows.filter(
		(row) =>
			activeShardKeys.has(
				shardKeyFromParts(row.activeShardId, row.activeShardGeneration),
			) || latestReferencedOverlayEntryIds.has(row.id),
	);
	const overlayShardKeys = new Set(
		keptOverlayRows.map((row) =>
			shardKeyFromParts(
				buildOverlayShardId(row.activeShardId),
				row.activeShardGeneration,
			),
		),
	);
	const rootedColdEvidenceShardKeys = new Set([
		...readableShardKeys,
		...overlayShardKeys,
	]);
	const rootedResidentColdEvidenceRowIds = collectRootedResidentColdEvidenceRowIds({
		descriptors: [...readableRegistry, ...readableManifestShards],
		artifactRows,
	});
	const rootedInvalidationShardKeys = new Set([
		...readableShardKeys,
		...overlayShardKeys,
	]);

	const orphanArtifactRowsRemoved = await deleteIfBudgetAllows(
		artifactRows.filter((row) => !rootedArtifactIds.has(row.id)),
		params.tables.residentShardArtifacts,
		(row) => row.id,
	);
	const snapshotManifestsRemoved = await deleteIfBudgetAllows(
		snapshotManifests.filter(
			(manifest) =>
				manifest.status !== "committed" ||
				(latestCommitted != null &&
					manifest.status === "committed" &&
					manifest.snapshotId !== latestCommitted.snapshotId),
		),
		params.tables.snapshotManifests,
		(row) => row.snapshotId,
	);
	const overlayEntriesRemoved = await deleteIfBudgetAllows(
		overlayRows.filter((row) => !keptOverlayRows.some((kept) => kept.id === row.id)),
		params.tables.activeOverlayJournal,
		(row) => row.id,
	);
	const invalidationsRemoved = await deleteIfBudgetAllows(
		invalidationRows.filter(
			(row) => !rootedInvalidationShardKeys.has(shardKeyFromParts(row.shardId, row.shardGeneration)),
		),
		params.tables.invalidations,
		(row) => row.id,
	);
	const liveCompactJobIds = new Set(compactJobs.map((job) => job.jobId));
	const compactTempArtifactsRemoved = await deleteIfBudgetAllows(
		compactTempArtifacts.filter((artifact) => !liveCompactJobIds.has(artifact.jobId)),
		params.tables.compactTempArtifacts,
		(row) => row.jobId,
	);
	const coldEvidenceRowsRemoved =
		(await deleteColdEvidenceRows(
			bodyEvidenceRows,
			params.tables.lexicalBodyEvidence,
			rootedColdEvidenceShardKeys,
			overlayShardKeys,
			rootedResidentColdEvidenceRowIds,
			deleteIfBudgetAllows,
		)) +
		(await deleteColdEvidenceRows(
			hanDocEvidenceRows,
			params.tables.lexicalHanDocEvidence,
			rootedColdEvidenceShardKeys,
			overlayShardKeys,
			rootedResidentColdEvidenceRowIds,
			deleteIfBudgetAllows,
		)) +
		(await deleteColdEvidenceRows(
			hanBodyEvidenceRows,
			params.tables.lexicalHanBodyEvidence,
			rootedColdEvidenceShardKeys,
			overlayShardKeys,
			rootedResidentColdEvidenceRowIds,
			deleteIfBudgetAllows,
		));

	return {
		gcMs: Math.max(0, Date.now() - startedAt),
		orphanArtifactRowsRemoved,
		snapshotManifestsRemoved,
		overlayEntriesRemoved,
		invalidationsRemoved,
		compactTempArtifactsRemoved,
		coldEvidenceRowsRemoved,
		deleteBudgetExhausted: remainingDeletes <= 0,
	};
}

async function deleteColdEvidenceRows<Row extends { id: string; shardId: string; shardGeneration: number }>(
	rows: readonly Row[],
	table: GcTable<Row, string> | undefined,
	rootedShardKeys: ReadonlySet<string>,
	overlayShardKeys: ReadonlySet<string>,
	rootedResidentRowIds: ReadonlySet<string>,
	deleteIfBudgetAllows: (
		rows: readonly Row[],
		table: GcTable<Row, string>,
		keyOf: (row: Row) => string,
	) => Promise<number>,
): Promise<number> {
	if (table == null) {
		return 0;
	}
	return await deleteIfBudgetAllows(
		rows.filter(
			(row) =>
				!shouldKeepColdEvidenceRow({
					row,
					rootedShardKeys,
					overlayShardKeys,
					rootedResidentRowIds,
				}),
		),
		table,
		(row) => row.id,
	);
}

function shouldKeepColdEvidenceRow(params: {
	row: { id: string; shardId: string; shardGeneration: number };
	rootedShardKeys: ReadonlySet<string>;
	overlayShardKeys: ReadonlySet<string>;
	rootedResidentRowIds: ReadonlySet<string>;
}): boolean {
	const key = shardKeyFromParts(params.row.shardId, params.row.shardGeneration);
	if (!params.rootedShardKeys.has(key)) {
		return false;
	}
	if (params.overlayShardKeys.has(key)) {
		return true;
	}
	return params.rootedResidentRowIds.has(params.row.id);
}

function collectRootedResidentColdEvidenceRowIds(params: {
	descriptors: readonly ResidentShardDescriptor[];
	artifactRows: readonly CoverageLexicalV3ResidentShardArtifactRow[];
}): ReadonlySet<string> {
	const ids = new Set<string>();
	const artifactRowsById = new Map(params.artifactRows.map((row) => [row.id, row]));
	for (const descriptor of params.descriptors) {
		const artifact = artifactRowsById.get(artifactRowIdForDescriptor(descriptor));
		if (artifact == null) {
			continue;
		}
		const docTable = artifact.base?.docTable;
		const bodyBlocks = artifact.base?.bodyBlocks;
		if (docTable == null || bodyBlocks == null) {
			continue;
		}
		for (let docId = 0; docId < docTable.docCount; docId += 1) {
			const docRef = docTable.docRefsByDocId[docId] ?? 0;
			if (!Number.isFinite(docRef) || docRef <= 0) {
				continue;
			}
			const generation = docTable.generationByDocId[docId] ?? 0;
			ids.add(
				buildLexicalDocEvidenceRowId({
					shardId: descriptor.shardId,
					shardGeneration: descriptor.generation,
					docRef,
					generation,
				}),
			);
			const blockStart = docTable.bodyBlockStartByDocId[docId] ?? 0;
			const blockCount = docTable.bodyBlockCountByDocId[docId] ?? 0;
			for (let offset = 0; offset < blockCount; offset += 1) {
				const blockId = blockStart + offset;
				ids.add(
					buildLexicalBlockEvidenceRowId({
						shardId: descriptor.shardId,
						shardGeneration: descriptor.generation,
						docRef,
						generation,
						blockOrdinal: bodyBlocks.blockOrdinalByBlockId[blockId] ?? offset,
					}),
				);
			}
		}
	}
	return ids;
}

function latestCommittedSnapshot(
	manifests: readonly CoverageLexicalV3SnapshotManifest[],
): CoverageLexicalV3SnapshotManifest | undefined {
	return [...manifests]
		.filter((manifest) => manifest.status === "committed")
		.sort(compareSnapshotManifestRecency)
		.at(-1);
}

function compareSnapshotManifestRecency(
	left: CoverageLexicalV3SnapshotManifest,
	right: CoverageLexicalV3SnapshotManifest,
): number {
	const createdAtComparison = left.createdAt - right.createdAt;
	if (createdAtComparison !== 0) {
		return createdAtComparison;
	}
	const leftDefaultOrder = parseDefaultSnapshotOrder(left);
	const rightDefaultOrder = parseDefaultSnapshotOrder(right);
	if (leftDefaultOrder != null && rightDefaultOrder != null) {
		return leftDefaultOrder - rightDefaultOrder;
	}
	return left.snapshotId.localeCompare(right.snapshotId);
}

function parseDefaultSnapshotOrder(
	manifest: CoverageLexicalV3SnapshotManifest,
): number | null {
	const prefix = `v3-snapshot-${manifest.createdAt}`;
	if (manifest.snapshotId === prefix) {
		return 0;
	}
	const suffixPrefix = `${prefix}-`;
	if (!manifest.snapshotId.startsWith(suffixPrefix)) {
		return null;
	}
	const suffix = manifest.snapshotId.slice(suffixPrefix.length);
	return /^\d+$/u.test(suffix) ? Number.parseInt(suffix, 10) : null;
}

function artifactRowIdForDescriptor(descriptor: ResidentShardDescriptor): string {
	return `${descriptor.artifactOwner}@${descriptor.generation}`;
}

function shardKey(descriptor: Pick<ResidentShardDescriptor, "shardId" | "generation">): string {
	return shardKeyFromParts(descriptor.shardId, descriptor.generation);
}

function shardKeyFromParts(shardId: string, generation: number): string {
	return `${shardId}@${generation}`;
}
