import {
	loadReadableResidentShardArtifacts,
	type CoverageLexicalV3ResidentShardArtifactLoader,
} from "./artifact-loader";
import {
	buildOverlayResidentShard,
	type ActiveOverlayJournalEntry,
	type ActiveOverlayJournalStore,
} from "./active-overlay-journal";
import { planStartupRegistrySafety } from "./compact";
import type { CoverageLexicalV3Engine } from "./engine";
import type { ResidentIndexView } from "./layout/types";
import type { V3DocumentTokenizer } from "./query";
import { isReadableShardState, type ResidentShardDescriptor } from "./shards";
import type { CoverageLexicalV3ProductionStores } from "./stores";

export const COVERAGE_LEXICAL_V3_SNAPSHOT_SCHEMA_VERSION = 1;

export type CoverageLexicalV3SnapshotStatus = "building" | "committed" | "garbage";

export type CoverageLexicalV3SnapshotArtifactRef = Readonly<{
	shardId: string;
	generation: number;
	artifactOwner: string;
}>;

export type CoverageLexicalV3SnapshotOverlayJournalRef = Readonly<{
	entryId: string;
	activeShardId: string;
	activeShardGeneration: number;
	sequence: number;
}>;

export type CoverageLexicalV3SnapshotManifest = Readonly<{
	snapshotId: string;
	schemaVersion: number;
	createdAt: number;
	registryGeneration: number;
	shardDescriptors: readonly ResidentShardDescriptor[];
	activeShardId: string | null;
	overlayIncluded: boolean;
	artifactRefs: readonly CoverageLexicalV3SnapshotArtifactRef[];
	overlayJournalRefs: readonly CoverageLexicalV3SnapshotOverlayJournalRef[];
	invalidationCount: number;
	status: CoverageLexicalV3SnapshotStatus;
}>;

export type CoverageLexicalV3SnapshotStore = Readonly<{
	loadLatestCommittedManifest: () => Promise<CoverageLexicalV3SnapshotManifest | undefined>;
	loadManifests: () => Promise<readonly CoverageLexicalV3SnapshotManifest[]>;
	saveBuildingManifest: (manifest: CoverageLexicalV3SnapshotManifest) => Promise<void>;
	commitManifest: (snapshotId: string) => Promise<void>;
	commitManifestAndMarkOthersGarbage: (snapshotId: string) => Promise<void>;
	markGarbage: (snapshotId: string) => Promise<void>;
	removeGarbageSnapshots: () => Promise<void>;
}>;

type AsyncSnapshotTable<Row, Key> = Readonly<{
	toArray: () => Promise<Row[]>;
	put: (row: Row) => Promise<unknown>;
	delete: (key: Key) => Promise<unknown>;
}>;

export type CoverageLexicalV3SnapshotManifestRow = CoverageLexicalV3SnapshotManifest;

export type CoverageLexicalV3SnapshotWriteResult = Readonly<{
	manifest: CoverageLexicalV3SnapshotManifest;
	committed: boolean;
}>;

export type CoverageLexicalV3SnapshotRestoreResult = Readonly<{
	restored: boolean;
	reason:
		| "restored"
		| "missing_snapshot"
		| "unsupported_schema"
		| "startup_safety_failed"
		| "missing_resident_shard"
		| "missing_overlay_entry";
	loadedShardIds: readonly string[];
	snapshotId?: string;
	fallbackRebuildReason?: string;
}>;

export type CoverageLexicalV3SnapshotHealResult = Readonly<{
	removedGarbageSnapshots: number;
	markedOldCommittedGarbage: number;
}>;

export class MemoryCoverageLexicalV3SnapshotStore implements CoverageLexicalV3SnapshotStore {
	private readonly manifests = new Map<string, CoverageLexicalV3SnapshotManifest>();

	constructor(initialManifests: readonly CoverageLexicalV3SnapshotManifest[] = []) {
		for (const manifest of initialManifests) {
			this.manifests.set(manifest.snapshotId, manifest);
		}
	}

	async loadLatestCommittedManifest(): Promise<CoverageLexicalV3SnapshotManifest | undefined> {
		return latestCommittedManifest([...this.manifests.values()]);
	}

	async loadManifests(): Promise<readonly CoverageLexicalV3SnapshotManifest[]> {
		return sortManifests([...this.manifests.values()]);
	}

	async saveBuildingManifest(manifest: CoverageLexicalV3SnapshotManifest): Promise<void> {
		this.manifests.set(manifest.snapshotId, { ...manifest, status: "building" });
	}

	async commitManifest(snapshotId: string): Promise<void> {
		const manifest = this.manifests.get(snapshotId);
		if (manifest != null) {
			this.manifests.set(snapshotId, { ...manifest, status: "committed" });
		}
	}

	async commitManifestAndMarkOthersGarbage(snapshotId: string): Promise<void> {
		for (const manifest of this.manifests.values()) {
			if (manifest.snapshotId === snapshotId) {
				this.manifests.set(snapshotId, { ...manifest, status: "committed" });
			} else if (manifest.status === "committed") {
				this.manifests.set(manifest.snapshotId, { ...manifest, status: "garbage" });
			}
		}
	}

	async markGarbage(snapshotId: string): Promise<void> {
		const manifest = this.manifests.get(snapshotId);
		if (manifest != null) {
			this.manifests.set(snapshotId, { ...manifest, status: "garbage" });
		}
	}

	async removeGarbageSnapshots(): Promise<void> {
		for (const manifest of this.manifests.values()) {
			if (manifest.status === "garbage") {
				this.manifests.delete(manifest.snapshotId);
			}
		}
	}
}

export class DexieCoverageLexicalV3SnapshotStore implements CoverageLexicalV3SnapshotStore {
	constructor(
		private readonly table: AsyncSnapshotTable<CoverageLexicalV3SnapshotManifestRow, string>,
	) {}

	async loadLatestCommittedManifest(): Promise<CoverageLexicalV3SnapshotManifest | undefined> {
		return latestCommittedManifest(await this.table.toArray());
	}

	async loadManifests(): Promise<readonly CoverageLexicalV3SnapshotManifest[]> {
		return sortManifests(await this.table.toArray());
	}

	async saveBuildingManifest(manifest: CoverageLexicalV3SnapshotManifest): Promise<void> {
		await this.table.put({ ...manifest, status: "building" });
	}

	async commitManifest(snapshotId: string): Promise<void> {
		await this.updateManifestStatus(snapshotId, "committed");
	}

	async commitManifestAndMarkOthersGarbage(snapshotId: string): Promise<void> {
		const manifests = await this.table.toArray();
		await Promise.all(
			manifests.map((manifest) => {
				if (manifest.snapshotId === snapshotId) {
					return this.table.put({ ...manifest, status: "committed" });
				}
				if (manifest.status === "committed") {
					return this.table.put({ ...manifest, status: "garbage" });
				}
				return Promise.resolve();
			}),
		);
	}

	async markGarbage(snapshotId: string): Promise<void> {
		await this.updateManifestStatus(snapshotId, "garbage");
	}

	async removeGarbageSnapshots(): Promise<void> {
		const garbageManifests = (await this.table.toArray()).filter(
			(manifest) => manifest.status === "garbage",
		);
		await Promise.all(garbageManifests.map((manifest) => this.table.delete(manifest.snapshotId)));
	}

	private async updateManifestStatus(
		snapshotId: string,
		status: CoverageLexicalV3SnapshotStatus,
	): Promise<void> {
		const manifest = (await this.table.toArray()).find((row) => row.snapshotId === snapshotId);
		if (manifest != null) {
			await this.table.put({ ...manifest, status });
		}
	}
}

export async function writeCoverageLexicalV3Snapshot(params: {
	snapshotStore: CoverageLexicalV3SnapshotStore;
	stores: CoverageLexicalV3ProductionStores;
	overlayJournalStore: ActiveOverlayJournalStore;
	now?: number;
	snapshotId?: string;
}): Promise<CoverageLexicalV3SnapshotWriteResult> {
	const now = params.now ?? Date.now();
	const registry = await params.stores.shardRegistry.loadRegistry();
	const readableRegistry = registry.filter((descriptor) => isReadableShardState(descriptor.state));
	const activeShard = readableRegistry.find((descriptor) => descriptor.state === "active") ?? null;
	const overlayEntries = activeShard == null
		? []
		: await params.overlayJournalStore.loadActiveOverlayEntries({
				activeShardId: activeShard.shardId,
				activeShardGeneration: activeShard.generation,
			});
	const invalidations = await params.stores.invalidations.loadInvalidations();
	const manifest: CoverageLexicalV3SnapshotManifest = {
		snapshotId: params.snapshotId ?? `v3-snapshot-${now}`,
		schemaVersion: COVERAGE_LEXICAL_V3_SNAPSHOT_SCHEMA_VERSION,
		createdAt: now,
		registryGeneration: maxRegistryGeneration(readableRegistry),
		shardDescriptors: readableRegistry,
		activeShardId: activeShard?.shardId ?? null,
		overlayIncluded: true,
		artifactRefs: readableRegistry.map((descriptor) => ({
			shardId: descriptor.shardId,
			generation: descriptor.generation,
			artifactOwner: descriptor.artifactOwner,
		})),
		overlayJournalRefs: overlayEntries.map((entry) => ({
			entryId: entry.id,
			activeShardId: entry.activeShardId,
			activeShardGeneration: entry.activeShardGeneration,
			sequence: entry.sequence,
		})),
		invalidationCount: invalidations.length,
		status: "building",
	};
	await params.snapshotStore.saveBuildingManifest(manifest);
	await params.snapshotStore.commitManifestAndMarkOthersGarbage(manifest.snapshotId);
	return {
		manifest: { ...manifest, status: "committed" },
		committed: true,
	};
}

export async function restoreCoverageLexicalV3Snapshot(params: {
	snapshotStore: CoverageLexicalV3SnapshotStore;
	engine: CoverageLexicalV3Engine;
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactLoader: CoverageLexicalV3ResidentShardArtifactLoader;
	overlayJournalStore: ActiveOverlayJournalStore;
	tokenizeDocumentText?: V3DocumentTokenizer;
}): Promise<CoverageLexicalV3SnapshotRestoreResult> {
	const manifest = await params.snapshotStore.loadLatestCommittedManifest();
	if (manifest == null) {
		return { restored: false, reason: "missing_snapshot", loadedShardIds: [] };
	}
	if (manifest.schemaVersion !== COVERAGE_LEXICAL_V3_SNAPSHOT_SCHEMA_VERSION) {
		return {
			restored: false,
			reason: "unsupported_schema",
			loadedShardIds: [],
			snapshotId: manifest.snapshotId,
		};
	}
	const safetyAction = planStartupRegistrySafety(manifest.shardDescriptors);
	if (safetyAction.type === "fallback_rebuild") {
		return {
			restored: false,
			reason: "startup_safety_failed",
			loadedShardIds: [],
			snapshotId: manifest.snapshotId,
			fallbackRebuildReason: safetyAction.reason,
		};
	}
	const readableRegistry = manifest.shardDescriptors.filter((descriptor) =>
		isReadableShardState(descriptor.state),
	);
	const readableShards = await loadReadableResidentShardArtifacts({
		registry: readableRegistry,
		loader: params.residentShardArtifactLoader,
	});
	if (readableShards.length !== readableRegistry.length) {
		return {
			restored: false,
			reason: "missing_resident_shard",
			loadedShardIds: readableShards.map((shard) => shard.shardId),
			snapshotId: manifest.snapshotId,
		};
	}
	params.engine.loadResidentIndexView({
		version: 1,
		shards: readableShards,
		shardRegistry: readableRegistry,
	} satisfies ResidentIndexView);
	params.engine.loadShardInvalidations(await params.stores.invalidations.loadInvalidations());
	const overlayEntries = await loadSnapshotOverlayEntries({
		manifest,
		overlayJournalStore: params.overlayJournalStore,
	});
	if (overlayEntries == null) {
		return {
			restored: false,
			reason: "missing_overlay_entry",
			loadedShardIds: readableShards.map((shard) => shard.shardId),
			snapshotId: manifest.snapshotId,
		};
	}
	if (overlayEntries.length > 0) {
		params.engine.loadOverlayResidentShard(
			buildOverlayResidentShard({
				activeShardId: overlayEntries[0].activeShardId,
				activeShardGeneration: overlayEntries[0].activeShardGeneration,
				entries: overlayEntries,
				tokenizeDocumentText: params.tokenizeDocumentText,
			}),
		);
	} else {
		params.engine.clearOverlayResidentShard();
	}
	return {
		restored: true,
		reason: "restored",
		loadedShardIds: readableShards.map((shard) => shard.shardId),
		snapshotId: manifest.snapshotId,
	};
}

export async function healCoverageLexicalV3SnapshotState(params: {
	snapshotStore: CoverageLexicalV3SnapshotStore;
}): Promise<CoverageLexicalV3SnapshotHealResult> {
	const before = await params.snapshotStore.loadManifests();
	const latestCommitted = latestCommittedManifest(before);
	let markedOldCommittedGarbage = 0;
	for (const manifest of before) {
		if (manifest.status === "building") {
			await params.snapshotStore.markGarbage(manifest.snapshotId);
			continue;
		}
		if (
			manifest.status === "committed" &&
			latestCommitted != null &&
			manifest.snapshotId !== latestCommitted.snapshotId
		) {
			await params.snapshotStore.markGarbage(manifest.snapshotId);
			markedOldCommittedGarbage += 1;
		}
	}
	const withGarbage = await params.snapshotStore.loadManifests();
	const garbageCount = withGarbage.filter((manifest) => manifest.status === "garbage").length;
	await params.snapshotStore.removeGarbageSnapshots();
	return {
		removedGarbageSnapshots: garbageCount,
		markedOldCommittedGarbage,
	};
}

export function createDexieCoverageLexicalV3SnapshotStore(
	table: AsyncSnapshotTable<CoverageLexicalV3SnapshotManifestRow, string>,
): CoverageLexicalV3SnapshotStore {
	return new DexieCoverageLexicalV3SnapshotStore(table);
}

async function loadSnapshotOverlayEntries(params: {
	manifest: CoverageLexicalV3SnapshotManifest;
	overlayJournalStore: ActiveOverlayJournalStore;
}): Promise<readonly ActiveOverlayJournalEntry[] | null> {
	if (!params.manifest.overlayIncluded || params.manifest.activeShardId == null) {
		return [];
	}
	const activeShard = params.manifest.shardDescriptors.find(
		(descriptor) => descriptor.shardId === params.manifest.activeShardId,
	);
	if (activeShard == null) {
		return [];
	}
	// A snapshot anchors the resident base, while the active overlay journal is
	// a durable tail. Requiring manifest refs protects entries observed during
	// snapshot write; replaying the whole active-shard tail also preserves
	// entries committed after the snapshot but before a startup crash.
	const entries = await params.overlayJournalStore.loadActiveOverlayEntries({
		activeShardId: activeShard.shardId,
		activeShardGeneration: activeShard.generation,
	});
	const entryIds = new Set(entries.map((entry) => entry.id));
	const hasAllReferencedEntries = params.manifest.overlayJournalRefs.every((ref) =>
		entryIds.has(ref.entryId),
	);
	return hasAllReferencedEntries ? entries : null;
}

function latestCommittedManifest(
	manifests: readonly CoverageLexicalV3SnapshotManifest[],
): CoverageLexicalV3SnapshotManifest | undefined {
	return sortManifests(manifests.filter((manifest) => manifest.status === "committed")).at(-1);
}

function sortManifests(
	manifests: readonly CoverageLexicalV3SnapshotManifest[],
): readonly CoverageLexicalV3SnapshotManifest[] {
	return [...manifests].sort((left, right) => left.createdAt - right.createdAt);
}

function maxRegistryGeneration(registry: readonly ResidentShardDescriptor[]): number {
	return registry.reduce((maxGeneration, descriptor) => Math.max(maxGeneration, descriptor.generation), 0);
}
