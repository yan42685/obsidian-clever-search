import type { ShardInvalidationEntry } from "./invalidation";
import type { ResidentShardDescriptor } from "./shards";

type AsyncTable<Row, Key> = Readonly<{
	toArray: () => Promise<Row[]>;
	bulkPut: (rows: readonly Row[]) => Promise<unknown>;
	put: (row: Row) => Promise<unknown>;
	delete: (key: Key) => Promise<unknown>;
	clear: () => Promise<unknown>;
}>;

export type CoverageLexicalV3ShardRegistryRow = ResidentShardDescriptor;

export type CoverageLexicalV3InvalidationRow = ShardInvalidationEntry &
	Readonly<{ id: string }>;

export type CoverageLexicalV3ShardRegistryStore = Readonly<{
	loadRegistry: () => Promise<readonly ResidentShardDescriptor[]>;
	saveRegistry: (registry: readonly ResidentShardDescriptor[]) => Promise<void>;
	updateShard: (descriptor: ResidentShardDescriptor) => Promise<void>;
	updateShards: (descriptors: readonly ResidentShardDescriptor[]) => Promise<void>;
	removeShards: (shardIds: readonly string[]) => Promise<void>;
}>;

export type CoverageLexicalV3InvalidationStore = Readonly<{
	loadInvalidations: () => Promise<readonly ShardInvalidationEntry[]>;
	appendInvalidations: (entries: readonly ShardInvalidationEntry[]) => Promise<void>;
	removeInvalidationsForShards: (shardIds: readonly string[]) => Promise<void>;
	clearInvalidations: () => Promise<void>;
}>;

export type CoverageLexicalV3ProductionStores = Readonly<{
	shardRegistry: CoverageLexicalV3ShardRegistryStore;
	invalidations: CoverageLexicalV3InvalidationStore;
}>;

export class MemoryCoverageLexicalV3ShardRegistryStore
	implements CoverageLexicalV3ShardRegistryStore
{
	private registry: ResidentShardDescriptor[];

	constructor(initialRegistry: readonly ResidentShardDescriptor[] = []) {
		this.registry = [...initialRegistry];
	}

	async loadRegistry(): Promise<readonly ResidentShardDescriptor[]> {
		return [...this.registry];
	}

	async saveRegistry(registry: readonly ResidentShardDescriptor[]): Promise<void> {
		this.registry = [...registry].sort((left, right) => left.createdOrder - right.createdOrder);
	}

	async updateShard(descriptor: ResidentShardDescriptor): Promise<void> {
		await this.updateShards([descriptor]);
	}

	async updateShards(descriptors: readonly ResidentShardDescriptor[]): Promise<void> {
		if (descriptors.length === 0) {
			return;
		}
		const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.shardId, descriptor]));
		const updatedShardIds = new Set(descriptorById.keys());
		this.registry = [
			...this.registry.map((shard) => descriptorById.get(shard.shardId) ?? shard),
			...descriptors.filter((descriptor) =>
				!this.registry.some((shard) => shard.shardId === descriptor.shardId),
			),
		].filter((shard, index, shards) => {
			if (!updatedShardIds.has(shard.shardId)) {
				return true;
			}
			return shards.findIndex((candidate) => candidate.shardId === shard.shardId) === index;
		});
		this.registry = [...this.registry].sort(
			(left, right) => left.createdOrder - right.createdOrder,
		);
	}

	async removeShards(shardIds: readonly string[]): Promise<void> {
		const removedShardIds = new Set(shardIds);
		this.registry = this.registry.filter((shard) => !removedShardIds.has(shard.shardId));
	}
}

export class MemoryCoverageLexicalV3InvalidationStore
	implements CoverageLexicalV3InvalidationStore
{
	private invalidations: ShardInvalidationEntry[];

	constructor(initialInvalidations: readonly ShardInvalidationEntry[] = []) {
		this.invalidations = [...initialInvalidations];
	}

	async loadInvalidations(): Promise<readonly ShardInvalidationEntry[]> {
		return [...this.invalidations];
	}

	async appendInvalidations(entries: readonly ShardInvalidationEntry[]): Promise<void> {
		this.invalidations = [...this.invalidations, ...entries];
	}

	async removeInvalidationsForShards(shardIds: readonly string[]): Promise<void> {
		const removedShardIds = new Set(shardIds);
		this.invalidations = this.invalidations.filter(
			(entry) => !removedShardIds.has(entry.shardId),
		);
	}

	async clearInvalidations(): Promise<void> {
		this.invalidations = [];
	}
}

export class DexieCoverageLexicalV3ShardRegistryStore
	implements CoverageLexicalV3ShardRegistryStore
{
	constructor(
		private readonly table: AsyncTable<CoverageLexicalV3ShardRegistryRow, string>,
	) {}

	async loadRegistry(): Promise<readonly ResidentShardDescriptor[]> {
		return (await this.table.toArray()).sort(
			(left, right) => left.createdOrder - right.createdOrder,
		);
	}

	async saveRegistry(registry: readonly ResidentShardDescriptor[]): Promise<void> {
		await this.table.clear();
		await this.table.bulkPut([...registry]);
	}

	async updateShard(descriptor: ResidentShardDescriptor): Promise<void> {
		await this.table.put(descriptor);
	}

	async updateShards(descriptors: readonly ResidentShardDescriptor[]): Promise<void> {
		if (descriptors.length === 0) {
			return;
		}
		await this.table.bulkPut([...descriptors]);
	}

	async removeShards(shardIds: readonly string[]): Promise<void> {
		await Promise.all(shardIds.map((shardId) => this.table.delete(shardId)));
	}
}

export class DexieCoverageLexicalV3InvalidationStore
	implements CoverageLexicalV3InvalidationStore
{
	constructor(
		private readonly table: AsyncTable<CoverageLexicalV3InvalidationRow, string>,
	) {}

	async loadInvalidations(): Promise<readonly ShardInvalidationEntry[]> {
		return (await this.table.toArray()).map(({ id: _id, ...entry }) => entry);
	}

	async appendInvalidations(entries: readonly ShardInvalidationEntry[]): Promise<void> {
		await this.table.bulkPut(entries.map(toInvalidationRow));
	}

	async removeInvalidationsForShards(shardIds: readonly string[]): Promise<void> {
		const removedShardIds = new Set(shardIds);
		const keptRows = (await this.table.toArray()).filter(
			(row) => !removedShardIds.has(row.shardId),
		);
		await this.table.clear();
		await this.table.bulkPut(keptRows);
	}

	async clearInvalidations(): Promise<void> {
		await this.table.clear();
	}
}

export function createDexieCoverageLexicalV3ProductionStores(tables: {
	shardRegistry: AsyncTable<CoverageLexicalV3ShardRegistryRow, string>;
	invalidations: AsyncTable<CoverageLexicalV3InvalidationRow, string>;
}): CoverageLexicalV3ProductionStores {
	return {
		shardRegistry: new DexieCoverageLexicalV3ShardRegistryStore(tables.shardRegistry),
		invalidations: new DexieCoverageLexicalV3InvalidationStore(tables.invalidations),
	};
}

export function createMemoryCoverageLexicalV3ProductionStores(params: {
	registry?: readonly ResidentShardDescriptor[];
	invalidations?: readonly ShardInvalidationEntry[];
} = {}): CoverageLexicalV3ProductionStores {
	return {
		shardRegistry: new MemoryCoverageLexicalV3ShardRegistryStore(params.registry ?? []),
		invalidations: new MemoryCoverageLexicalV3InvalidationStore(
			params.invalidations ?? [],
		),
	};
}

function toInvalidationRow(entry: ShardInvalidationEntry): CoverageLexicalV3InvalidationRow {
	return {
		...entry,
		id: `${entry.shardId}@${entry.shardGeneration}:docref:${entry.docRef}@${entry.docGeneration}`,
	};
}
