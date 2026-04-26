import type { ResidentBase, ResidentShard } from "./layout/types";
import type { ResidentShardDescriptor } from "./shards";

export type CoverageLexicalV3ResidentShardArtifactLoader = Readonly<{
	loadResidentShard: (
		descriptor: ResidentShardDescriptor,
	) => Promise<ResidentShard | undefined>;
}>;

type AsyncArtifactTable<Row, Key> = Readonly<{
	get: (key: Key) => Promise<Row | undefined>;
	put: (row: Row) => Promise<unknown>;
	delete: (key: Key) => Promise<unknown>;
}>;

export type CoverageLexicalV3ResidentShardArtifactRow = Readonly<{
	id: string;
	shardId: string;
	generation: number;
	artifactOwner: string;
	base: ResidentBase;
	createdAt: number;
}>;

export type CoverageLexicalV3ResidentShardArtifactStore =
	CoverageLexicalV3ResidentShardArtifactLoader &
		Readonly<{
			publishResidentShardArtifact: (params: {
				descriptor: ResidentShardDescriptor;
				shard: ResidentShard;
				createdAt: number;
			}) => Promise<void>;
			removeResidentShardArtifact: (
				descriptor: Pick<ResidentShardDescriptor, "artifactOwner" | "generation">,
			) => Promise<void>;
		}>;

export class DexieCoverageLexicalV3ResidentShardArtifactStore
	implements CoverageLexicalV3ResidentShardArtifactStore
{
	constructor(
		private readonly table: AsyncArtifactTable<
			CoverageLexicalV3ResidentShardArtifactRow,
			string
		>,
	) {}

	async loadResidentShard(
		descriptor: ResidentShardDescriptor,
	): Promise<ResidentShard | undefined> {
		const row = await this.table.get(buildArtifactRowId(descriptor));
		if (row == null) {
			return undefined;
		}
		return {
			shardId: descriptor.shardId,
			generation: descriptor.generation,
			base: row.base,
		};
	}

	async publishResidentShardArtifact(params: {
		descriptor: ResidentShardDescriptor;
		shard: ResidentShard;
		createdAt: number;
	}): Promise<void> {
		await this.table.put({
			id: buildArtifactRowId(params.descriptor),
			shardId: params.descriptor.shardId,
			generation: params.descriptor.generation,
			artifactOwner: params.descriptor.artifactOwner,
			base: params.shard.base,
			createdAt: params.createdAt,
		});
	}

	async removeResidentShardArtifact(
		descriptor: Pick<ResidentShardDescriptor, "artifactOwner" | "generation">,
	): Promise<void> {
		await this.table.delete(buildArtifactRowId(descriptor));
	}
}

export async function loadReadableResidentShardArtifacts(params: {
	registry: readonly ResidentShardDescriptor[];
	loader: CoverageLexicalV3ResidentShardArtifactLoader;
}): Promise<readonly ResidentShard[]> {
	const loadedShards: ResidentShard[] = [];
	for (const descriptor of [...params.registry].sort(
		(left, right) => left.createdOrder - right.createdOrder,
	)) {
		const shard = await params.loader.loadResidentShard(descriptor);
		if (shard != null) {
			loadedShards.push(shard);
		}
	}
	return loadedShards;
}

export function createDexieCoverageLexicalV3ResidentShardArtifactStore(
	table: AsyncArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>,
): CoverageLexicalV3ResidentShardArtifactStore {
	return new DexieCoverageLexicalV3ResidentShardArtifactStore(table);
}

function buildArtifactRowId(
	descriptor: Pick<ResidentShardDescriptor, "artifactOwner" | "generation">,
): string {
	return `${descriptor.artifactOwner}@${descriptor.generation}`;
}
