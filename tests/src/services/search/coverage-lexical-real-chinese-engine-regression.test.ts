import { container } from "tsyringe";

import {
	COVERAGE_LEXICAL_REAL_TOKENIZER_DOCUMENTS_V1,
	COVERAGE_LEXICAL_REAL_TOKENIZER_QUERY_MANIFEST_V1,
	createRealChineseCoverageTokenizer,
} from "./coverage-lexical-real-tokenizer-manifest-v1";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

function resetContainerState(): void {
	if ("reset" in container && typeof (container as any).reset === "function") {
		(container as any).reset();
	} else {
		container.clearInstances();
	}
}

describe("coverage lexical real Chinese engine regression", () => {
	beforeEach(() => {
		resetContainerState();
		process.env.COVERAGE_LEXICAL_DISPLAY_PRUNE_ENABLED = "1";
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
		container.registerInstance(Tokenizer, createRealChineseCoverageTokenizer() as any);
	});

	afterEach(() => {
		delete process.env.COVERAGE_LEXICAL_DISPLAY_PRUNE_ENABLED;
		delete (global as any).window;
		resetContainerState();
		jest.resetModules();
	});

	test("keeps balanced Chinese and mixed-script targets at top and suppresses one-sided distractors from the display front", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: Array<Record<string, string>>): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
				maxItemResults: number;
				}): Promise<Array<{ path: string; queryTerms: string[]; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([...COVERAGE_LEXICAL_REAL_TOKENIZER_DOCUMENTS_V1]);

		for (const queryCase of COVERAGE_LEXICAL_REAL_TOKENIZER_QUERY_MANIFEST_V1) {
			const results = await engine.searchFiles({
				queryText: queryCase.query,
				isPrefixMatch: true,
				isFuzzy: true,
				maxItemResults: 5,
			});
			const displayFront = results
				.slice(0, queryCase.displayFrontSize)
				.map((result) => result.path);

			expect(results[0]?.path).toBe(queryCase.expectedTop1Path);
			for (const forbiddenPath of queryCase.forbiddenFrontPaths) {
				expect(displayFront).not.toContain(forbiddenPath);
			}
		}
	});
});
