import { buildShardInvalidationKey, type ShardInvalidationEntry } from "./invalidation";
import { isReadableShardState, type ResidentShardDescriptor } from "./shards";

type AsyncTable<Row, Key> = Readonly<{
	toArray: () => Promise<Row[]>;
	bulkPut: (rows: readonly Row[]) => Promise<unknown>;
	put: (row: Row) => Promise<unknown>;
	delete: (key: Key) => Promise<unknown>;
	clear: () => Promise<unknown>;
}>;

type AsyncTransactionScope = Readonly<{
	transaction: (
		mode: "rw",
		...args: [...unknown[], () => Promise<void>]
	) => Promise<unknown>;
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

export async function recordShardInvalidationStaleStats(params: {
	stores: CoverageLexicalV3ProductionStores;
	entries: readonly ShardInvalidationEntry[];
}): Promise<void> {
	if (params.entries.length === 0) {
		return;
	}
	const invalidationCountByShardKey = new Map<string, number>();
	for (const entry of params.entries) {
		const key = shardGenerationKey(entry.shardId, entry.shardGeneration);
		invalidationCountByShardKey.set(key, (invalidationCountByShardKey.get(key) ?? 0) + 1);
	}
	const registry = await params.stores.shardRegistry.loadRegistry();
	const updatedDescriptors: ResidentShardDescriptor[] = [];
	for (const descriptor of registry) {
		if (!isReadableShardState(descriptor.state) || descriptor.docCount <= 0) {
			continue;
		}
		const invalidationCount = invalidationCountByShardKey.get(
			shardGenerationKey(descriptor.shardId, descriptor.generation),
		);
		if (invalidationCount == null || invalidationCount <= 0) {
			continue;
		}
		const currentStaleDocCount = descriptor.staleDocCount ?? 0;
		const remainingLiveDocBudget = Math.max(0, descriptor.docCount - currentStaleDocCount);
		const addedStaleDocCount = Math.min(invalidationCount, remainingLiveDocBudget);
		if (addedStaleDocCount <= 0) {
			continue;
		}
		const estimatedSourceBytesPerDoc = descriptor.sourceBytes / descriptor.docCount;
		const currentStaleSourceBytes = descriptor.staleSourceBytes ?? 0;
		updatedDescriptors.push({
			...descriptor,
			staleDocCount: Math.min(
				descriptor.docCount,
				currentStaleDocCount + addedStaleDocCount,
			),
			staleSourceBytes: Math.min(
				descriptor.sourceBytes,
				Math.ceil(currentStaleSourceBytes + estimatedSourceBytesPerDoc * addedStaleDocCount),
			),
		});
	}
	await params.stores.shardRegistry.updateShards(updatedDescriptors);
}

export async function reconcileShardInvalidationStaleStats(params: {
	stores: CoverageLexicalV3ProductionStores;
	invalidations?: readonly ShardInvalidationEntry[];
}): Promise<boolean> {
	const invalidations =
		params.invalidations ?? (await params.stores.invalidations.loadInvalidations());
	const seenInvalidationKeys = new Set<string>();
	const invalidationCountByShardKey = new Map<string, number>();
	for (const entry of invalidations) {
		const invalidationKey = buildShardInvalidationKey(entry);
		if (seenInvalidationKeys.has(invalidationKey)) {
			continue;
		}
		seenInvalidationKeys.add(invalidationKey);
		const key = shardGenerationKey(entry.shardId, entry.shardGeneration);
		invalidationCountByShardKey.set(key, (invalidationCountByShardKey.get(key) ?? 0) + 1);
	}
	const registry = await params.stores.shardRegistry.loadRegistry();
	const updatedDescriptors: ResidentShardDescriptor[] = [];
	for (const descriptor of registry) {
		if (!isReadableShardState(descriptor.state) || descriptor.docCount <= 0) {
			continue;
		}
		const invalidationCount =
			invalidationCountByShardKey.get(
				shardGenerationKey(descriptor.shardId, descriptor.generation),
			) ?? 0;
		const staleDocCount = Math.min(descriptor.docCount, invalidationCount);
		const staleSourceBytes = Math.min(
			descriptor.sourceBytes,
			Math.ceil((descriptor.sourceBytes / descriptor.docCount) * staleDocCount),
		);
		if (
			(descriptor.staleDocCount ?? 0) === staleDocCount &&
			(descriptor.staleSourceBytes ?? 0) === staleSourceBytes
		) {
			continue;
		}
		updatedDescriptors.push({
			...descriptor,
			staleDocCount,
			staleSourceBytes,
		});
	}
	if (updatedDescriptors.length === 0) {
		return false;
	}
	await params.stores.shardRegistry.updateShards(updatedDescriptors);
	return true;
}

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
		private readonly transactionScope?: AsyncTransactionScope,
	) {}

	async loadRegistry(): Promise<readonly ResidentShardDescriptor[]> {
		return (await this.table.toArray()).sort(
			(left, right) => left.createdOrder - right.createdOrder,
		);
	}

	async saveRegistry(registry: readonly ResidentShardDescriptor[]): Promise<void> {
		const replaceRegistry = async () => {
			const nextShardIds = new Set(registry.map((descriptor) => descriptor.shardId));
			const obsoleteShardIds = (await this.table.toArray())
				.map((descriptor) => descriptor.shardId)
				.filter((shardId) => !nextShardIds.has(shardId));
			await this.table.bulkPut([...registry]);
			await Promise.all(obsoleteShardIds.map((shardId) => this.table.delete(shardId)));
		};
		if (this.transactionScope == null) {
			await replaceRegistry();
			return;
		}
		await this.transactionScope.transaction("rw", this.table, replaceRegistry);
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
		const removedRowIds = (await this.table.toArray())
			.filter((row) => removedShardIds.has(row.shardId))
			.map((row) => row.id);
		await Promise.all(
			removedRowIds.map((rowId) => this.table.delete(rowId)),
		);
	}

	async clearInvalidations(): Promise<void> {
		await this.table.clear();
	}
}

export function createDexieCoverageLexicalV3ProductionStores(tables: {
	shardRegistry: AsyncTable<CoverageLexicalV3ShardRegistryRow, string>;
	invalidations: AsyncTable<CoverageLexicalV3InvalidationRow, string>;
	transactionScope?: AsyncTransactionScope;
}): CoverageLexicalV3ProductionStores {
	return {
		shardRegistry: new DexieCoverageLexicalV3ShardRegistryStore(
			tables.shardRegistry,
			tables.transactionScope,
		),
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

function shardGenerationKey(shardId: string, generation: number): string {
	return `${shardId}@${generation}`;
}
