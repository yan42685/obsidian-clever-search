import type { IndexedDocument } from "src/globals/search-types";
import {
	createDexieCoverageLexicalV3ResidentShardArtifactStore,
	type CoverageLexicalV3ResidentShardArtifactRow,
} from "src/services/search/coverage-lexical-v3/artifact-loader";
import { buildResidentHotBaseArtifacts } from "src/services/search/coverage-lexical-v3/build";
import {
	MemoryCompactJobManifestStore,
	MemoryCompactTempArtifactStore,
} from "src/services/search/coverage-lexical-v3/compact";
import type { ResidentShard } from "src/services/search/coverage-lexical-v3/layout/types";
import { runCoverageLexicalV3Maintenance } from "src/services/search/coverage-lexical-v3/maintenance";
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
						: [[request.path, { path: request.path, text: document.content ?? "", generation: document.generation, source: "indexed" as const }] as const];
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
});
