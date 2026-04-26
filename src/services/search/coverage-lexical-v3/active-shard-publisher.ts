import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentHotBaseArtifacts } from "./build";
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
import type { CoverageLexicalV3ProductionStores } from "./stores";

export type ActiveShardPublishResult = Readonly<{
	appendTargetShard: ResidentShardDescriptor;
	sealedActiveShard: ResidentShardDescriptor | null;
	publishedShards: readonly ResidentShardDescriptor[];
	appendedDocCount: number;
	invalidationCount: number;
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
}): Promise<ActiveShardPublishResult> {
	const plan = planActiveShardAppend(
		params.activeShard,
		params.changes,
		params.plannerOptions,
	);
	if (plan.sealedActiveShard != null) {
		await params.stores.shardRegistry.updateShard(plan.sealedActiveShard);
	}
	if (plan.invalidationEntries.length > 0) {
		await params.stores.invalidations.appendInvalidations(plan.invalidationEntries);
	}
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
		: [...currentActiveDocuments, ...plan.appendDocuments];
	const targetShard = buildResidentShard(
		plan.nextActiveShard,
		targetDocuments,
		params.tokenizeDocumentText,
	);
	await params.residentShardArtifactStore.publishResidentShardArtifact({
		descriptor: plan.nextActiveShard,
		shard: targetShard,
		createdAt: params.plannerOptions?.now ?? Date.now(),
	});
	await params.stores.shardRegistry.updateShard(plan.nextActiveShard);
	return {
		appendTargetShard: plan.nextActiveShard,
		sealedActiveShard: plan.sealedActiveShard,
		publishedShards: [plan.nextActiveShard],
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
		const isLast = index === chunks.length - 1;
		const shardId =
			index === 0
				? plan.nextActiveShard.shardId
				: `active-${createdOrder}`;
		return {
			shardId,
			generation: 1,
			state: isLast ? "active" : "sealed",
			sourceBytes: documents.reduce(
				(sum, document) => sum + estimateDocumentSourceBytes(document),
				0,
			),
			docCount: documents.length,
			createdOrder,
			artifactOwner: shardId,
		} satisfies ResidentShardDescriptor;
	});
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		const documents = chunks[index] ?? [];
		await params.residentShardArtifactStore.publishResidentShardArtifact({
			descriptor,
			shard: buildResidentShard(
				descriptor,
				documents,
				params.tokenizeDocumentText,
			),
			createdAt: params.plannerOptions?.now ?? Date.now(),
		});
		await params.stores.shardRegistry.updateShard(descriptor);
	}
	const appendTargetShard = descriptors[descriptors.length - 1] ?? plan.nextActiveShard;
	return {
		appendTargetShard,
		sealedActiveShard: plan.sealedActiveShard,
		publishedShards: descriptors,
		appendedDocCount: plan.appendDocuments.length,
		invalidationCount: plan.invalidationEntries.length,
	};
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

function buildResidentShard(
	descriptor: ResidentShardDescriptor,
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): ResidentShard {
	const artifacts = buildResidentHotBaseArtifacts(documents, tokenizeDocumentText);
	return {
		shardId: descriptor.shardId,
		generation: descriptor.generation,
		base: {
			...artifacts.base,
			fuzzyRescue: artifacts.fuzzyRescueIndex,
		},
	};
}
