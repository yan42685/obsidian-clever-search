import type { IndexedDocument } from "src/globals/search-types";
import {
	buildOverlayResidentShard,
	materializeOverlayDocuments,
	MemoryActiveOverlayJournalStore,
} from "src/services/search/coverage-lexical-v3/active-overlay-journal";
import { writeActiveOverlayChanges } from "src/services/search/coverage-lexical-v3/active-overlay-writer";
import { buildResidentHotBaseArtifacts } from "src/services/search/coverage-lexical-v3/build";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import { EMPTY_RESIDENT_FUZZY_RESCUE_INDEX } from "src/services/search/coverage-lexical-v3/layout/fuzzy-rescue";
import type { ResidentIndexView } from "src/services/search/coverage-lexical-v3/layout/types";
import type { ResidentShardDescriptor } from "src/services/search/coverage-lexical-v3/shards";
import { createMemoryCoverageLexicalV3ProductionStores } from "src/services/search/coverage-lexical-v3/stores";

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

function buildShard(
	shardId: string,
	generation: number,
	documents: readonly IndexedDocument[],
): ResidentIndexView["shards"][number] {
	const artifacts = buildResidentHotBaseArtifacts(documents);
	return {
		shardId,
		generation,
		base: {
			...artifacts.base,
			fuzzyRescue: artifacts.fuzzyRescueIndex,
		},
	};
}

function activeDescriptor(): ResidentShardDescriptor {
	return {
		shardId: "active-1",
		generation: 1,
		state: "active",
		sourceBytes: 0,
		docCount: 0,
		createdOrder: 1,
		artifactOwner: "active-1",
	};
}

describe("coverage lexical v3 active overlay integration", () => {
	test("overlay appended documents participate in the global candidate pool", async () => {
		const engine = new CoverageLexicalV3Engine();
		engine.loadResidentIndexView({
			version: 1,
			shards: [buildShard("active-1", 1, [])],
		});
		const stores = createMemoryCoverageLexicalV3ProductionStores();
		const overlayStore = new MemoryActiveOverlayJournalStore();

		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeDescriptor(),
			changes: [{ document: doc("overlay.md", "global overlay target", 3) }],
			sequenceStart: 1,
			now: 10,
		});
		const overlayShard = buildOverlayResidentShard({
			activeShardId: "active-1",
			activeShardGeneration: 1,
			entries: await overlayStore.loadActiveOverlayEntries({
				activeShardId: "active-1",
				activeShardGeneration: 1,
			}),
		});

		engine.loadOverlayResidentShard(overlayShard);
		const result = engine.search("global overlay target");

		expect(result.rankedCandidates[0]?.path).toBe("overlay.md");
		expect(result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text)).toEqual([
			"global",
			"overlay",
			"target",
		]);
		expect(result.recallState.candidateDocs[0]?.shardId).toBe("active-1:overlay");
	});

	test("overlay supersedes sealed documents through invalidation without rewriting sealed shard", async () => {
		const engine = new CoverageLexicalV3Engine();
		engine.loadResidentIndexView({
			version: 1,
			shards: [buildShard("sealed-1", 1, [doc("old.md", "project old target", 7, 1)])],
		});
		const stores = createMemoryCoverageLexicalV3ProductionStores();
		const overlayStore = new MemoryActiveOverlayJournalStore();

		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeDescriptor(),
			changes: [
				{
					document: doc("new.md", "project new target", 7, 2),
					previousVersion: {
						shardId: "sealed-1",
						shardGeneration: 1,
						docRef: 7,
						docGeneration: 1,
					},
				},
			],
			sequenceStart: 1,
			now: 11,
		});
		engine.loadShardInvalidations(await stores.invalidations.loadInvalidations());
		engine.loadOverlayResidentShard(
			buildOverlayResidentShard({
				activeShardId: "active-1",
				activeShardGeneration: 1,
				entries: await overlayStore.loadActiveOverlayEntries({
					activeShardId: "active-1",
					activeShardGeneration: 1,
				}),
			}),
		);

		const paths = engine.search("project new target").rankedCandidates.map((candidate) => candidate.path);
		expect(paths).toContain("new.md");
		expect(paths).not.toContain("old.md");
	});

	test("same-generation overlay replacement does not invalidate its replacement", async () => {
		const engine = new CoverageLexicalV3Engine();
		engine.loadResidentIndexView({
			version: 1,
			shards: [buildShard("active-1", 1, [])],
		});
		const stores = createMemoryCoverageLexicalV3ProductionStores();
		const overlayStore = new MemoryActiveOverlayJournalStore();
		const first = doc("rapid.md", "project stale target", 9, 1);
		const replacement = doc("rapid.md", "project fresh target", 9, 1);

		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeDescriptor(),
			changes: [{ document: first }],
			sequenceStart: 1,
			now: 20,
		});
		await writeActiveOverlayChanges({
			stores,
			overlayJournalStore: overlayStore,
			activeShard: activeDescriptor(),
			changes: [
				{
					document: replacement,
					previousVersion: {
						shardId: "active-1:overlay",
						shardGeneration: 1,
						docRef: 9,
						docGeneration: 1,
					},
				},
			],
			sequenceStart: 2,
			now: 21,
		});

		const invalidations = await stores.invalidations.loadInvalidations();
		expect(invalidations).toEqual([]);
		const entries = await overlayStore.loadActiveOverlayEntries({
			activeShardId: "active-1",
			activeShardGeneration: 1,
		});
		expect(materializeOverlayDocuments(entries)).toEqual([replacement]);
		engine.loadShardInvalidations(invalidations);
		engine.loadOverlayResidentShard(
			buildOverlayResidentShard({
				activeShardId: "active-1",
				activeShardGeneration: 1,
				entries,
			}),
		);

		expect(engine.search("project fresh target").recallState.candidateDocs).toHaveLength(1);
	});

	test("external fuzzy rescue still applies to the base shard while overlay is loaded", async () => {
		const baseArtifacts = buildResidentHotBaseArtifacts([
			doc("obsidian.md", "base document", 11, 1),
		]);
		const engine = new CoverageLexicalV3Engine();
		engine.loadResidentIndexView({
			version: 1,
			shards: [
				{
					shardId: "active-1",
					generation: 1,
					base: {
						...baseArtifacts.base,
						fuzzyRescue: EMPTY_RESIDENT_FUZZY_RESCUE_INDEX,
					},
				},
			],
		});
		engine.loadOverlayResidentShard(
			buildOverlayResidentShard({
				activeShardId: "active-1",
				activeShardGeneration: 1,
				entries: [
					{
						id: "active-1@1:1",
						activeShardId: "active-1",
						activeShardGeneration: 1,
						sequence: 1,
						operation: "append",
						document: doc("overlay.md", "overlay target", 12, 1),
						sourceBytes: 14,
						createdAt: 1,
					},
				],
			}),
		);

		const prepared = engine.prepareSearch(
			"obsidan",
			["obsidan"],
			{ allowFuzzyMatch: true },
			baseArtifacts.fuzzyRescueIndex,
		);

		expect(prepared.guardedCandidateDocs.map((candidate) => candidate.shardId)).toContain(
			"active-1",
		);
		expect(
			prepared.unitFamilyMatches[0]?.matches.some(
				(match) => match.matchKind === "fuzzy" && match.shardId === "active-1",
			),
		).toBe(true);
	});
});
