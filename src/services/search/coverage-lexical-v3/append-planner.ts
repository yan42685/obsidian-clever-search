import type { IndexedDocument } from "src/globals/search-types";
import {
	DEFAULT_SHARD_SEAL_SOURCE_BYTES,
	type ResidentShardDescriptor,
} from "./shards";
import type { ShardInvalidationEntry } from "./invalidation";

export type ExistingShardDocVersion = Readonly<{
	shardId: string;
	shardGeneration: number;
	docRef: number;
	docGeneration: number;
}>;

export type ActiveShardAppendChange = Readonly<{
	document: IndexedDocument;
	previousVersion?: ExistingShardDocVersion | null;
	deleted?: boolean;
}>;

export type ActiveShardAppendPlan = Readonly<{
	appendDocuments: readonly IndexedDocument[];
	invalidationEntries: readonly ShardInvalidationEntry[];
	sealedActiveShard: ResidentShardDescriptor | null;
	nextActiveShard: ResidentShardDescriptor;
	appendTargetShardId: string;
	appendTargetShardGeneration: number;
	shouldSealBeforeAppend: boolean;
}>;

export type ActiveShardAppendPlannerOptions = Readonly<{
	sealSourceBytes?: number;
	now?: number;
	nextShardId?: string;
	nextCreatedOrder?: number;
}>;

export function planActiveShardAppend(
	activeShard: ResidentShardDescriptor,
	changes: readonly ActiveShardAppendChange[],
	options: ActiveShardAppendPlannerOptions = {},
): ActiveShardAppendPlan {
	if (activeShard.state !== "active") {
		throw new Error("planActiveShardAppend requires an active shard");
	}
	const sealSourceBytes = options.sealSourceBytes ?? DEFAULT_SHARD_SEAL_SOURCE_BYTES;
	const appendDocuments = changes
		.filter((change) => change.deleted !== true)
		.map((change) => change.document);
	const appendSourceBytes = appendDocuments.reduce(
		(sum, document) => sum + estimateDocumentSourceBytes(document),
		0,
	);
	const shouldSealBeforeAppend =
		activeShard.sourceBytes > 0 && activeShard.sourceBytes + appendSourceBytes > sealSourceBytes;
	const appendTargetShard = shouldSealBeforeAppend
		? createNextActiveShard(activeShard, options)
		: activeShard;
	const sealedActiveShard = shouldSealBeforeAppend
		? {
				...activeShard,
				state: "sealing" as const,
		  }
		: null;
	return {
		appendDocuments,
		invalidationEntries: buildInvalidationEntries(changes, options.now ?? Date.now()),
		sealedActiveShard,
		nextActiveShard: {
			...appendTargetShard,
			sourceBytes: appendTargetShard.sourceBytes + appendSourceBytes,
			docCount: appendTargetShard.docCount + appendDocuments.length,
		},
		appendTargetShardId: appendTargetShard.shardId,
		appendTargetShardGeneration: appendTargetShard.generation,
		shouldSealBeforeAppend,
	};
}

export function estimateDocumentSourceBytes(document: IndexedDocument): number {
	const metadataBytes =
		byteLengthUtf8(document.path) +
		byteLengthUtf8(document.basename) +
		byteLengthUtf8(document.folder) +
		byteLengthUtf8(document.aliases ?? "") +
		byteLengthUtf8(document.tags ?? "") +
		byteLengthUtf8(document.headings ?? "");
	if (document.size != null) {
		return document.size + metadataBytes;
	}
	const contentBytes = document.content == null ? 0 : byteLengthUtf8(document.content);
	return contentBytes + metadataBytes;
}

function buildInvalidationEntries(
	changes: readonly ActiveShardAppendChange[],
	now: number,
): ShardInvalidationEntry[] {
	return changes.flatMap((change) => {
		const previousVersion = change.previousVersion;
		if (previousVersion == null) {
			return [];
		}
		return [
			{
				shardId: previousVersion.shardId,
				shardGeneration: previousVersion.shardGeneration,
				docRef: previousVersion.docRef,
				docGeneration: previousVersion.docGeneration,
				reason: change.deleted === true ? "deleted" : "superseded",
				createdAt: now,
			},
		];
	});
}

function createNextActiveShard(
	activeShard: ResidentShardDescriptor,
	options: ActiveShardAppendPlannerOptions,
): ResidentShardDescriptor {
	const nextCreatedOrder = options.nextCreatedOrder ?? activeShard.createdOrder + 1;
	const nextShardId = options.nextShardId ?? `active-${nextCreatedOrder}`;
	return {
		shardId: nextShardId,
		generation: 1,
		state: "active",
		sourceBytes: 0,
		docCount: 0,
		createdOrder: nextCreatedOrder,
		artifactOwner: nextShardId,
	};
}

function byteLengthUtf8(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}
