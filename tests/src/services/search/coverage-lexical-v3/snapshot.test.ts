import type { IndexedDocument } from "src/globals/search-types";
import {
	createDexieCoverageLexicalV3ResidentShardArtifactStore,
	type CoverageLexicalV3ResidentShardArtifactRow,
} from "src/services/search/coverage-lexical-v3/artifact-loader";
import { buildActiveOverlayJournalEntryId, MemoryActiveOverlayJournalStore } from "src/services/search/coverage-lexical-v3/active-overlay-journal";
import { buildResidentHotBaseArtifacts } from "src/services/search/coverage-lexical-v3/build";
import { bootstrapCoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/bootstrap";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import type { ResidentShard } from "src/services/search/coverage-lexical-v3/layout/types";
import type { ResidentShardDescriptor } from "src/services/search/coverage-lexical-v3/shards";
import {
	healCoverageLexicalV3SnapshotState,
	MemoryCoverageLexicalV3SnapshotStore,
	restoreCoverageLexicalV3Snapshot,
	writeCoverageLexicalV3Snapshot,
	type CoverageLexicalV3SnapshotManifest,
} from "src/services/search/coverage-lexical-v3/snapshot";
import { createMemoryCoverageLexicalV3ProductionStores } from "src/services/search/coverage-lexical-v3/stores";

class FakeArtifactTable<Row extends Record<string, unknown>, Key extends string> {
	private rows = new Map<Key, Row>();

	constructor(private readonly keyOf: (row: Row) => Key) {}

	async get(key: Key): Promise<Row | undefined> {
		return this.rows.get(key);
	}

	async put(row: Row): Promise<void> {
		this.rows.set(this.keyOf(row), row);
	}

	async delete(key: Key): Promise<void> {
		this.rows.delete(key);
	}
}

function doc(path: string, content: string, docRef: number, generation = 1): IndexedDocument {
	return {
		path,
		basename: path.replace(/\.md$/, ""),
		folder: "notes",
		content,
		headings: content,
		docRef,
		generation,
	};
}

function residentShard(shardId: string, documents: readonly IndexedDocument[]): ResidentShard {
	const artifacts = buildResidentHotBaseArtifacts(documents);
	return {
		shardId,
		generation: 1,
		base: {
			...artifacts.base,
			fuzzyRescue: artifacts.fuzzyRescueIndex,
		},
	};
}

function descriptor(
	shardId: string,
	state: ResidentShardDescriptor["state"],
	createdOrder: number,
): ResidentShardDescriptor {
	return {
		shardId,
		generation: 1,
		state,
		sourceBytes: 100,
		docCount: 1,
		createdOrder,
		artifactOwner: shardId,
	};
}

function manifest(params: {
	snapshotId: string;
	status: CoverageLexicalV3SnapshotManifest["status"];
	createdAt: number;
	shards: readonly ResidentShardDescriptor[];
}): CoverageLexicalV3SnapshotManifest {
	return {
		snapshotId: params.snapshotId,
		schemaVersion: 1,
		createdAt: params.createdAt,
		registryGeneration: 1,
		shardDescriptors: params.shards,
		activeShardId: params.shards.find((shard) => shard.state === "active")?.shardId ?? null,
		overlayIncluded: true,
		artifactRefs: params.shards.map((shard) => ({
			shardId: shard.shardId,
			generation: shard.generation,
			artifactOwner: shard.artifactOwner,
		})),
		overlayJournalRefs: [],
		invalidationCount: 0,
		status: params.status,
	};
}

describe("coverage lexical v3 multi-shard snapshot", () => {
	test("writes committed manifest for sealed plus active shards and includes overlay refs", async () => {
		const sealed = descriptor("sealed-1", "sealed", 1);
		const active = descriptor("active-2", "active", 2);
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [sealed, active] });
		const overlayStore = new MemoryActiveOverlayJournalStore([
			{
				id: buildActiveOverlayJournalEntryId({
					activeShardId: "active-2",
					activeShardGeneration: 1,
					sequence: 1,
				}),
				sequence: 1,
				activeShardId: "active-2",
				activeShardGeneration: 1,
				operation: "append",
				document: doc("overlay.md", "overlay target", 3),
				previousVersion: null,
				sourceBytes: 14,
				createdAt: 1,
			},
		]);
		const snapshotStore = new MemoryCoverageLexicalV3SnapshotStore();

		const result = await writeCoverageLexicalV3Snapshot({
			snapshotStore,
			stores,
			overlayJournalStore: overlayStore,
			snapshotId: "snapshot-1",
			now: 10,
		});

		expect(result.committed).toBe(true);
		expect(result.manifest.status).toBe("committed");
		expect(result.manifest.shardDescriptors.map((shard) => shard.shardId)).toEqual([
			"sealed-1",
			"active-2",
		]);
		expect(result.manifest.artifactRefs).toHaveLength(2);
	expect(result.manifest.overlayJournalRefs.map((ref) => ref.entryId)).toEqual(["active-2@1:1"]);
		expect((await snapshotStore.loadLatestCommittedManifest())?.snapshotId).toBe("snapshot-1");
	});

	test("building manifest is ignored during restore", async () => {
		const sealed = descriptor("sealed-1", "sealed", 1);
		const result = await restoreCoverageLexicalV3Snapshot({
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore([
				manifest({ snapshotId: "building", status: "building", createdAt: 1, shards: [sealed] }),
			]),
			engine: new CoverageLexicalV3Engine(),
			stores: createMemoryCoverageLexicalV3ProductionStores({ registry: [sealed] }),
			residentShardArtifactLoader: { async loadResidentShard() { return residentShard("sealed-1", []); } },
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
		});

		expect(result).toEqual({ restored: false, reason: "missing_snapshot", loadedShardIds: [] });
	});

	test("restores clean snapshot and uses manifest registry as search-visible truth", async () => {
		const sealed = descriptor("sealed-1", "sealed", 1);
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [sealed, descriptor("garbage-2", "garbage", 2)],
		});
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		await artifactStore.publishResidentShardArtifact({
			descriptor: sealed,
			shard: residentShard("sealed-1", [doc("sealed.md", "snapshot target", 1)]),
			createdAt: 1,
		});
		const engine = new CoverageLexicalV3Engine();

		const result = await restoreCoverageLexicalV3Snapshot({
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore([
				manifest({ snapshotId: "snapshot-1", status: "committed", createdAt: 1, shards: [sealed] }),
			]),
			engine,
			stores,
			residentShardArtifactLoader: artifactStore,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
		});

		expect(result.restored).toBe(true);
		expect(result.loadedShardIds).toEqual(["sealed-1"]);
		expect(engine.getResidentIndexView()?.shards.map((shard) => shard.shardId)).toEqual(["sealed-1"]);
	});

	test("restore includes overlay journal in the same global candidate pool", async () => {
		const active = descriptor("active-1", "active", 1);
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifactStore = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		await artifactStore.publishResidentShardArtifact({
			descriptor: active,
			shard: residentShard("active-1", []),
			createdAt: 1,
		});
		const overlayEntry = {
			id: "active-1@1:overlay:1",
			sequence: 1,
			activeShardId: "active-1",
			activeShardGeneration: 1,
			operation: "append" as const,
			document: doc("overlay.md", "restored overlay target", 2),
			previousVersion: null,
			sourceBytes: 24,
			createdAt: 1,
		};
		const engine = new CoverageLexicalV3Engine();
		const snapshotManifest = {
			...manifest({ snapshotId: "snapshot-1", status: "committed", createdAt: 1, shards: [active] }),
			overlayJournalRefs: [
				{
					entryId: overlayEntry.id,
					activeShardId: "active-1",
					activeShardGeneration: 1,
					sequence: 1,
				},
			],
		};

		const result = await restoreCoverageLexicalV3Snapshot({
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore([snapshotManifest]),
			engine,
			stores,
			residentShardArtifactLoader: artifactStore,
			overlayJournalStore: new MemoryActiveOverlayJournalStore([overlayEntry]),
		});

		expect(result.restored).toBe(true);
		const search = engine.search("restored overlay target");
		expect(search.rankedCandidates[0]?.path).toBe("overlay.md");
		expect(search.recallState.candidateDocs[0]?.shardId).toBe("active-1:overlay");
	});

	test("missing referenced artifact or overlay entry forces rebuild fallback", async () => {
		const active = descriptor("active-1", "active", 1);
		const baseManifest = manifest({ snapshotId: "snapshot-1", status: "committed", createdAt: 1, shards: [active] });
		const missingArtifact = await restoreCoverageLexicalV3Snapshot({
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore([baseManifest]),
			engine: new CoverageLexicalV3Engine(),
			stores: createMemoryCoverageLexicalV3ProductionStores({ registry: [active] }),
			residentShardArtifactLoader: { async loadResidentShard() { return undefined; } },
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
		});
		expect(missingArtifact.reason).toBe("missing_resident_shard");

		const missingOverlay = await restoreCoverageLexicalV3Snapshot({
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore([
				{
					...baseManifest,
					overlayJournalRefs: [
						{
							entryId: "missing",
							activeShardId: "active-1",
							activeShardGeneration: 1,
							sequence: 1,
						},
					],
				},
			]),
			engine: new CoverageLexicalV3Engine(),
			stores: createMemoryCoverageLexicalV3ProductionStores({ registry: [active] }),
			residentShardArtifactLoader: { async loadResidentShard() { return residentShard("active-1", []); } },
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
		});
		expect(missingOverlay.reason).toBe("missing_overlay_entry");
	});

	test("bootstrap prefers snapshot restore before registry fallback", async () => {
		const sealed = descriptor("sealed-1", "sealed", 1);
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [] });
		const result = await bootstrapCoverageLexicalV3Engine({
			engine: new CoverageLexicalV3Engine(),
			stores,
			residentShardArtifactLoader: { async loadResidentShard() { return residentShard("sealed-1", []); } },
			snapshotStore: new MemoryCoverageLexicalV3SnapshotStore([
				manifest({ snapshotId: "snapshot-1", status: "committed", createdAt: 1, shards: [sealed] }),
			]),
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
		});

		expect(result.reason).toBe("loaded_snapshot");
		expect(result.snapshotId).toBe("snapshot-1");
	});

	test("snapshot heal ignores temp/building snapshots and removes garbage after commit", async () => {
		const sealed = descriptor("sealed-1", "sealed", 1);
		const snapshotStore = new MemoryCoverageLexicalV3SnapshotStore([
			manifest({ snapshotId: "building", status: "building", createdAt: 3, shards: [sealed] }),
			manifest({ snapshotId: "old", status: "committed", createdAt: 1, shards: [sealed] }),
			manifest({ snapshotId: "new", status: "committed", createdAt: 2, shards: [sealed] }),
			manifest({ snapshotId: "garbage", status: "garbage", createdAt: 0, shards: [sealed] }),
		]);

		const result = await healCoverageLexicalV3SnapshotState({ snapshotStore });

		expect(result).toEqual({ removedGarbageSnapshots: 2, markedOldCommittedGarbage: 1 });
		expect((await snapshotStore.loadManifests()).map((item) => item.snapshotId)).toEqual([
			"new",
			"building",
		]);
	});
});
