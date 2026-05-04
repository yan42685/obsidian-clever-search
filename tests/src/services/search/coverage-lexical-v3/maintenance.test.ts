import type { IndexedDocument } from "src/globals/search-types";
import { buildIndexedSnapshotRequestKey } from "src/services/search/shared/file-snapshot-store";
import {
	createDexieCoverageLexicalV3ResidentShardArtifactStore,
	type CoverageLexicalV3ResidentShardArtifactRow,
} from "src/services/search/coverage-lexical-v3/artifact-loader";
import { buildResidentHotBaseArtifacts } from "src/services/search/coverage-lexical-v3/build";
import {
	type CompactJobManifest,
	MemoryCompactJobManifestStore,
	MemoryCompactTempArtifactStore,
} from "src/services/search/coverage-lexical-v3/compact";
import type { ResidentShard } from "src/services/search/coverage-lexical-v3/layout/types";
import { runCoverageLexicalV3Maintenance } from "src/services/search/coverage-lexical-v3/maintenance";
import { getDocPath } from "src/services/search/coverage-lexical-v3/recall";
import type { ResidentShardDescriptor } from "src/services/search/coverage-lexical-v3/shards";
import { createMemoryCoverageLexicalV3ProductionStores } from "src/services/search/coverage-lexical-v3/stores";
import { MemoryActiveOverlayJournalStore } from "src/services/search/coverage-lexical-v3/active-overlay-journal";

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

function doc(path: string, content: string, docRef: number): IndexedDocument {
	return {
		path,
		basename: path.replace(/\.md$/, ""),
		folder: "notes",
		content,
		headings: content,
		docRef,
		generation: 1,
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

function descriptor(shardId: string, createdOrder: number): ResidentShardDescriptor {
	return {
		shardId,
		generation: 1,
		state: "sealed",
		sourceBytes: 1024,
		docCount: 1,
		createdOrder,
		artifactOwner: shardId,
	};
}

function indexedSnapshotReader(documents: readonly IndexedDocument[]) {
	const byPath = new Map(documents.map((document) => [document.path, document]));
	return {
		async readIndexedTextSnapshots(requests: ReadonlyArray<{ path: string; generation?: number }>) {
			return new Map(
				requests.flatMap((request) => {
					const document = byPath.get(request.path);
					return document == null
						? []
						: [[buildIndexedSnapshotRequestKey(request), { path: request.path, text: document.content ?? "", generation: document.generation, source: "indexed" as const }] as const];
				}),
			);
		},
		async readIndexedMetadata() {
			return new Map();
		},
	};
}

describe("coverage lexical v3 maintenance coordinator", () => {
	test("starts one compact job through the existing compact executor", async () => {
		const first = descriptor("sealed-1", 1);
		const second = descriptor("sealed-2", 2);
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [first, second],
		});
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const docs = [doc("one.md", "one target", 1), doc("two.md", "two target", 2)];
		await artifacts.publishResidentShardArtifact({
			descriptor: first,
			shard: residentShard("sealed-1", [docs[0]]),
			createdAt: 1,
		});
		await artifacts.publishResidentShardArtifact({
			descriptor: second,
			shard: residentShard("sealed-2", [docs[1]]),
			createdAt: 1,
		});

		const result = await runCoverageLexicalV3Maintenance({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			compactJobStore: new MemoryCompactJobManifestStore(),
			compactTempArtifactStore: new MemoryCompactTempArtifactStore(),
			indexedSnapshotReader: indexedSnapshotReader(docs),
			now: 10,
		});

		expect(result.compactJobsStarted).toBe(1);
		expect(result.stateChanged).toBe(true);
		const registry = await stores.shardRegistry.loadRegistry();
		expect(registry.map((shard) => shard.shardId)).toContain("sealed-compact-10");
		expect(registry.find((shard) => shard.shardId === "sealed-1")?.state).toBe("garbage");
	});

	test("allocates unique compact job and output ids across same-ms maintenance runs", async () => {
		const first = descriptor("sealed-1", 1);
		const second = descriptor("sealed-2", 2);
		const third = descriptor("sealed-3", 3);
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [first, second, third],
		});
		const artifactTable = new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
			(row) => row.id,
		);
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			artifactTable,
		);
		const jobs = new MemoryCompactJobManifestStore();
		const tempArtifacts = new MemoryCompactTempArtifactStore();
		const docs = [
			doc("one.md", "one target", 1),
			doc("two.md", "two target", 2),
			doc("three.md", "three target", 3),
		];
		for (const [index, shardDescriptor] of [first, second, third].entries()) {
			await artifacts.publishResidentShardArtifact({
				descriptor: shardDescriptor,
				shard: residentShard(shardDescriptor.shardId, [docs[index]!]),
				createdAt: 1,
			});
		}

		await runCoverageLexicalV3Maintenance({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			compactJobStore: jobs,
			compactTempArtifactStore: tempArtifacts,
			indexedSnapshotReader: indexedSnapshotReader(docs),
			now: 40,
		});
		await runCoverageLexicalV3Maintenance({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			compactJobStore: jobs,
			compactTempArtifactStore: tempArtifacts,
			indexedSnapshotReader: indexedSnapshotReader(docs),
			now: 40,
		});

		const registry = await stores.shardRegistry.loadRegistry();
		expect(registry.map((shard) => shard.shardId)).toEqual(
			expect.arrayContaining(["sealed-compact-40", "sealed-compact-40-1"]),
		);
		expect(registry.find((shard) => shard.shardId === "sealed-compact-40")?.state).toBe(
			"garbage",
		);
		expect(registry.find((shard) => shard.shardId === "sealed-compact-40-1")?.state).toBe(
			"sealed",
		);
		expect(await artifacts.loadResidentShard({
			shardId: "sealed-compact-40",
			generation: 1,
			state: "garbage",
			sourceBytes: 2048,
			docCount: 2,
			createdOrder: 1,
			artifactOwner: "sealed-compact-40",
		})).toBeDefined();
		expect(await artifacts.loadResidentShard({
			shardId: "sealed-compact-40-1",
			generation: 1,
			state: "sealed",
			sourceBytes: 3072,
			docCount: 3,
			createdOrder: 1,
			artifactOwner: "sealed-compact-40-1",
		})).toBeDefined();
	});

	test("allocates compact output ids without overwriting existing orphan artifacts", async () => {
		const first = descriptor("sealed-1", 1);
		const second = descriptor("sealed-2", 2);
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [first, second],
		});
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const docs = [
			doc("one.md", "one target", 1),
			doc("two.md", "two target", 2),
		];
		for (const [index, shardDescriptor] of [first, second].entries()) {
			await artifacts.publishResidentShardArtifact({
				descriptor: shardDescriptor,
				shard: residentShard(shardDescriptor.shardId, [docs[index]!]),
				createdAt: 1,
			});
		}
		await artifacts.publishResidentShardArtifact({
			descriptor: {
				shardId: "sealed-compact-50",
				generation: 1,
				state: "sealed",
				sourceBytes: 1,
				docCount: 1,
				createdOrder: 1,
				artifactOwner: "sealed-compact-50",
			},
			shard: residentShard("sealed-compact-50", [doc("orphan.md", "orphan target", 99)]),
			createdAt: 1,
		});

		await runCoverageLexicalV3Maintenance({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			compactJobStore: new MemoryCompactJobManifestStore(),
			compactTempArtifactStore: new MemoryCompactTempArtifactStore(),
			indexedSnapshotReader: indexedSnapshotReader(docs),
			now: 50,
		});

		const registry = await stores.shardRegistry.loadRegistry();
		expect(registry.map((shard) => shard.shardId)).toContain("sealed-compact-50-1");
		expect(registry.map((shard) => shard.shardId)).not.toContain("sealed-compact-50");
		expect(await artifacts.loadResidentShard({
			shardId: "sealed-compact-50",
			generation: 1,
			state: "sealed",
			sourceBytes: 1,
			docCount: 1,
			createdOrder: 1,
			artifactOwner: "sealed-compact-50",
		})).toBeDefined();
	});

	test("compact drops invalidated sealed documents", async () => {
		const first = descriptor("sealed-1", 1);
		const second = descriptor("sealed-2", 2);
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [first, second],
			invalidations: [
				{
					shardId: "sealed-1",
					shardGeneration: 1,
					docRef: 1,
					docGeneration: 1,
					reason: "superseded",
					createdAt: 9,
				},
			],
		});
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const docs = [doc("one.md", "one target", 1), doc("two.md", "two target", 2)];
		await artifacts.publishResidentShardArtifact({
			descriptor: first,
			shard: residentShard("sealed-1", [docs[0]]),
			createdAt: 1,
		});
		await artifacts.publishResidentShardArtifact({
			descriptor: second,
			shard: residentShard("sealed-2", [docs[1]]),
			createdAt: 1,
		});

		await runCoverageLexicalV3Maintenance({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			compactJobStore: new MemoryCompactJobManifestStore(),
			compactTempArtifactStore: new MemoryCompactTempArtifactStore(),
			indexedSnapshotReader: indexedSnapshotReader(docs),
			now: 20,
		});

		const compactShard = await artifacts.loadResidentShard({
			shardId: "sealed-compact-20",
			generation: 1,
			state: "sealed",
			sourceBytes: 1024,
			docCount: 1,
			createdOrder: 1,
			artifactOwner: "sealed-compact-20",
		});
		expect(compactShard?.base.docTable.docCount).toBe(1);
		expect(getDocPath(compactShard!.base, 0)).toBe("two.md");
	});

	test("compact waits instead of publishing a partial shard when a live snapshot is missing", async () => {
		const first = descriptor("sealed-1", 1);
		const second = descriptor("sealed-2", 2);
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [first, second],
		});
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const docs = [doc("one.md", "one target", 1), doc("two.md", "two target", 2)];
		await artifacts.publishResidentShardArtifact({
			descriptor: first,
			shard: residentShard("sealed-1", [docs[0]]),
			createdAt: 1,
		});
		await artifacts.publishResidentShardArtifact({
			descriptor: second,
			shard: residentShard("sealed-2", [docs[1]]),
			createdAt: 1,
		});

		const result = await runCoverageLexicalV3Maintenance({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			compactJobStore: new MemoryCompactJobManifestStore(),
			compactTempArtifactStore: new MemoryCompactTempArtifactStore(),
			indexedSnapshotReader: indexedSnapshotReader([docs[0]]),
			now: 25,
		});

		expect(result.compactJobsStarted).toBe(0);
		expect(result.stateChanged).toBe(false);
		expect(await stores.shardRegistry.loadRegistry()).toEqual([first, second]);
		expect(await artifacts.loadResidentShard({
			shardId: "sealed-compact-25",
			generation: 1,
			state: "sealed",
			sourceBytes: 1024,
			docCount: 2,
			createdOrder: 1,
			artifactOwner: "sealed-compact-25",
		})).toBeUndefined();
	});

	test("compact waits instead of publishing a partial shard when an input artifact is missing", async () => {
		const first = descriptor("sealed-1", 1);
		const second = descriptor("sealed-2", 2);
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [first, second],
		});
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const docs = [doc("one.md", "one target", 1), doc("two.md", "two target", 2)];
		await artifacts.publishResidentShardArtifact({
			descriptor: first,
			shard: residentShard("sealed-1", [docs[0]]),
			createdAt: 1,
		});

		const result = await runCoverageLexicalV3Maintenance({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			compactJobStore: new MemoryCompactJobManifestStore(),
			compactTempArtifactStore: new MemoryCompactTempArtifactStore(),
			indexedSnapshotReader: indexedSnapshotReader(docs),
			now: 26,
		});

		expect(result.compactJobsStarted).toBe(0);
		expect(result.stateChanged).toBe(false);
		expect(await stores.shardRegistry.loadRegistry()).toEqual([first, second]);
		expect(await artifacts.loadResidentShard({
			shardId: "sealed-compact-26",
			generation: 1,
			state: "sealed",
			sourceBytes: 1024,
			docCount: 2,
			createdOrder: 1,
			artifactOwner: "sealed-compact-26",
		})).toBeUndefined();
	});

	test("compact marks fully stale sealed inputs garbage instead of retrying forever", async () => {
		const first = descriptor("sealed-1", 1);
		const second = descriptor("sealed-2", 2);
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [first, second],
			invalidations: [
				{
					shardId: "sealed-1",
					shardGeneration: 1,
					docRef: 1,
					docGeneration: 1,
					reason: "deleted",
					createdAt: 9,
				},
				{
					shardId: "sealed-2",
					shardGeneration: 1,
					docRef: 2,
					docGeneration: 1,
					reason: "deleted",
					createdAt: 9,
				},
			],
		});
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const docs = [doc("one.md", "one target", 1), doc("two.md", "two target", 2)];
		await artifacts.publishResidentShardArtifact({
			descriptor: first,
			shard: residentShard("sealed-1", [docs[0]]),
			createdAt: 1,
		});
		await artifacts.publishResidentShardArtifact({
			descriptor: second,
			shard: residentShard("sealed-2", [docs[1]]),
			createdAt: 1,
		});

		const result = await runCoverageLexicalV3Maintenance({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			compactJobStore: new MemoryCompactJobManifestStore(),
			compactTempArtifactStore: new MemoryCompactTempArtifactStore(),
			indexedSnapshotReader: indexedSnapshotReader(docs),
			now: 30,
		});

		expect(result.stateChanged).toBe(true);
		const registry = await stores.shardRegistry.loadRegistry();
		expect(registry.find((shard) => shard.shardId === "sealed-1")?.state).toBe("garbage");
		expect(registry.find((shard) => shard.shardId === "sealed-2")?.state).toBe("garbage");
		expect(registry.map((shard) => shard.shardId)).not.toContain("sealed-compact-30");
	});

	test("ready compact recovery commits persisted temp descriptor", async () => {
		const first = descriptor("sealed-1", 1);
		const second = descriptor("sealed-2", 2);
		const outputDescriptor: ResidentShardDescriptor = {
			shardId: "sealed-3",
			generation: 1,
			state: "sealed",
			sourceBytes: 4096,
			docCount: 1,
			createdOrder: 77,
			artifactOwner: "sealed-3-owner",
		};
		const stores = createMemoryCoverageLexicalV3ProductionStores({
			registry: [first, second],
		});
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>(
				(row) => row.id,
			),
		);
		const job: CompactJobManifest = {
			jobId: "job-ready",
			kind: "adjacent_small_shard_merge",
			inputShardIds: ["sealed-1", "sealed-2"],
			outputShardId: "sealed-3",
			status: "ready_to_commit",
			createdAt: 1,
			updatedAt: 1,
		};
		const tempStore = new MemoryCompactTempArtifactStore();
		await tempStore.saveTempArtifact({
			jobId: job.jobId,
			outputShardId: "sealed-3",
			outputDescriptor,
			shard: residentShard("sealed-3", [doc("merged.md", "merged target", 3)]),
			createdAt: 1,
		});

		await runCoverageLexicalV3Maintenance({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: new MemoryActiveOverlayJournalStore(),
			compactJobStore: new MemoryCompactJobManifestStore([job]),
			compactTempArtifactStore: tempStore,
			indexedSnapshotReader: indexedSnapshotReader([]),
			now: 20,
		});

		expect(
			(await stores.shardRegistry.loadRegistry()).find((shard) => shard.shardId === "sealed-3"),
		).toEqual(outputDescriptor);
		expect(await artifacts.loadResidentShard(outputDescriptor)).toBeDefined();
	});
});
