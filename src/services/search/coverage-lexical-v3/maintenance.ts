import type { IndexedDocument } from "src/globals/search-types";
import { buildIndexedSnapshotRequestKey } from "src/services/search/shared/file-snapshot-store";
import type { ActiveShardIndexedSnapshotReader } from "./active-document-source";
import { planActiveOverlayFold, runActiveOverlayFoldMaintenanceJob } from "./active-overlay-fold";
import {
	buildShardColdEvidenceRows,
	type ActiveShardColdEvidencePublisher,
} from "./active-shard-publisher";
import type { CoverageLexicalV3ResidentShardArtifactStore } from "./artifact-loader";
import { buildResidentHotBaseArtifacts } from "./build";
import {
	chooseNextCompactPlan,
	commitCompactTempArtifact,
	runCompactMaintenanceHeal,
	type CompactJobManifest,
	type CompactJobManifestStore,
	type CompactTempArtifactStore,
} from "./compact";
import type { ResidentShard } from "./layout/types";
import type { V3DocumentTokenizer } from "./query";
import { getDocPath } from "./recall";
import { buildShardInvalidationKey } from "./invalidation";
import { isReadableShardState, type ResidentShardDescriptor } from "./shards";
import {
	reconcileShardInvalidationStaleStats,
	type CoverageLexicalV3ProductionStores,
} from "./stores";

export const DEFAULT_ACTIVE_OVERLAY_FOLD_ENTRY_THRESHOLD = 64;
export const DEFAULT_ACTIVE_OVERLAY_FOLD_SOURCE_BYTES_THRESHOLD = 4 * 1024 * 1024;

export type CoverageLexicalV3MaintenanceResult = Readonly<{
	stateChanged: boolean;
	gcMs: number;
	orphanArtifactRowsRemoved: number;
	overlayEntriesRemoved: number;
	invalidationsRemoved: number;
	compactTempArtifactsRemoved: number;
	foldMs: number;
	compactMs: number;
	compactJobsHealed: number;
	compactJobsStarted: number;
}>;

export async function runCoverageLexicalV3Maintenance(params: {
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	overlayJournalStore: Parameters<typeof planActiveOverlayFold>[0]["overlayJournalStore"];
	compactJobStore?: CompactJobManifestStore;
	compactTempArtifactStore?: CompactTempArtifactStore;
	indexedSnapshotReader: ActiveShardIndexedSnapshotReader;
	coldEvidencePublisher?: ActiveShardColdEvidencePublisher;
	tokenizeDocumentText?: V3DocumentTokenizer;
	now?: number;
	overlayFoldEntryThreshold?: number;
	overlayFoldSourceBytesThreshold?: number;
}): Promise<CoverageLexicalV3MaintenanceResult> {
	const now = params.now ?? Date.now();
	let stateChanged = false;
	let foldMs = 0;
	let compactMs = 0;
	let compactJobsHealed = 0;
	let compactJobsStarted = 0;

	if (params.compactJobStore != null && params.compactTempArtifactStore != null) {
		const compactHealStartedAt = Date.now();
		const outputDescriptorsByJobId = await buildCompactOutputDescriptorsByJobId({
			compactJobStore: params.compactJobStore,
			compactTempArtifactStore: params.compactTempArtifactStore,
		});
		const results = await runCompactMaintenanceHeal({
			stores: params.stores,
			residentShardArtifactStore: params.residentShardArtifactStore,
			jobStore: params.compactJobStore,
			tempArtifactStore: params.compactTempArtifactStore,
			outputDescriptorsByJobId,
			coldEvidencePublisher: params.coldEvidencePublisher,
			now,
		});
		compactMs += Math.max(0, Date.now() - compactHealStartedAt);
		compactJobsHealed += results.filter((result) => result.action !== "retry_later").length;
		stateChanged ||= results.some((result) => result.action !== "retry_later");
	}

	const activeShard = await loadCurrentActiveShard(params.stores);
	if (activeShard != null) {
		const foldPlan = await planActiveOverlayFold({
			overlayJournalStore: params.overlayJournalStore,
			activeShard,
		});
		if (
			foldPlan.overlayEntryCount >=
				(params.overlayFoldEntryThreshold ?? DEFAULT_ACTIVE_OVERLAY_FOLD_ENTRY_THRESHOLD) ||
			foldPlan.overlaySourceBytes >=
				(params.overlayFoldSourceBytesThreshold ??
					DEFAULT_ACTIVE_OVERLAY_FOLD_SOURCE_BYTES_THRESHOLD)
		) {
			const foldStartedAt = Date.now();
			const result = await runActiveOverlayFoldMaintenanceJob({
				stores: params.stores,
				residentShardArtifactStore: params.residentShardArtifactStore,
				overlayJournalStore: params.overlayJournalStore,
				activeShard,
				indexedSnapshotReader: params.indexedSnapshotReader,
				tokenizeDocumentText: params.tokenizeDocumentText,
				coldEvidencePublisher: params.coldEvidencePublisher,
				now,
			});
			foldMs += Math.max(0, Date.now() - foldStartedAt);
			stateChanged ||= result != null;
		}
	}

	if (params.compactJobStore != null && params.compactTempArtifactStore != null) {
		const compactStartedAt = Date.now();
		const compacted = await maybeRunOneCompactJob({
			stores: params.stores,
			residentShardArtifactStore: params.residentShardArtifactStore,
			compactJobStore: params.compactJobStore,
			compactTempArtifactStore: params.compactTempArtifactStore,
			indexedSnapshotReader: params.indexedSnapshotReader,
			coldEvidencePublisher: params.coldEvidencePublisher,
			tokenizeDocumentText: params.tokenizeDocumentText,
			now,
		});
		compactMs += Math.max(0, Date.now() - compactStartedAt);
		if (compacted) {
			compactJobsStarted += 1;
			stateChanged = true;
		}
	}

	return {
		stateChanged,
		gcMs: 0,
		orphanArtifactRowsRemoved: 0,
		overlayEntriesRemoved: 0,
		invalidationsRemoved: 0,
		compactTempArtifactsRemoved: 0,
		foldMs,
		compactMs,
		compactJobsHealed,
		compactJobsStarted,
	};
}

async function maybeRunOneCompactJob(params: {
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	compactJobStore: CompactJobManifestStore;
	compactTempArtifactStore: CompactTempArtifactStore;
	indexedSnapshotReader: ActiveShardIndexedSnapshotReader;
	coldEvidencePublisher?: ActiveShardColdEvidencePublisher;
	tokenizeDocumentText?: V3DocumentTokenizer;
	now: number;
}): Promise<boolean> {
	const invalidations = await params.stores.invalidations.loadInvalidations();
	await reconcileShardInvalidationStaleStats({
		stores: params.stores,
		invalidations,
	});
	const registry = await params.stores.shardRegistry.loadRegistry();
	const plan = chooseNextCompactPlan(registry);
	if (plan == null) {
		return false;
	}
	const inputShards = plan.inputShardIds
		.map((shardId) => registry.find((descriptor) => descriptor.shardId === shardId))
		.filter((descriptor): descriptor is ResidentShardDescriptor => descriptor != null);
	if (inputShards.length !== plan.inputShardIds.length) {
		return false;
	}
	const documents = await loadLiveDocumentsForShards({
		shards: inputShards,
		invalidations,
		residentShardArtifactStore: params.residentShardArtifactStore,
		indexedSnapshotReader: params.indexedSnapshotReader,
	});
	if (documents.length === 0) {
		await markCompactInputsGarbage({
			stores: params.stores,
			inputShards,
		});
		return true;
	}
	const outputShardId = `sealed-compact-${params.now}`;
	const outputDescriptor: ResidentShardDescriptor = {
		shardId: outputShardId,
		generation: 1,
		state: "sealed",
		sourceBytes: plan.estimatedOutputSourceBytes,
		docCount: documents.length,
		createdOrder: Math.min(...inputShards.map((shard) => shard.createdOrder)),
		artifactOwner: outputShardId,
	};
	const job: CompactJobManifest = {
		jobId: `compact-${params.now}`,
		kind: plan.kind,
		inputShardIds: plan.inputShardIds,
		outputShardId,
		status: "building",
		createdAt: params.now,
		updatedAt: params.now,
	};
	await params.compactJobStore.saveJob(job);
	const artifacts = buildResidentHotBaseArtifacts(documents, params.tokenizeDocumentText);
	const coldRows = buildShardColdEvidenceRows(artifacts, outputDescriptor);
	await params.compactTempArtifactStore.saveTempArtifact({
		jobId: job.jobId,
		outputShardId,
		outputDescriptor,
		shard: {
			shardId: outputShardId,
			generation: outputDescriptor.generation,
			base: {
				...artifacts.base,
				fuzzyRescue: artifacts.fuzzyRescueIndex,
			},
		},
		bodyEvidenceRows: coldRows.bodyEvidenceRows,
		hanDocEvidenceRows: coldRows.hanDocEvidenceRows,
		hanBodyEvidenceRows: coldRows.hanBodyEvidenceRows,
		createdAt: params.now,
	});
	const readyJob = { ...job, status: "ready_to_commit" as const, updatedAt: params.now };
	await params.compactJobStore.saveJob(readyJob);
	await commitCompactTempArtifact({
		stores: params.stores,
		residentShardArtifactStore: params.residentShardArtifactStore,
		jobStore: params.compactJobStore,
		tempArtifactStore: params.compactTempArtifactStore,
		job: readyJob,
		outputDescriptor,
		coldEvidencePublisher: params.coldEvidencePublisher,
		now: params.now,
	});
	return true;
}

async function markCompactInputsGarbage(params: {
	stores: CoverageLexicalV3ProductionStores;
	inputShards: readonly ResidentShardDescriptor[];
}): Promise<void> {
	await params.stores.shardRegistry.updateShards(
		params.inputShards.map((shard) => ({
			...shard,
			state: "garbage" as const,
		})),
	);
}

async function buildCompactOutputDescriptorsByJobId(params: {
	compactJobStore: CompactJobManifestStore;
	compactTempArtifactStore: CompactTempArtifactStore;
}): Promise<ReadonlyMap<string, ResidentShardDescriptor>> {
	const descriptors = new Map<string, ResidentShardDescriptor>();
	for (const job of await params.compactJobStore.loadJobs()) {
		const tempArtifact = await params.compactTempArtifactStore.loadTempArtifact(job.jobId);
		if (tempArtifact == null) {
			continue;
		}
		descriptors.set(job.jobId, tempArtifact.outputDescriptor);
	}
	return descriptors;
}

async function loadCurrentActiveShard(
	stores: CoverageLexicalV3ProductionStores,
): Promise<ResidentShardDescriptor | null> {
	const registry = await stores.shardRegistry.loadRegistry();
	return (
		registry
			.filter((descriptor) => isReadableShardState(descriptor.state))
			.find((descriptor) => descriptor.state === "active") ?? null
	);
}

async function loadLiveDocumentsForShards(params: {
	shards: readonly ResidentShardDescriptor[];
	invalidations: readonly {
		shardId: string;
		shardGeneration: number;
		docRef: number;
		docGeneration: number;
	}[];
	residentShardArtifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	indexedSnapshotReader: ActiveShardIndexedSnapshotReader;
}): Promise<readonly IndexedDocument[]> {
	const documents: IndexedDocument[] = [];
	const invalidatedKeys = new Set(
		params.invalidations.map((entry) => buildShardInvalidationKey(entry)),
	);
	for (const descriptor of params.shards) {
		const shard = await params.residentShardArtifactStore.loadResidentShard(descriptor);
		if (shard == null) {
			continue;
		}
		const refs = extractLiveDocumentRefs(shard, invalidatedKeys);
		const [textsByPath, metadataByPath] = await Promise.all([
			params.indexedSnapshotReader.readIndexedTextSnapshots(refs),
			params.indexedSnapshotReader.readIndexedMetadata(refs),
		]);
		for (const ref of refs) {
			const requestKey = buildIndexedSnapshotRequestKey(ref);
			const text = textsByPath.get(requestKey);
			if (text == null) {
				continue;
			}
			const metadata = metadataByPath.get(requestKey);
			documents.push({
				docRef: ref.docRef,
				path: ref.path,
				generation: ref.generation,
				size: text.text.length,
				basename: basenameOfPath(ref.path),
				folder: folderOfPath(ref.path),
				content: text.text,
				aliases: metadata?.aliasesText ?? "",
				tags: metadata?.tagsText ?? "",
				headings: metadata?.headingsText ?? "",
			});
		}
	}
	return documents;
}

function extractLiveDocumentRefs(
	shard: ResidentShard,
	invalidatedKeys: ReadonlySet<string>,
): ReadonlyArray<{ path: string; generation: number; docRef: number }> {
	const refs: Array<{ path: string; generation: number; docRef: number }> = [];
	for (let docId = 0; docId < shard.base.docTable.docCount; docId += 1) {
		const docRef = shard.base.docTable.docRefsByDocId[docId] ?? 0;
		const generation = shard.base.docTable.generationByDocId[docId] ?? 0;
		if (
			invalidatedKeys.has(
				buildShardInvalidationKey({
					shardId: shard.shardId,
					shardGeneration: shard.generation,
					docRef,
					docGeneration: generation,
				}),
			)
		) {
			continue;
		}
		refs.push({
			path: getDocPath(shard.base, docId),
			generation,
			docRef,
		});
	}
	return refs;
}

function basenameOfPath(path: string): string {
	const fileName = path.split("/").pop() ?? path;
	return fileName.replace(/\.md$/iu, "");
}

function folderOfPath(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash <= 0 ? "" : path.slice(0, lastSlash);
}
