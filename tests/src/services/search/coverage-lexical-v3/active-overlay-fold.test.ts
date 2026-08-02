import type { IndexedDocument } from "src/globals/search-types";
import { buildIndexedSnapshotRequestKey } from "src/services/search/shared/file-snapshot-store";
import { MemoryActiveOverlayJournalStore } from "src/services/search/coverage-lexical-v3/active-overlay-journal";
import { runActiveOverlayFoldMaintenanceJob } from "src/services/search/coverage-lexical-v3/active-overlay-fold";
import { writeActiveOverlayChanges } from "src/services/search/coverage-lexical-v3/active-overlay-writer";
import {
	createDexieCoverageLexicalV3ResidentShardArtifactStore,
	type CoverageLexicalV3ResidentShardArtifactRow,
} from "src/services/search/coverage-lexical-v3/artifact-loader";
import { getDocPath } from "src/services/search/coverage-lexical-v3/recall";
import type { ResidentShardDescriptor } from "src/services/search/coverage-lexical-v3/shards";
import { createMemoryCoverageLexicalV3ProductionStores } from "src/services/search/coverage-lexical-v3/stores";
import { publishActiveShardAppend } from "src/services/search/coverage-lexical-v3/active-shard-publisher";

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

function activeDescriptor(sourceBytes = 0, docCount = 0): ResidentShardDescriptor {
	return {
		shardId: "active-1",
		generation: 1,
		state: "active",
		sourceBytes,
		docCount,
		createdOrder: 1,
		artifactOwner: "active-1",
	};
}

function indexedSnapshotReader(documents: readonly IndexedDocument[]) {
	const documentByPath = new Map(documents.map((document) => [document.path, document]));
	return {
		async readIndexedTextSnapshots(requests: ReadonlyArray<{ path: string; generation?: number }>) {
			return new Map(
				requests.flatMap((request) => {
					const document = documentByPath.get(request.path);
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

describe("coverage lexical v3 active overlay fold", () => {
	test("removes only the folded journal entries when a concurrent append arrives", async () => {
		const active = activeDescriptor();
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const concurrentDocument = doc("concurrent.md", "concurrent gamma", 3);
		class ConcurrentAppendOverlayStore extends MemoryActiveOverlayJournalStore {
			private appended = false;

			async removeEntries(ids: readonly string[]): Promise<void> {
				if (!this.appended) {
					this.appended = true;
					await this.appendOverlayEntries([
						{
							id: "active-1@1:2",
							sequence: 2,
							activeShardId: "active-1",
							activeShardGeneration: 1,
							operation: "append",
							document: concurrentDocument,
							sourceBytes: concurrentDocument.content?.length ?? 0,
							createdAt: 3,
						},
					]);
				}
				await super.removeEntries(ids);
			}
		}
		const overlayStore = new ConcurrentAppendOverlayStore();
		const baseDoc = doc("base.md", "base alpha", 1);
		await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [],
			changes: [{ document: baseDoc }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 1 },
		});
		const activeAfterBase = (await stores.shardRegistry.loadRegistry())[0] ?? active;
		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			changes: [{ document: doc("overlay.md", "overlay beta", 2) }],
			sequenceStart: 1,
			now: 2,
		});

		await runActiveOverlayFoldMaintenanceJob({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			indexedSnapshotReader: indexedSnapshotReader([baseDoc]),
			sealSourceBytes: 1024 * 1024,
			now: 3,
		});

		await expect(
			overlayStore.loadActiveOverlayEntries({
				activeShardId: "active-1",
				activeShardGeneration: 1,
			}),
		).resolves.toEqual([
			expect.objectContaining({
				id: "active-1@1:2",
				document: expect.objectContaining({ path: "concurrent.md" }),
			}),
		]);
	});

	test("folds overlay into a new active artifact and clears journal", async () => {
		const active = activeDescriptor();
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const overlayStore = new MemoryActiveOverlayJournalStore();
		const baseDoc = doc("base.md", "base alpha", 1);
		await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [],
			changes: [{ document: baseDoc }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 1 },
		});
		const activeAfterBase = (await stores.shardRegistry.loadRegistry())[0] ?? active;
		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			changes: [{ document: doc("overlay.md", "overlay beta", 2) }],
			sequenceStart: 1,
			now: 2,
		});

		const result = await runActiveOverlayFoldMaintenanceJob({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			indexedSnapshotReader: indexedSnapshotReader([baseDoc]),
			sealSourceBytes: 1024 * 1024,
			now: 3,
		});

		expect(result?.clearedOverlayEntries).toBe(1);
		expect(result?.appendTargetShard.state).toBe("active");
		expect((await artifacts.loadResidentShard(result!.appendTargetShard))?.base.docTable.docCount).toBe(2);
		expect(
			await overlayStore.loadActiveOverlayEntries({ activeShardId: "active-1", activeShardGeneration: 1 }),
		).toHaveLength(0);
	});

	test("fold applies overlay delete tombstones to current active documents", async () => {
		const active = activeDescriptor();
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const overlayStore = new MemoryActiveOverlayJournalStore();
		const baseDoc = doc("deleted.md", "delete me", 1);
		await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [],
			changes: [{ document: baseDoc }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 1 },
		});
		const activeAfterBase = (await stores.shardRegistry.loadRegistry())[0] ?? active;
		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			changes: [
				{
					document: baseDoc,
					deleted: true,
					previousVersion: {
						shardId: activeAfterBase.shardId,
						shardGeneration: activeAfterBase.generation,
						docRef: 1,
						docGeneration: 1,
					},
				},
			],
			sequenceStart: 1,
			now: 2,
		});

		const result = await runActiveOverlayFoldMaintenanceJob({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			indexedSnapshotReader: indexedSnapshotReader([baseDoc]),
			sealSourceBytes: 1024 * 1024,
			now: 3,
		});

		const foldedShard = await artifacts.loadResidentShard(result!.appendTargetShard);
		expect(foldedShard?.base.docTable.docCount).toBe(0);
	});

	test("fold replaces a superseded current active document instead of carrying both generations", async () => {
		const active = activeDescriptor();
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const overlayStore = new MemoryActiveOverlayJournalStore();
		const baseDoc = doc("updated.md", "old alpha", 1, 1);
		const updatedDoc = doc("updated.md", "new beta", 1, 2);
		await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [],
			changes: [{ document: baseDoc }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 1 },
		});
		const activeAfterBase = (await stores.shardRegistry.loadRegistry())[0] ?? active;
		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			changes: [
				{
					document: updatedDoc,
					previousVersion: {
						shardId: activeAfterBase.shardId,
						shardGeneration: activeAfterBase.generation,
						docRef: 1,
						docGeneration: 1,
					},
				},
			],
			sequenceStart: 1,
			now: 2,
		});

		const result = await runActiveOverlayFoldMaintenanceJob({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			indexedSnapshotReader: indexedSnapshotReader([baseDoc]),
			sealSourceBytes: 1024 * 1024,
			now: 3,
		});

		const foldedShard = await artifacts.loadResidentShard(result!.appendTargetShard);
		expect(foldedShard?.base.docTable.docCount).toBe(1);
		expect(getDocPath(foldedShard!.base, 0)).toBe("updated.md");
		expect(foldedShard?.base.docTable.generationByDocId[0]).toBe(2);
	});

	test("oversized fold preserves replacement active shard generation", async () => {
		const active = activeDescriptor();
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const overlayStore = new MemoryActiveOverlayJournalStore();
		const baseDoc = doc("base.md", "base alpha oversized body", 1);
		await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [],
			changes: [{ document: baseDoc }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 1 },
		});
		const activeAfterBase = (await stores.shardRegistry.loadRegistry())[0] ?? active;
		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			changes: [{ document: doc("overlay.md", "overlay beta oversized body", 2) }],
			sequenceStart: 1,
			now: 2,
		});

		const result = await runActiveOverlayFoldMaintenanceJob({
			stores,
			residentShardArtifactStore: artifacts,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			indexedSnapshotReader: indexedSnapshotReader([baseDoc]),
			sealSourceBytes: 24,
			now: 3,
		});

		expect(result?.publishedShards[0]).toEqual(
			expect.objectContaining({
				shardId: "active-1",
				generation: 2,
				artifactOwner: "active-1@fold-2",
				state: "sealed",
			}),
		);
		expect(result?.appendTargetShard.state).toBe("active");
		const registry = await stores.shardRegistry.loadRegistry();
		expect(registry).not.toContainEqual(
			expect.objectContaining({
				shardId: "active-1",
				generation: 1,
				state: "active",
				artifactOwner: "active-1",
			}),
		);
		expect(
			await overlayStore.loadActiveOverlayEntries({ activeShardId: "active-1", activeShardGeneration: 1 }),
		).toHaveLength(0);
	});

	test("aborts fold when a current active document snapshot is missing", async () => {
		const active = activeDescriptor();
		const stores = createMemoryCoverageLexicalV3ProductionStores({ registry: [active] });
		const artifacts = createDexieCoverageLexicalV3ResidentShardArtifactStore(
			new FakeArtifactTable<CoverageLexicalV3ResidentShardArtifactRow, string>((row) => row.id),
		);
		const overlayStore = new MemoryActiveOverlayJournalStore();
		const baseDoc = doc("base.md", "base alpha", 1);
		await publishActiveShardAppend({
			stores,
			residentShardArtifactStore: artifacts,
			activeShard: active,
			currentActiveDocuments: [],
			changes: [{ document: baseDoc }],
			plannerOptions: { sealSourceBytes: 1024 * 1024, now: 1 },
		});
		const activeAfterBase = (await stores.shardRegistry.loadRegistry())[0] ?? active;
		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeAfterBase,
			changes: [{ document: doc("overlay.md", "overlay beta", 2) }],
			sequenceStart: 1,
			now: 2,
		});

		await expect(
			runActiveOverlayFoldMaintenanceJob({
				stores,
				residentShardArtifactStore: artifacts,
				overlayJournalStore: overlayStore,
				activeShard: activeAfterBase,
				indexedSnapshotReader: indexedSnapshotReader([]),
				sealSourceBytes: 1024 * 1024,
				now: 3,
			}),
		).rejects.toThrow("Missing indexed text snapshots");
		expect(await stores.shardRegistry.loadRegistry()).toEqual([activeAfterBase]);
		expect(
			await overlayStore.loadActiveOverlayEntries({
				activeShardId: "active-1",
				activeShardGeneration: 1,
			}),
		).toHaveLength(1);
	});
});
