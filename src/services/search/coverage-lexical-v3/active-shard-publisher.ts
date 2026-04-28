import type { IndexedDocument } from "src/globals/search-types";
import {
	buildLexicalBlockEvidenceRowId,
	buildLexicalDocEvidenceRowId,
} from "../shared/file-snapshot-store";
import {
	buildResidentHotBaseArtifacts,
	type ResidentHotBaseArtifacts,
} from "./build";
import type { V3DocumentTokenizer } from "./query";
import {
	loadCurrentActiveDocuments,
	type ActiveShardIndexedSnapshotReader,
} from "./active-document-source";
import {
	estimateDocumentSourceBytes,
	planActiveShardAppend,
	type ActiveShardAppendChange,
	type ActiveShardAppendPlannerOptions,
} from "./append-planner";
import type { CoverageLexicalV3ResidentShardArtifactStore } from "./artifact-loader";
import type { ResidentShard } from "./layout/types";
import {
	DEFAULT_SHARD_SEAL_SOURCE_BYTES,
	type ResidentShardDescriptor,
} from "./shards";
import {
	recordShardInvalidationStaleStats,
	type CoverageLexicalV3ProductionStores,
} from "./stores";

export type ActiveShardPublishResult = Readonly<{
	appendTargetShard: ResidentShardDescriptor;
	sealedActiveShard: ResidentShardDescriptor | null;
	publishedShards: readonly ResidentShardDescriptor[];
	appendedDocCount: number;
	invalidationCount: number;
}>;

export type ActiveShardColdEvidencePublisher = Readonly<{
	publishBodyEvidence?: (
		rows: ResidentHotBaseArtifacts["bodyEvidenceRows"],
	) => Promise<void>;
	publishHanDocEvidence?: (
		rows: ResidentHotBaseArtifacts["hanDocEvidenceRows"],
	) => Promise<void>;
	publishHanBodyEvidence?: (
		rows: ResidentHotBaseArtifacts["hanBodyEvidenceRows"],
	) => Promise<void>;
}>;

export type ResidentShardColdEvidenceRows = Readonly<{
	bodyEvidenceRows: ResidentHotBaseArtifacts["bodyEvidenceRows"];
	hanDocEvidenceRows: ResidentHotBaseArtifacts["hanDocEvidenceRows"];
	hanBodyEvidenceRows: ResidentHotBaseArtifacts["hanBodyEvidenceRows"];
}>;

export async function publishActiveShardAppend(params: {
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	activeShard: ResidentShardDescriptor;
	currentActiveDocuments?: readonly IndexedDocument[];
	indexedSnapshotReader?: ActiveShardIndexedSnapshotReader;
	changes: readonly ActiveShardAppendChange[];
	plannerOptions?: ActiveShardAppendPlannerOptions;
	tokenizeDocumentText?: V3DocumentTokenizer;
	coldEvidencePublisher?: ActiveShardColdEvidencePublisher;
}): Promise<ActiveShardPublishResult> {
	const plan = planActiveShardAppend(
		params.activeShard,
		params.changes,
		params.plannerOptions,
	);
	const sealSourceBytes =
		params.plannerOptions?.sealSourceBytes ?? DEFAULT_SHARD_SEAL_SOURCE_BYTES;
	if (plan.nextActiveShard.sourceBytes > sealSourceBytes) {
		return await publishOversizedAppendBatch(params, plan);
	}
	const currentActiveDocuments = plan.shouldSealBeforeAppend
		? []
		: await resolveCurrentActiveDocuments(params);
	const targetDocuments = plan.shouldSealBeforeAppend
		? plan.appendDocuments
		: applyChangesToCurrentDocuments(currentActiveDocuments, params.changes);
	const nextActiveShard = plan.shouldSealBeforeAppend
		? plan.nextActiveShard
		: {
				...plan.nextActiveShard,
				sourceBytes: targetDocuments.reduce(
					(sum, document) => sum + estimateDocumentSourceBytes(document),
					0,
				),
				docCount: targetDocuments.length,
		  };
	const targetArtifacts = buildResidentShardArtifacts(
		nextActiveShard,
		targetDocuments,
		params.tokenizeDocumentText,
	);
	await publishColdEvidence(
		params.coldEvidencePublisher,
		buildShardColdEvidenceRows(targetArtifacts.artifacts, nextActiveShard),
	);
	await params.residentShardArtifactStore.publishResidentShardArtifact({
		descriptor: nextActiveShard,
		shard: targetArtifacts.shard,
		createdAt: params.plannerOptions?.now ?? Date.now(),
	});
	await params.stores.shardRegistry.updateShards(
		[plan.sealedActiveShard, nextActiveShard].filter(
			(descriptor): descriptor is ResidentShardDescriptor => descriptor != null,
		),
	);
	await appendInvalidations(params, plan);
	return {
		appendTargetShard: nextActiveShard,
		sealedActiveShard: plan.sealedActiveShard,
		publishedShards: [nextActiveShard],
		appendedDocCount: plan.appendDocuments.length,
		invalidationCount: plan.invalidationEntries.length,
	};
}

async function publishOversizedAppendBatch(
	params: Parameters<typeof publishActiveShardAppend>[0],
	plan: ReturnType<typeof planActiveShardAppend>,
): Promise<ActiveShardPublishResult> {
	const sealSourceBytes =
		params.plannerOptions?.sealSourceBytes ?? DEFAULT_SHARD_SEAL_SOURCE_BYTES;
	const chunks = splitDocumentsBySourceBytes(plan.appendDocuments, sealSourceBytes);
	const firstCreatedOrder = plan.shouldSealBeforeAppend
		? plan.nextActiveShard.createdOrder
		: params.activeShard.createdOrder;
	const descriptors = chunks.map((documents, index) => {
		const createdOrder = firstCreatedOrder + index;
		const isFirst = index === 0;
		const isLast = index === chunks.length - 1;
		const shardId =
			isFirst
				? plan.nextActiveShard.shardId
				: `active-${createdOrder}`;
		return {
			shardId,
			generation: isFirst ? plan.nextActiveShard.generation : 1,
			state: isLast ? "active" : "sealed",
			sourceBytes: documents.reduce(
				(sum, document) => sum + estimateDocumentSourceBytes(document),
				0,
			),
			docCount: documents.length,
			createdOrder,
			artifactOwner: isFirst ? plan.nextActiveShard.artifactOwner : shardId,
		} satisfies ResidentShardDescriptor;
	});
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		const documents = chunks[index] ?? [];
		const targetArtifacts = buildResidentShardArtifacts(
			descriptor,
			documents,
			params.tokenizeDocumentText,
		);
		await publishColdEvidence(
			params.coldEvidencePublisher,
			buildShardColdEvidenceRows(targetArtifacts.artifacts, descriptor),
		);
		await params.residentShardArtifactStore.publishResidentShardArtifact({
			descriptor,
			shard: targetArtifacts.shard,
			createdAt: params.plannerOptions?.now ?? Date.now(),
		});
	}
	await params.stores.shardRegistry.updateShards(
		[plan.sealedActiveShard, ...descriptors].filter(
			(descriptor): descriptor is ResidentShardDescriptor => descriptor != null,
		),
	);
	await appendInvalidations(params, plan);
	const appendTargetShard = descriptors[descriptors.length - 1] ?? plan.nextActiveShard;
	return {
		appendTargetShard,
		sealedActiveShard: plan.sealedActiveShard,
		publishedShards: descriptors,
		appendedDocCount: plan.appendDocuments.length,
		invalidationCount: plan.invalidationEntries.length,
	};
}

async function appendInvalidations(
	params: Parameters<typeof publishActiveShardAppend>[0],
	plan: ReturnType<typeof planActiveShardAppend>,
): Promise<void> {
	if (plan.invalidationEntries.length > 0) {
		await params.stores.invalidations.appendInvalidations(plan.invalidationEntries);
		await recordShardInvalidationStaleStats({
			stores: params.stores,
			entries: plan.invalidationEntries,
		});
	}
}

function splitDocumentsBySourceBytes(
	documents: readonly IndexedDocument[],
	maxSourceBytes: number,
): readonly IndexedDocument[][] {
	if (documents.length === 0) {
		return [[]];
	}
	const chunks: IndexedDocument[][] = [];
	let currentChunk: IndexedDocument[] = [];
	let currentBytes = 0;
	for (const document of documents) {
		const documentBytes = estimateDocumentSourceBytes(document);
		if (
			currentChunk.length > 0 &&
			currentBytes + documentBytes > maxSourceBytes
		) {
			chunks.push(currentChunk);
			currentChunk = [];
			currentBytes = 0;
		}
		currentChunk.push(document);
		currentBytes += documentBytes;
	}
	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}
	return chunks;
}

function applyChangesToCurrentDocuments(
	currentDocuments: readonly IndexedDocument[],
	changes: readonly ActiveShardAppendChange[],
): readonly IndexedDocument[] {
	let documents = [...currentDocuments];
	for (const change of changes) {
		const previousKey = buildPreviousVersionLiveKey(change.previousVersion);
		if (previousKey != null) {
			documents = documents.filter(
				(document) => buildLiveDocumentKey(document) !== previousKey,
			);
		} else if (change.deleted === true) {
			const deletedKey = buildLiveDocumentKey(change.document);
			documents = documents.filter(
				(document) => buildLiveDocumentKey(document) !== deletedKey,
			);
		}
		if (change.deleted === true) {
			continue;
		}
		documents.push(change.document);
	}
	return documents;
}

function buildLiveDocumentKey(document: IndexedDocument): string {
	return typeof document.docRef === "number" && document.docRef > 0
		? `docref:${document.docRef}`
		: `path:${document.path}`;
}

function buildPreviousVersionLiveKey(
	previousVersion: ActiveShardAppendChange["previousVersion"],
): string | null {
	return previousVersion == null ? null : `docref:${previousVersion.docRef}`;
}

async function resolveCurrentActiveDocuments(params: {
	residentShardArtifactStore: CoverageLexicalV3ResidentShardArtifactStore;
	activeShard: ResidentShardDescriptor;
	currentActiveDocuments?: readonly IndexedDocument[];
	indexedSnapshotReader?: ActiveShardIndexedSnapshotReader;
}): Promise<readonly IndexedDocument[]> {
	if (params.currentActiveDocuments != null) {
		return params.currentActiveDocuments;
	}
	if (params.indexedSnapshotReader == null) {
		throw new Error(
			"publishActiveShardAppend requires indexedSnapshotReader when currentActiveDocuments is not provided",
		);
	}
	return await loadCurrentActiveDocuments({
		activeShard: params.activeShard,
		residentShardArtifactLoader: params.residentShardArtifactStore,
		indexedSnapshotReader: params.indexedSnapshotReader,
	});
}

export function buildShardColdEvidenceRows(
	artifacts: ResidentHotBaseArtifacts,
	descriptor: Pick<ResidentShardDescriptor, "shardId" | "generation">,
): ResidentShardColdEvidenceRows {
	return {
		bodyEvidenceRows: artifacts.bodyEvidenceRows.map((row) => ({
			...row,
			id: buildLexicalBlockEvidenceRowId({
				shardId: descriptor.shardId,
				shardGeneration: descriptor.generation,
				docRef: row.docRef,
				generation: row.generation,
				blockOrdinal: row.blockOrdinal,
			}),
			shardId: descriptor.shardId,
			shardGeneration: descriptor.generation,
		})),
		hanDocEvidenceRows: artifacts.hanDocEvidenceRows.map((row) => ({
			...row,
			id: buildLexicalDocEvidenceRowId({
				shardId: descriptor.shardId,
				shardGeneration: descriptor.generation,
				docRef: row.docRef,
				generation: row.generation,
			}),
			shardId: descriptor.shardId,
			shardGeneration: descriptor.generation,
		})),
		hanBodyEvidenceRows: artifacts.hanBodyEvidenceRows.map((row) => ({
			...row,
			id: buildLexicalBlockEvidenceRowId({
				shardId: descriptor.shardId,
				shardGeneration: descriptor.generation,
				docRef: row.docRef,
				generation: row.generation,
				blockOrdinal: row.blockOrdinal,
			}),
			shardId: descriptor.shardId,
			shardGeneration: descriptor.generation,
		})),
	};
}

function buildResidentShardArtifacts(
	descriptor: ResidentShardDescriptor,
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): Readonly<{ shard: ResidentShard; artifacts: ResidentHotBaseArtifacts }> {
	const artifacts = buildResidentHotBaseArtifacts(documents, tokenizeDocumentText);
	return {
		shard: {
			shardId: descriptor.shardId,
			generation: descriptor.generation,
			base: {
				...artifacts.base,
				fuzzyRescue: artifacts.fuzzyRescueIndex,
			},
		},
		artifacts,
	};
}

async function publishColdEvidence(
	publisher: ActiveShardColdEvidencePublisher | undefined,
	rows: ResidentShardColdEvidenceRows,
): Promise<void> {
	if (publisher == null) {
		return;
	}
	await Promise.all([
		rows.bodyEvidenceRows.length > 0
			? publisher.publishBodyEvidence?.(rows.bodyEvidenceRows) ?? Promise.resolve()
			: Promise.resolve(),
		rows.hanDocEvidenceRows.length > 0
			? publisher.publishHanDocEvidence?.(rows.hanDocEvidenceRows) ?? Promise.resolve()
			: Promise.resolve(),
		rows.hanBodyEvidenceRows.length > 0
			? publisher.publishHanBodyEvidence?.(rows.hanBodyEvidenceRows) ?? Promise.resolve()
			: Promise.resolve(),
	]);
}
