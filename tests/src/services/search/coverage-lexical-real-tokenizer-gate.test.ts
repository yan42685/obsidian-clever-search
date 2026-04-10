import { container } from "tsyringe";

import {
	COVERAGE_LEXICAL_REAL_TOKENIZER_DOCUMENTS_V1,
	COVERAGE_LEXICAL_REAL_TOKENIZER_MANIFEST_VERSION,
	COVERAGE_LEXICAL_REAL_TOKENIZER_QUERY_MANIFEST_V1,
	createRealChineseCoverageTokenizer,
} from "./coverage-lexical-real-tokenizer-manifest-v1";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

type RealTokenizerGate = "real_tokenizer_top1_gate" | "real_tokenizer_display_front_gate";

type GateMetric = {
	passRate: number;
	count: number;
};

function resetContainerState(): void {
	if ("reset" in container && typeof (container as any).reset === "function") {
		(container as any).reset();
	} else {
		container.clearInstances();
	}
}

describe("coverage lexical real tokenizer gate", () => {
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

	test("reports formal real-tokenizer gates from the versioned query manifest", async () => {
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
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([...COVERAGE_LEXICAL_REAL_TOKENIZER_DOCUMENTS_V1]);

		let top1PassCount = 0;
		let displayFrontPassCount = 0;
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
			if (results[0]?.path === queryCase.expectedTop1Path) {
				top1PassCount += 1;
			}
			if (
				queryCase.forbiddenFrontPaths.every(
					(forbiddenPath) => !displayFront.includes(forbiddenPath),
				)
			) {
				displayFrontPassCount += 1;
			}
		}

		const byGate: Record<RealTokenizerGate, GateMetric> = {
			real_tokenizer_top1_gate: {
				passRate:
					top1PassCount / COVERAGE_LEXICAL_REAL_TOKENIZER_QUERY_MANIFEST_V1.length,
				count: COVERAGE_LEXICAL_REAL_TOKENIZER_QUERY_MANIFEST_V1.length,
			},
			real_tokenizer_display_front_gate: {
				passRate:
					displayFrontPassCount /
					COVERAGE_LEXICAL_REAL_TOKENIZER_QUERY_MANIFEST_V1.length,
				count: COVERAGE_LEXICAL_REAL_TOKENIZER_QUERY_MANIFEST_V1.length,
			},
		};

		console.log(
			"[coverage-lexical-real-tokenizer-gate] summary",
			JSON.stringify(
				{
					manifestVersion: COVERAGE_LEXICAL_REAL_TOKENIZER_MANIFEST_VERSION,
					caseCount: COVERAGE_LEXICAL_REAL_TOKENIZER_QUERY_MANIFEST_V1.length,
					byGate,
				},
				null,
				2,
			),
		);

		expect(byGate.real_tokenizer_top1_gate.passRate).toBe(1);
		expect(byGate.real_tokenizer_display_front_gate.passRate).toBe(1);
	});
});
