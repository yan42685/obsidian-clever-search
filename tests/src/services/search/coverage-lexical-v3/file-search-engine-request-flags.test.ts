jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import type { CoverageLexicalV3SearchResult } from "src/services/search/coverage-lexical-v3/engine";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import { container } from "tsyringe";

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
		generation: overrides.generation ?? 1,
		size: overrides.size,
	};
}

function createLatinQueryAnalysis(queryText: string, terms: readonly string[]) {
	return {
		queryText,
		normalizedQueryText: queryText,
		querySingletonHanChar: null,
		querySingletonHanCodePoint: null,
		querySingletonHanRecallEligible: false,
		surfaceGroups: terms.map((term, index) => ({
			index,
			text: term,
			kind: "latin" as const,
			hanBigramTexts: [],
			coveredCharMask: [],
			queryResidualUniqueBigrams: [],
			hasQueryResidualHanCoverage: false,
		})),
		primaryUnits: terms.map((term, index) => ({
			index,
			text: term,
			source: "surface" as const,
			surfaceGroupIndex: index,
		})),
		hanBackstopGroups: [],
		surfaceCoverageShapeKey:
			terms.length === 0
				? ""
				: Array.from({ length: terms.length }, () => "l").join(""),
	};
}

describe("coverage lexical v3 file search engine request flags", () => {
	beforeEach(() => {
		container.registerInstance(
			Tokenizer,
			{
				tokenizeSequence: (text: string) =>
					text
						.toLowerCase()
						.split(/\s+/u)
						.map((token) => token.trim())
						.filter((token) => token.length > 0),
			} as unknown as InstanceType<typeof Tokenizer>,
		);
	});

	test("searchFiles forwards prefix and fuzzy request flags into engine.search", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const snapshotStore = {
			readIndexedTexts: jest.fn(async () => new Map<string, string>()),
			readIndexedMetadata: jest.fn(async () => new Map()),
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
			publishIndexedTexts: jest.fn(async () => undefined),
			publishLexicalIndexedMetadata: jest.fn(async () => undefined),
			publishLexicalFuzzyRescue: jest.fn(async () => undefined),
			publishLexicalBodyEvidence: jest.fn(async () => undefined),
			publishLexicalHanDocEvidence: jest.fn(async () => undefined),
			publishLexicalHanBodyEvidence: jest.fn(async () => undefined),
		};
		(engine as unknown as {
			getFileSnapshotStore: () => typeof snapshotStore;
		}).getFileSnapshotStore = () => snapshotStore;
		await engine.reIndexAll([
			createDocument({
				path: "latin/freefonts.md",
				basename: "freefonts",
				folder: "latin",
				content: "freefonts reference",
			}),
		]);
		const prepareSearch = jest.fn(() => ({ token: "prepared" }));
		const hydrateRankingEvidenceForCandidates = jest.fn(async () => ({
			hydratedEvidenceByLiveDocSlot: new Map<number, unknown>(),
		}));
		const rankPreparedSearch = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: createLatinQueryAnalysis("freefont", ["freefont"]),
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [],
		}));
		(engine as unknown as {
			engine: {
				prepareSearch: typeof prepareSearch;
				rankPreparedSearch: typeof rankPreparedSearch;
				getResidentBase: () => ResidentBase | null;
			};
			hydrateRankingEvidenceForCandidates: typeof hydrateRankingEvidenceForCandidates;
		}).engine = {
			prepareSearch,
			rankPreparedSearch,
			getResidentBase: () => null,
		};
		(engine as unknown as {
			hydrateRankingEvidenceForCandidates: typeof hydrateRankingEvidenceForCandidates;
		}).hydrateRankingEvidenceForCandidates = hydrateRankingEvidenceForCandidates;

		await engine.searchFiles({
			queryText: "freefont",
			isPrefixMatch: false,
			isFuzzy: true,
			hideWeaklyRelatedResults: false,
			maxItemResults: 5,
		});

		expect(prepareSearch).toHaveBeenCalledWith(
			"freefont",
			["freefont"],
			{ allowPrefixMatch: false, allowFuzzyMatch: true, maxItemResults: 5 },
			expect.objectContaining({
				candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: expect.any(Map),
			}),
		);
	});
});
