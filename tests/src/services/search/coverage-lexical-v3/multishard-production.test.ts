import type { IndexedDocument } from "src/globals/search-types";
import {
	buildResidentHotBaseArtifacts,
	residentIndexViewFromBase,
} from "src/services/search/coverage-lexical-v3/build";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import type { ShardInvalidationEntry } from "src/services/search/coverage-lexical-v3/invalidation";
import type { ResidentIndexView } from "src/services/search/coverage-lexical-v3/layout/types";

function createDocument(
	path: string,
	content: string,
	docRef: number,
	basename = path.replace(/\.md$/, ""),
	generation = 1,
): IndexedDocument {
	return {
		path,
		basename,
		folder: "notes",
		content,
		headings: basename,
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

describe("coverage lexical v3 production multishard", () => {
	test("loads multiple resident shards and ranks through a single global search path", () => {
		const engine = new CoverageLexicalV3Engine();
		const indexView: ResidentIndexView = {
			version: 1,
			shards: [
				buildShard("sealed-0", 1, [
					createDocument(
						"alpha.md",
						"projected token runtime access",
						1,
						"projected token runtime access",
					),
				]),
				buildShard("active-1", 1, [
					createDocument("beta.md", "runtime access note", 2, "runtime access note"),
				]),
			],
		};

		engine.loadResidentIndexView(indexView);
		const result = engine.search("projected token runtime access");

		expect(result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text)).toEqual([
			"projected",
			"token",
			"runtime",
			"access",
		]);
		expect(result.rankedCandidates[0]?.path).toBe("alpha.md");
		expect(result.recallState.candidateDocs.map((candidate) => candidate.shardId)).toEqual(
			expect.arrayContaining(["sealed-0", "active-1"]),
		);
	});

	test("single-shard builder remains backward compatible", () => {
		const engine = new CoverageLexicalV3Engine();
		const indexView = residentIndexViewFromBase(
			buildResidentHotBaseArtifacts([
				createDocument("single.md", "search target", 1, "search target"),
			]).base,
		);

		expect(() => engine.loadResidentIndexView(indexView)).not.toThrow();
		expect(engine.search("search target").rankedCandidates[0]?.path).toBe("single.md");
	});

	test("query-time invalidation hides superseded sealed documents", () => {
		const engine = new CoverageLexicalV3Engine();
		const indexView: ResidentIndexView = {
			version: 1,
			shards: [
				buildShard("sealed-0", 1, [
					createDocument("old.md", "project alpha old", 7, "project alpha old", 1),
				]),
				buildShard("active-1", 1, [
					createDocument("new.md", "project alpha new", 7, "project alpha new", 2),
				]),
			],
		};
		const invalidations: ShardInvalidationEntry[] = [
			{
				shardId: "sealed-0",
				shardGeneration: 1,
				docRef: 7,
				docGeneration: 1,
				reason: "superseded",
				createdAt: 1,
			},
		];

		engine.loadResidentIndexView(indexView);
		engine.loadShardInvalidations(invalidations);
		const result = engine.search("project alpha");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toContain("new.md");
		expect(result.rankedCandidates.map((candidate) => candidate.path)).not.toContain("old.md");
		expect(result.recallState.candidateDocs.map((candidate) => candidate.shardId)).not.toContain(
			"sealed-0",
		);
	});

	test("query-time invalidation hides deleted sealed documents without rewriting shards", () => {
		const engine = new CoverageLexicalV3Engine();
		const indexView: ResidentIndexView = {
			version: 1,
			shards: [
				buildShard("sealed-0", 1, [
					createDocument("deleted.md", "orphan cleanup target", 8, "orphan cleanup target"),
				]),
			],
		};

		engine.loadResidentIndexView(indexView);
		engine.loadShardInvalidations([
			{
				shardId: "sealed-0",
				shardGeneration: 1,
				docRef: 8,
				docGeneration: 1,
				reason: "deleted",
				createdAt: 1,
			},
		]);

		expect(engine.search("orphan cleanup target").rankedCandidates).toHaveLength(0);
	});

	test("fuzzy rescue keeps shard-local family slots scoped to each shard", () => {
		const engine = new CoverageLexicalV3Engine();
		const indexView: ResidentIndexView = {
			version: 1,
			shards: [
				buildShard("sealed-0", 1, [
					createDocument("aaaaaa.md", "slot padding", 1, "aaaaaa"),
					createDocument("projecta.md", "sealed target", 2, "projecta"),
				]),
				buildShard("active-1", 1, [
					createDocument("projectb.md", "active target", 3, "projectb"),
				]),
			],
		};

		engine.loadResidentIndexView(indexView);
		const result = engine.search("projectx", ["projectx"], {
			allowFuzzyMatch: true,
			allowPrefixMatch: false,
		});

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual(
			expect.arrayContaining(["projecta.md", "projectb.md"]),
		);
		expect(
			result.recallState.unitFamilyMatches.flatMap((unitMatch) =>
				unitMatch.matches.map((match) => `${match.shardId}:${match.familyText}`),
			),
		).toEqual(expect.arrayContaining(["sealed-0:projecta", "active-1:projectb"]));
	});
});
