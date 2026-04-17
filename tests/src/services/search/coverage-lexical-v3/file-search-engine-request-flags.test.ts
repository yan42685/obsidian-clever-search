jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

import type { IndexedDocument } from "src/globals/search-types";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { CoverageLexicalV3SearchResult } from "src/services/search/coverage-lexical-v3/engine";
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
			} as unknown as Tokenizer,
		);
	});

	test("searchFiles forwards prefix and fuzzy request flags into engine.search", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		await engine.reIndexAll([
			createDocument({
				path: "latin/freefonts.md",
				basename: "freefonts",
				folder: "latin",
				content: "freefonts reference",
			}),
		]);
		const search = jest.fn((): CoverageLexicalV3SearchResult => ({
			recallState: {
				queryAnalysis: {
					queryText: "freefont",
					normalizedQueryText: "freefont",
					surfaceGroups: [
						{
							index: 0,
							text: "freefont",
							kind: "latin",
							hanBigramTexts: [],
							coveredCharMask: [],
							queryResidualUniqueBigrams: [],
							hasQueryResidualHanCoverage: false,
						},
					],
					primaryUnits: [
						{ index: 0, text: "freefont", source: "surface", surfaceGroupIndex: 0 },
					],
					hanBackstopGroups: [],
					surfaceCoverageShapeKey: "l",
				},
				unitFamilyMatches: [],
				candidateDocs: [],
			},
			rankedCandidates: [],
		}));
		(engine as unknown as {
			engine: {
				search: typeof search;
				getResidentBase: () => ResidentBase | null;
			};
		}).engine = {
			search,
			getResidentBase: () => null,
		};

		await engine.searchFiles({
			queryText: "freefont",
			isPrefixMatch: false,
			isFuzzy: true,
			hideWeaklyRelatedResults: false,
			maxItemResults: 5,
		});

		expect(search).toHaveBeenCalledWith(
			"freefont",
			["freefont"],
			{ allowPrefixMatch: false, allowFuzzyMatch: true },
		);
	});
});
