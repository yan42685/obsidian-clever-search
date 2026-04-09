import type {
	CoverageLexicalFamilyCountSummary,
	CoverageLexicalFamilySignal,
	CoverageLexicalPlan,
} from "src/services/search/coverage-lexical/coverage-lexical-types";
import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

type IndexedDocument = {
	path: string;
	generation?: number;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

let mockFileSnapshotCurrentTexts: Map<string, string> | null = null;
let mockFileSnapshotPersistedTexts: Map<string, string> | null = null;

function createMockTokenizer() {
	function normalize(text: string): string {
		return text.toLowerCase().normalize("NFKC");
	}
	function tokenizeSegment(segment: string): string[] {
		const compact = normalize(segment);
		if (compact.trim().length === 0) {
			return [];
		}
		const parts = compact.match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
		const tokens: string[] = [];
		for (const part of parts) {
			if (/^[a-z0-9_-]+$/u.test(part)) {
				tokens.push(part);
				continue;
			}
			tokens.push(part);
			if (part.length <= 2) {
				continue;
			}
			for (let index = 0; index < part.length - 1; index++) {
				tokens.push(part.slice(index, index + 2));
			}
		}
		return Array.from(new Set(tokens));
	}
	return {
		tokenize(text: string): string[] {
			return tokenizeSegment(text);
		},
		tokenizeSequence(text: string): string[] {
			return tokenizeSegment(text);
		},
		tokenizeSequenceWithOffsets(text: string): Array<{
			token: string;
			start: number;
			end: number;
		}> {
			const normalized = normalize(text);
			const matches = normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9_-]+/gu);
			const seen = new Set<string>();
			const out: Array<{ token: string; start: number; end: number }> = [];
			for (const match of matches) {
				const part = match[0];
				const start = match.index ?? 0;
				if (/^[a-z0-9_-]+$/u.test(part)) {
					if (!seen.has(part)) {
						out.push({ token: part, start, end: start + part.length });
						seen.add(part);
					}
					continue;
				}
				if (!seen.has(part)) {
					out.push({ token: part, start, end: start + part.length });
					seen.add(part);
				}
				if (part.length <= 2) {
					continue;
				}
				for (let index = 0; index < part.length - 1; index++) {
					const token = part.slice(index, index + 2);
					if (seen.has(token)) {
						continue;
					}
					out.push({
						token,
						start: start + index,
						end: start + index + 2,
					});
					seen.add(token);
				}
			}
			return out;
		},
	};
}

function registerMockFileSnapshotStore(
	documents: readonly IndexedDocument[] = [],
): void {
	const { FileSnapshotStore } = require(
		"src/services/search/shared/file-snapshot-store",
	) as {
		FileSnapshotStore: new () => unknown;
	};
	const currentTexts =
		mockFileSnapshotCurrentTexts ?? new Map<string, string>();
	const persistedTexts =
		mockFileSnapshotPersistedTexts ?? new Map<string, string>();
	for (const document of documents) {
		const text = document.content ?? "";
		if (!currentTexts.has(document.path)) {
			currentTexts.set(document.path, text);
		}
		if (!persistedTexts.has(document.path)) {
			persistedTexts.set(document.path, text);
		}
	}
	mockFileSnapshotCurrentTexts = currentTexts;
	mockFileSnapshotPersistedTexts = persistedTexts;
	container.registerInstance(FileSnapshotStore, {
		__currentTexts: currentTexts,
		__persistedTexts: persistedTexts,
		readCurrentTexts: jest.fn(
			async (fileOrPaths: ReadonlyArray<string | { path: string }>) => {
				const result = new Map<string, string>();
				for (const fileOrPath of fileOrPaths) {
					const path =
						typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
					const text = currentTexts.get(path) ?? persistedTexts.get(path);
					if (text !== undefined) {
						result.set(path, text);
					}
				}
				return result;
			},
		),
		readIndexedTexts: jest.fn(
			async (
				requests: ReadonlyArray<{
					path: string;
					generation?: number;
				}>,
			) => {
				const result = new Map<string, string>();
				for (const request of requests) {
					const text = persistedTexts.get(request.path);
					if (text !== undefined) {
						result.set(request.path, text);
					}
				}
				return result;
			},
		),
	} as any);
}

function createComparatorPlan(
	route: CoverageLexicalPlan["route"] = "body-with-anchor",
	overrides: Partial<CoverageLexicalPlan> = {},
): CoverageLexicalPlan {
	return {
		families: [],
		queryKind: "anchor_body_hybrid",
		shortQueryOverlay: false,
		hasMetadataHint: false,
		hasMixedScriptHint: false,
		hasPathShapeHint: false,
		hasTitleShapeHint: false,
		route,
		hardAnchorFamilies: [],
		decisiveBodyFamilies: [],
		supportBodyFamilies: [],
		optionalFamilies: [],
		noiseFamilies: [],
		bridgeFamilies: [],
		relaxedMinimumMatchCount: 0,
		coreFamilyCount: 0,
		anchorFamilyCount: 0,
		bodyFamilyCount: 0,
		explain: {
			queryKind: overrides.queryKind ?? "anchor_body_hybrid",
			route: overrides.route ?? route,
			spans: [],
			familyReasons: [],
			queryKindReasons: [],
		},
		...overrides,
	};
}

function createEmptyWindowFusionSignal(): CoverageLexicalFamilySignal["localEvidence"] {
	return {
		primary: {
			start: -1,
			end: -1,
			coreCoverageCount: 0,
			exactCoreWeight: 0,
			prefixCoreWeight: 0,
			fuzzyCoreWeight: 0,
			anchorCoverageCount: 0,
			softCoverageCount: 0,
			adjacentCorePairCount: 0,
			adjacentCorePairWeight: 0,
			orderedPairCount: 0,
			orderRatio: 0,
			compactnessRatio: 0,
			score: 0,
			matchedExactCoreFamilyIndices: [],
			matchedPrefixCoreFamilyIndices: [],
			matchedFuzzyCoreFamilyIndices: [],
			matchedAnchorFamilyIndices: [],
			matchedSoftFamilyIndices: [],
		},
		support: {
			start: -1,
			end: -1,
			coreCoverageCount: 0,
			exactCoreWeight: 0,
			prefixCoreWeight: 0,
			fuzzyCoreWeight: 0,
			anchorCoverageCount: 0,
			softCoverageCount: 0,
			adjacentCorePairCount: 0,
			adjacentCorePairWeight: 0,
			orderedPairCount: 0,
			orderRatio: 0,
			compactnessRatio: 0,
			score: 0,
			matchedExactCoreFamilyIndices: [],
			matchedPrefixCoreFamilyIndices: [],
			matchedFuzzyCoreFamilyIndices: [],
			matchedAnchorFamilyIndices: [],
			matchedSoftFamilyIndices: [],
		},
		supportWindowCount: 0,
		corroboratedCoreCoverageCount: 0,
		corroboratedExactCoreWeight: 0,
		corroboratedPrefixCoreWeight: 0,
		corroboratedFuzzyCoreWeight: 0,
		corroboratedAnchorCoverageCount: 0,
		corroboratedSoftCoverageCount: 0,
	};
}

function compareSignals(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	const { compareCoverageLexicalResultSignals } = require(
		"src/services/search/coverage-lexical/coverage-lexical-ranker",
	) as {
		compareCoverageLexicalResultSignals(
			left: CoverageLexicalFamilySignal,
			right: CoverageLexicalFamilySignal,
			plan: CoverageLexicalPlan,
		): number;
	};
	return compareCoverageLexicalResultSignals(left, right, plan);
}

function createDisplayPruneConfig() {
	return {
		enabled: true,
		top2To4Ratio: 0.34,
		top5PlusRatio: 0.5,
		countPruneMinTopCount: 3,
		top2To4CountRatio: 0.67,
		top5PlusCountRatio: 0.5,
		top2To4CountSlack: 1,
		top5PlusCountSlack: 2,
		bodyCharWeight: 0.5,
		metadataCharWeight: 0.5,
		tagExactWeight: 0.75,
		tagCharWeight: 0.5,
	};
}

function createDocRankableResult(
	docId: number,
	signal: CoverageLexicalFamilySignal,
): any {
	return {
		docId,
		queryTerms: [],
		matchedTerms: signal.matchedTerms,
		score: 0,
		coverageLexicalSignal: signal,
		admissionSignal: {
			coreCoverageCount: 0,
			coreCoverageRatio: 0,
			anchorCoverageCount: 0,
			softCoverageCount: 0,
			phraseMatchCount: 0,
			phraseMatchWeight: 0,
			compactnessScore: 0,
		},
	};
}

function pruneDisplayResults(results: readonly any[]): any[] {
	const { pruneWeakCoverageLexicalDisplayResults } = require(
		"src/services/search/coverage-lexical/coverage-lexical-engine",
	) as {
		pruneWeakCoverageLexicalDisplayResults(
			results: readonly any[],
			config: ReturnType<typeof createDisplayPruneConfig>,
		): any[];
	};
	return pruneWeakCoverageLexicalDisplayResults(
		results,
		createDisplayPruneConfig(),
	);
}

function createFamilyCountSummary(
	overrides: Partial<CoverageLexicalFamilyCountSummary> = {},
): CoverageLexicalFamilyCountSummary {
	return {
		totalMatchedFamilyCount: 0,
		metadataMatchedFamilyCount: 0,
		bodyMatchedFamilyCount: 0,
		basenameMatchedFamilyCount: 0,
		aliasesMatchedFamilyCount: 0,
		folderMatchedFamilyCount: 0,
		headingsMatchedFamilyCount: 0,
		tagsMatchedFamilyCount: 0,
		...overrides,
	};
}

function createCoverageProfile(
	overrides: Partial<CoverageLexicalFamilySignal["coverageProfile"]> = {},
): CoverageLexicalFamilySignal["coverageProfile"] {
	return {
		meaningfulFamilyCount: 0,
		meaningfulCoveredFamilyCount: 0,
		meaningfulFamilyWeight: 0,
		meaningfulCoveredFamilyWeight: 0,
		requiredFamilyCount: 0,
		requiredCoveredFamilyCount: 0,
		requiredFamilyWeight: 0,
		requiredCoveredFamilyWeight: 0,
		decisiveFamilyCount: 0,
		decisiveCoveredFamilyCount: 0,
		decisiveFamilyWeight: 0,
		decisiveCoveredFamilyWeight: 0,
		supportFamilyCount: 0,
		supportCoveredFamilyCount: 0,
		supportFamilyWeight: 0,
		supportCoveredFamilyWeight: 0,
		requiredHanFamilyCount: 0,
		requiredHanCoveredFamilyCount: 0,
		requiredLatinFamilyCount: 0,
		requiredLatinCoveredFamilyCount: 0,
		crossScriptRequired: false,
		crossScriptSatisfied: false,
		...overrides,
	};
}

function createFamilySignal(
	overrides: Omit<
		Partial<CoverageLexicalFamilySignal>,
		"familyCountSummary" | "coverageProfile"
	> & {
		familyCountSummary?: Partial<CoverageLexicalFamilyCountSummary>;
		coverageProfile?: Partial<CoverageLexicalFamilySignal["coverageProfile"]>;
	} = {},
): CoverageLexicalFamilySignal {
	const { familyCountSummary, coverageProfile, ...restOverrides } = overrides;
	return {
		familyCountSummary: createFamilyCountSummary(familyCountSummary ?? {}),
		coverageProfile: createCoverageProfile(coverageProfile ?? {}),
		coreBody: {
			coverageCount: 0,
			exactWeight: 0,
			prefixWeight: 0,
			fuzzyWeight: 0,
		},
		softBody: {
			coverageCount: 0,
			exactWeight: 0,
			prefixWeight: 0,
			fuzzyWeight: 0,
		},
		metadataAnchor: {
			coverageCount: 0,
			exactWeight: 0,
			prefixWeight: 0,
			fuzzyWeight: 0,
		},
		metadataPrefixAssist: {
			coverageCount: 0,
			exactWeight: 0,
			prefixWeight: 0,
			fuzzyWeight: 0,
		},
		metadataIdentity: {
			phraseCoverageCount: 0,
			phraseWeight: 0,
			overall: {
				coverageCount: 0,
				exactWeight: 0,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			alias: {
				coverageCount: 0,
				exactWeight: 0,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			basename: {
				coverageCount: 0,
				exactWeight: 0,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			heading: {
				coverageCount: 0,
				exactWeight: 0,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			path: {
				coverageCount: 0,
				exactWeight: 0,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			tag: {
				coverageCount: 0,
				exactWeight: 0,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
		},
		bodyChar: {
			matchCount: 0,
			matchRatio: 0,
			exactSegmentCount: 0,
			fullSegmentCount: 0,
			bestSegmentCoverageCount: 0,
			bestSegmentCoverageRatio: 0,
		},
		metadataChar: {
			matchCount: 0,
			matchRatio: 0,
			exactSegmentCount: 0,
			fullSegmentCount: 0,
			bestSegmentCoverageCount: 0,
			bestSegmentCoverageRatio: 0,
		},
		tagSignal: {
			exactMatchCount: 0,
			charMatchCount: 0,
			charMatchRatio: 0,
		},
		tailCoreWeight: 0,
		tailSoftWeight: 0,
		phraseBridgeCount: 0,
		phraseBridgeWeight: 0,
		localEvidence: createEmptyWindowFusionSignal(),
		matchedTerms: [],
		...restOverrides,
	} as CoverageLexicalFamilySignal;
}

describe("coverage lexical ranking", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		mockFileSnapshotCurrentTexts = null;
		mockFileSnapshotPersistedTexts = null;
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
		container.registerInstance(Tokenizer, createMockTokenizer());
		const snapshotDocuments: IndexedDocument[] = [
			{
				path: "pkm-zh/mixed/cache-note.md",
				basename: "cache-note.md",
				folder: "pkm-zh/mixed",
				headings: "Cache note",
				content: [
					"alpha outline line",
					"\u7b2c\u4e8c\u884c mixed cache \u6062\u590d note bridge",
					"third trailing line",
				].join("\n"),
			},
			{
				path: "pkm-en/mixed/subitem-order.md",
				basename: "subitem-order.md",
				folder: "pkm-en/mixed",
				headings: "Subitem order",
				content: [
					"plugins fast",
					"filler filler filler filler filler filler filler filler filler",
					"plugin fast",
					"filler filler filler filler filler filler filler filler filler",
					"plugons fast",
				].join("\n"),
			},
			{
				path: "pkm-zh/mixed/symbol-run.md",
				basename: "symbol-run.md",
				folder: "pkm-zh/mixed",
				headings: "Symbol run",
				content: [
					"intro line",
					"\u8fd9\u91cc\u662f\u4e0a\u9762 foo/bar@v1.2#tag \u7684\u539f\u6587\u7247\u6bb5",
					"tail line",
				].join("\n"),
			},
		];
		registerMockFileSnapshotStore(snapshotDocuments);
	});

	afterEach(() => {
		delete (global as any).window;
		mockFileSnapshotCurrentTexts = null;
		mockFileSnapshotPersistedTexts = null;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("top-level comparator lets semantic body detail outrank metadata distribution when coverage ties", () => {
		const plan = createComparatorPlan("metadata-first");
		const left = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 3,
				metadataMatchedFamilyCount: 2,
				basenameMatchedFamilyCount: 1,
				aliasesMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 1,
			},
			coreBody: {
				coverageCount: 1,
				exactWeight: 2,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
		});
		const right = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 3,
				metadataMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 3,
			},
			coreBody: {
				coverageCount: 3,
				exactWeight: 40,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			localEvidence: {
				...createEmptyWindowFusionSignal(),
				primary: {
					...createEmptyWindowFusionSignal().primary,
					coreCoverageCount: 3,
					exactCoreWeight: 0,
					score: 200,
				},
			},
		});

		expect(compareSignals(left, right, plan)).toBeGreaterThan(0);
	});

	test("top-level comparator no longer lets bare metadata family counts outrank semantic body witness", () => {
		const plan = createComparatorPlan("metadata-first");
		const left = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 3,
				metadataMatchedFamilyCount: 0,
				bodyMatchedFamilyCount: 3,
			},
			coreBody: {
				coverageCount: 3,
				exactWeight: 40,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			localEvidence: {
				...createEmptyWindowFusionSignal(),
				primary: {
					...createEmptyWindowFusionSignal().primary,
					coreCoverageCount: 3,
					exactCoreWeight: 20,
					orderedPairCount: 2,
					orderRatio: 1,
					compactnessRatio: 1,
					score: 200,
				},
				corroboratedExactCoreWeight: 20,
			},
			phraseBridgeCount: 1,
			phraseBridgeWeight: 10,
		});
		const right = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 3,
				metadataMatchedFamilyCount: 2,
				bodyMatchedFamilyCount: 1,
				basenameMatchedFamilyCount: 1,
				aliasesMatchedFamilyCount: 1,
			},
			coreBody: {
				coverageCount: 1,
				exactWeight: 2,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
		});

		expect(compareSignals(left, right, plan)).toBeLessThan(0);
	});

	test("top-level comparator resolves detail signals before any legacy count helper", () => {
		const plan = createComparatorPlan("body-first");
		const left = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 2,
				metadataMatchedFamilyCount: 1,
				basenameMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 1,
			},
			coreBody: {
				coverageCount: 1,
				exactWeight: 5,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
		});
		const right = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 2,
				metadataMatchedFamilyCount: 1,
				basenameMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 1,
			},
			coreBody: {
				coverageCount: 1,
				exactWeight: 8,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
		});

		expect(compareSignals(left, right, plan)).toBeGreaterThan(0);
	});

	test("coverage profile prefers balanced mixed-script coverage before one-sided evidence spikes", () => {
		const plan = createComparatorPlan("body-with-anchor", {
			hasMixedScriptHint: true,
		});
		const left = createFamilySignal({
			coverageProfile: {
				requiredFamilyCount: 2,
				requiredCoveredFamilyCount: 2,
				requiredFamilyWeight: 2,
				requiredCoveredFamilyWeight: 2,
				meaningfulFamilyCount: 2,
				meaningfulCoveredFamilyCount: 2,
				meaningfulFamilyWeight: 2,
				meaningfulCoveredFamilyWeight: 2,
				decisiveFamilyCount: 2,
				decisiveCoveredFamilyCount: 2,
				decisiveFamilyWeight: 2,
				decisiveCoveredFamilyWeight: 2,
				requiredHanFamilyCount: 1,
				requiredHanCoveredFamilyCount: 1,
				requiredLatinFamilyCount: 1,
				requiredLatinCoveredFamilyCount: 1,
				crossScriptRequired: true,
				crossScriptSatisfied: true,
			},
			coreBody: {
				coverageCount: 2,
				exactWeight: 6,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
		});
		const right = createFamilySignal({
			coverageProfile: {
				requiredFamilyCount: 2,
				requiredCoveredFamilyCount: 1,
				requiredFamilyWeight: 2,
				requiredCoveredFamilyWeight: 1.2,
				meaningfulFamilyCount: 2,
				meaningfulCoveredFamilyCount: 1,
				meaningfulFamilyWeight: 2,
				meaningfulCoveredFamilyWeight: 1.2,
				decisiveFamilyCount: 2,
				decisiveCoveredFamilyCount: 1,
				decisiveFamilyWeight: 2,
				decisiveCoveredFamilyWeight: 1.2,
				requiredHanFamilyCount: 1,
				requiredHanCoveredFamilyCount: 0,
				requiredLatinFamilyCount: 1,
				requiredLatinCoveredFamilyCount: 1,
				crossScriptRequired: true,
				crossScriptSatisfied: false,
			},
			coreBody: {
				coverageCount: 1,
				exactWeight: 12,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			localEvidence: {
				...createEmptyWindowFusionSignal(),
				primary: {
					...createEmptyWindowFusionSignal().primary,
					exactCoreWeight: 8,
					orderedPairCount: 2,
					score: 180,
				},
			},
		});

		expect(compareSignals(left, right, plan)).toBeLessThan(0);
	});

	test("top-level comparator no longer uses legacy count as a semantic final fallback", () => {
		const plan = createComparatorPlan("body-first");
		const left = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 4,
				metadataMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 3,
			},
		});
		const right = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 2,
				metadataMatchedFamilyCount: 1,
				basenameMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 1,
			},
		});

		expect(compareSignals(left, right, plan)).toBe(0);
	});

	test("memory-relaxed coverage profile allows strong witness to rescue one support gap", () => {
		const plan = createComparatorPlan("body-with-anchor", {
			queryKind: "memory_relaxed",
		});
		const left = createFamilySignal({
			coverageProfile: {
				requiredFamilyCount: 4,
				requiredCoveredFamilyCount: 3,
				requiredFamilyWeight: 4,
				requiredCoveredFamilyWeight: 3.15,
				meaningfulFamilyCount: 4,
				meaningfulCoveredFamilyCount: 3,
				meaningfulFamilyWeight: 4,
				meaningfulCoveredFamilyWeight: 3.15,
				decisiveFamilyCount: 2,
				decisiveCoveredFamilyCount: 2,
				decisiveFamilyWeight: 2,
				decisiveCoveredFamilyWeight: 2,
				supportFamilyCount: 2,
				supportCoveredFamilyCount: 1,
				supportFamilyWeight: 2,
				supportCoveredFamilyWeight: 1.15,
			},
			coreBody: {
				coverageCount: 2,
				exactWeight: 10,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			phraseBridgeCount: 1,
			phraseBridgeWeight: 3,
			localEvidence: {
				...createEmptyWindowFusionSignal(),
				primary: {
					...createEmptyWindowFusionSignal().primary,
					exactCoreWeight: 4,
					orderedPairCount: 1,
					score: 120,
				},
				corroboratedExactCoreWeight: 4,
			},
		});
		const right = createFamilySignal({
			coverageProfile: {
				requiredFamilyCount: 4,
				requiredCoveredFamilyCount: 4,
				requiredFamilyWeight: 4,
				requiredCoveredFamilyWeight: 4,
				meaningfulFamilyCount: 4,
				meaningfulCoveredFamilyCount: 4,
				meaningfulFamilyWeight: 4,
				meaningfulCoveredFamilyWeight: 4,
				decisiveFamilyCount: 2,
				decisiveCoveredFamilyCount: 2,
				decisiveFamilyWeight: 2,
				decisiveCoveredFamilyWeight: 2,
				supportFamilyCount: 2,
				supportCoveredFamilyCount: 2,
				supportFamilyWeight: 2,
				supportCoveredFamilyWeight: 2,
			},
			coreBody: {
				coverageCount: 1,
				exactWeight: 2,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
			softBody: {
				coverageCount: 4,
				exactWeight: 0,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
		});

		expect(compareSignals(left, right, plan)).toBeLessThan(0);
	});

	// Product-facing guardrails begin here. These cases should survive the
	// ranking rewrite because they reflect user-intuitive result selection rather
	// than the current count-prefix comparator shape.
	test("display prune keeps later results whose family coverage stays near the top result", () => {
		const results = [
			createDocRankableResult(
				1,
				createFamilySignal({
					familyCountSummary: {
						totalMatchedFamilyCount: 5,
						bodyMatchedFamilyCount: 5,
					},
					coreBody: {
						coverageCount: 5,
						exactWeight: 5,
						prefixWeight: 0,
						fuzzyWeight: 0,
					},
				}),
			),
			createDocRankableResult(
				2,
				createFamilySignal({
					familyCountSummary: {
						totalMatchedFamilyCount: 3,
						bodyMatchedFamilyCount: 3,
					},
					coreBody: {
						coverageCount: 1,
						exactWeight: 0,
						prefixWeight: 0,
						fuzzyWeight: 0,
					},
				}),
			),
			createDocRankableResult(
				3,
				createFamilySignal({
					familyCountSummary: {
						totalMatchedFamilyCount: 4,
						bodyMatchedFamilyCount: 4,
					},
					coreBody: {
						coverageCount: 1,
						exactWeight: 0,
						prefixWeight: 0,
						fuzzyWeight: 0,
					},
				}),
			),
		];

		expect(pruneDisplayResults(results).map((result) => result.docId)).toEqual([
			1,
			3,
		]);
	});

	test("display prune rescues low-count results when strong witness and display coverage stay strong", () => {
		const results = [
			createDocRankableResult(
				1,
				createFamilySignal({
					familyCountSummary: {
						totalMatchedFamilyCount: 5,
						bodyMatchedFamilyCount: 5,
					},
					coreBody: {
						coverageCount: 5,
						exactWeight: 5,
						prefixWeight: 0,
						fuzzyWeight: 0,
					},
				}),
			),
			createDocRankableResult(
				2,
				createFamilySignal({
					familyCountSummary: {
						totalMatchedFamilyCount: 3,
						bodyMatchedFamilyCount: 3,
					},
					coreBody: {
						coverageCount: 2,
						exactWeight: 1,
						prefixWeight: 0,
						fuzzyWeight: 0,
					},
					localEvidence: {
						...createEmptyWindowFusionSignal(),
						primary: {
							...createEmptyWindowFusionSignal().primary,
							exactCoreWeight: 1,
							orderedPairCount: 1,
						},
					},
				}),
			),
			createDocRankableResult(
				3,
				createFamilySignal({
					familyCountSummary: {
						totalMatchedFamilyCount: 3,
						bodyMatchedFamilyCount: 3,
					},
					coreBody: {
						coverageCount: 1,
						exactWeight: 0,
						prefixWeight: 0,
						fuzzyWeight: 0,
					},
				}),
			),
		];

		expect(pruneDisplayResults(results).map((result) => result.docId)).toEqual([
			1,
			2,
		]);
	});

	test("display prune does not rescue one-sided mixed-script tails with strong witness only on one side", () => {
		const results = [
			createDocRankableResult(
				1,
				createFamilySignal({
					familyCountSummary: {
						totalMatchedFamilyCount: 5,
						bodyMatchedFamilyCount: 5,
					},
					coverageProfile: {
						meaningfulFamilyCount: 4,
						meaningfulCoveredFamilyCount: 4,
						meaningfulFamilyWeight: 4,
						meaningfulCoveredFamilyWeight: 4,
						requiredFamilyCount: 2,
						requiredCoveredFamilyCount: 2,
						requiredFamilyWeight: 2,
						requiredCoveredFamilyWeight: 2,
						decisiveFamilyCount: 2,
						decisiveCoveredFamilyCount: 2,
						decisiveFamilyWeight: 2,
						decisiveCoveredFamilyWeight: 2,
						requiredHanFamilyCount: 1,
						requiredHanCoveredFamilyCount: 1,
						requiredLatinFamilyCount: 1,
						requiredLatinCoveredFamilyCount: 1,
						crossScriptRequired: true,
						crossScriptSatisfied: true,
					},
					coreBody: {
						coverageCount: 4,
						exactWeight: 5,
						prefixWeight: 0,
						fuzzyWeight: 0,
					},
				}),
			),
			createDocRankableResult(
				2,
				createFamilySignal({
					familyCountSummary: {
						totalMatchedFamilyCount: 3,
						bodyMatchedFamilyCount: 3,
					},
					coverageProfile: {
						meaningfulFamilyCount: 4,
						meaningfulCoveredFamilyCount: 1,
						meaningfulFamilyWeight: 4,
						meaningfulCoveredFamilyWeight: 1.1,
						requiredFamilyCount: 2,
						requiredCoveredFamilyCount: 1,
						requiredFamilyWeight: 2,
						requiredCoveredFamilyWeight: 1.1,
						decisiveFamilyCount: 2,
						decisiveCoveredFamilyCount: 1,
						decisiveFamilyWeight: 2,
						decisiveCoveredFamilyWeight: 1.1,
						requiredHanFamilyCount: 1,
						requiredHanCoveredFamilyCount: 0,
						requiredLatinFamilyCount: 1,
						requiredLatinCoveredFamilyCount: 1,
						crossScriptRequired: true,
						crossScriptSatisfied: false,
					},
					coreBody: {
						coverageCount: 1,
						exactWeight: 1,
						prefixWeight: 0,
						fuzzyWeight: 0,
					},
					localEvidence: {
						...createEmptyWindowFusionSignal(),
						primary: {
							...createEmptyWindowFusionSignal().primary,
							exactCoreWeight: 1,
							orderedPairCount: 1,
						},
					},
				}),
			),
		];

		expect(pruneDisplayResults(results).map((result) => result.docId)).toEqual([
			1,
		]);
	});

	test("prefers stronger metadata identity evidence for mixed-anchor queries", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const documents: IndexedDocument[] = [
			{
				path: "pkm-en/notes/linking/aliases-deep-dive.md",
				basename: "aliases-deep-dive.md",
				folder: "pkm-en/notes/linking",
				headings: "Aliases and old names",
				content:
					"aliases let one note answer to multiple old names when project links drift",
				aliases: "old project aliases;legacy aliases",
			},
			{
				path: "pkm-en/notes/linking/project-rename-map.md",
				basename: "project-rename-map.md",
				folder: "pkm-en/notes/linking",
				headings: "Project rename map",
				content:
					"canonical project rename map covers old project names and migration references",
				aliases: "rename map;canonical project names",
			},
			{
				path: "pkm-en/notes/linking/old-project-index.md",
				basename: "old-project-index.md",
				folder: "pkm-en/notes/linking",
				headings: "Old project index",
				content:
					"index of old project names and archived references without alias guidance",
			},
		];
		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);

		const results = await engine.searchFiles({
			queryText: "old names still resolve through aliases",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("pkm-en/notes/linking/aliases-deep-dive.md");
	});

	test("prefers exact body witness over broader metadata topic pages", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "adversarial/ranker-lab/en/exact-quality-witness.md",
				basename: "exact-quality-witness.md",
				folder: "adversarial/ranker-lab/en",
				headings: "Exact quality witness",
				content:
					"config data rollout keeps exact family evidence together in one compact note",
			},
			{
				path: "tech-en/content/en/docs/concepts/configuration/configmap.md",
				basename: "configmap.md",
				folder: "tech-en/content/en/docs/concepts/configuration",
				headings: "ConfigMap Pod data",
				content:
					"configmap pod data guidance explains how pods read mounted configuration data safely",
			},
			{
				path: "tech-en/content/en/docs/concepts/configuration/secret.md",
				basename: "secret.md",
				folder: "tech-en/content/en/docs/concepts/configuration",
				headings: "Secret Pod data",
				content:
					"secret pod data guidance explains sensitive credentials and mounted secret files",
			},
			{
				path: "tech-en/content/en/docs/concepts/storage/projected-volumes.md",
				basename: "projected-volumes.md",
				folder: "tech-en/content/en/docs/concepts/storage",
				headings: "Projected volumes",
				content:
					"projected volumes combine service account token, configmap, and secret sources for pods",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "config data rollout",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe(
			"adversarial/ranker-lab/en/exact-quality-witness.md",
		);
	});

	test("prefers mixed-script files that cover both language sides of the query", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const runtimeAccess = "运行时访问";
		const runtimeRecord = `${runtimeAccess}记录`;
		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "pkm-mixed/runtime/projected-token-runtime-access.md",
				basename: "projected-token-runtime-access.md",
				folder: "pkm-mixed/runtime",
				headings: `Projected token ${runtimeAccess}`,
				content: `projected token runtime access note explains ${runtimeAccess} constraints and token rotation`,
				aliases: `${runtimeAccess} projected token access`,
			},
			{
				path: "tech-en/content/en/docs/concepts/security/projected-token.md",
				basename: "projected-token.md",
				folder: "tech-en/content/en/docs/concepts/security",
				headings: "Projected token",
				content:
					"projected token projected token access guidance for service account credentials",
			},
			{
				path: `pkm-zh/runtime/${runtimeRecord}.md`,
				basename: `${runtimeRecord}.md`,
				folder: "pkm-zh/runtime",
				headings: runtimeRecord,
				content: `${runtimeAccess} ${runtimeAccess} 访问记录汇总，不讨论 projected token 身份文件`,
			},
		]);

		const results = await engine.searchFiles({
			queryText: `projected token ${runtimeAccess}`,
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe(
			"pkm-mixed/runtime/projected-token-runtime-access.md",
		);
	});

	// Exception-aware product guardrails: these queries are intentionally memory-
	// shaped and should remain solvable without requiring strict full coverage of
	// every lexical family.
	test("uses best local explanation window for partial-memory ties", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const documents: IndexedDocument[] = [
			{
				path: "pkm-en/projects/sdk/cache-restore-checklist.md",
				basename: "cache-restore-checklist.md",
				folder: "pkm-en/projects/sdk",
				headings: "Cache restore checklist",
				content:
					"note about cache restore after warmup failed needs checkpoint replay warmup verification and shard checks",
				aliases: "cache restore after outage;restore note",
			},
			{
				path: "pkm-en/inbox/restart-cache-after-outage.md",
				basename: "restart-cache-after-outage.md",
				folder: "pkm-en/inbox",
				headings: "Restart cache after outage",
				content:
					"note about restart actions after outage with filler context then cache then more filler then after then more filler then warmup then more filler then failed replay",
			},
			{
				path: "pkm-en/notes/cache-restart-verification.md",
				basename: "cache-restart-verification.md",
				folder: "pkm-en/notes",
				headings: "Cache restart verification",
				content:
					"verification note covers cache restart after outage with replay checks and later after warmup confirmation after many checklist steps",
			},
		];

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);

		const results = await engine.searchFiles({
			queryText: "note about restoring cache after warmup failed",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("pkm-en/projects/sdk/cache-restore-checklist.md");
	});

	// File-lookup guardrails: identity-heavy matches should still win when the
	// user intent is effectively to find a specific note or path-like target.
	test("prefers basename-heavy file lookup evidence over richer body wording", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "pkm-en/projects/sdk/cache-restore-checklist.md",
				basename: "cache-restore-checklist.md",
				folder: "pkm-en/projects/sdk",
				headings: "Warmup drill note",
				aliases: "cache restore checklist",
				content:
					"short note about restore checks after warmup and replay verification",
			},
			{
				path: "pkm-en/inbox/warmup-restore-notes.md",
				basename: "warmup-restore-notes.md",
				folder: "pkm-en/inbox",
				headings: "Cache restore checklist",
				content:
					"cache restore checklist after warmup with restore checklist reminders and many checklist references",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "cache restore checklist",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("pkm-en/projects/sdk/cache-restore-checklist.md");
	});

	test("prefers folder-first file lookup evidence ahead of richer body wording when total family coverage ties", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "pkm-en/projects/sdk/runbook.md",
				basename: "runbook.md",
				folder: "pkm-en/projects/sdk",
				headings: "Cache checklist",
				content: "brief cache note",
			},
			{
				path: "pkm-en/archive/cache-sdk-notes.md",
				basename: "cache-sdk-notes.md",
				folder: "pkm-en/archive",
				headings: "Project cache notes",
				content:
					"sdk project cache runbook walkthrough with detailed cache and sdk recovery notes",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "projects sdk runbook",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("pkm-en/projects/sdk/runbook.md");
	});

	test("builds native direct subitems with mixed-script row col anchors", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<
					Array<{
						path: string;
						nativeSubItemsReady?: boolean;
						directSubItems?: Array<{
							row: number;
							col: number;
							text: string;
							highlightRanges?: Array<{ start: number; end: number }>;
						}>;
					}>
				>;
				getDirectSubItems(
					queryText: string,
					path: string,
					maxSubItemCount: number,
				): Promise<Array<{
					row: number;
					col: number;
					text: string;
					highlightRanges?: Array<{ start: number; end: number }>;
				}> | null>;
			};
		};

		const content = [
			"alpha outline line",
			"\u7b2c\u4e8c\u884c mixed cache \u6062\u590d note bridge",
			"third trailing line",
		].join("\n");
		registerMockFileSnapshotStore([
			{
				path: "pkm-zh/mixed/cache-note.md",
				basename: "cache-note.md",
				folder: "pkm-zh/mixed",
				headings: "Cache note",
				content,
			},
		]);
		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "pkm-zh/mixed/cache-note.md",
				basename: "cache-note.md",
				folder: "pkm-zh/mixed",
				headings: "Cache note",
				content,
			},
		]);

		const results = await engine.searchFiles({
			queryText: "cache \u6062\u590d note",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 3,
			maxDirectSubItemResults: 3,
			maxSubItemResults: 6,
		});

		expect(results[0]?.nativeSubItemsReady).toBe(false);
		expect(results[0]?.directSubItems ?? []).toHaveLength(0);
		const directSubItems = await engine.getDirectSubItems(
			"cache \u6062\u590d note",
			"pkm-zh/mixed/cache-note.md",
			6,
		);
		expect(directSubItems?.length ?? 0).toBeGreaterThan(0);
		const firstSubItem = directSubItems?.[0];
		expect(firstSubItem?.row).toBe(1);
		expect(firstSubItem?.col).toBe("\u7b2c\u4e8c\u884c mixed ".length);
		expect(firstSubItem?.highlightRanges?.length ?? 0).toBeGreaterThan(0);
		expect(firstSubItem?.text.includes("cache")).toBe(true);
	});

	test("engine direct subitems read generation-aligned snapshot text before newer current text", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				getDirectSubItems(
					queryText: string,
					path: string,
					maxSubItemCount: number,
				): Promise<Array<{ text: string }> | null>;
			};
		};

		const indexedDocument = {
			path: "pkm-en/mixed/aligned-subitem.md",
			generation: 77,
			basename: "aligned-subitem.md",
			folder: "pkm-en/mixed",
			headings: "Aligned subitem",
			content: "persisted aligned snippet",
		};
		registerMockFileSnapshotStore([indexedDocument]);
		mockFileSnapshotCurrentTexts?.set(
			indexedDocument.path,
			"newer current text without the indexed phrase",
		);

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([indexedDocument]);

		const directSubItems = await engine.getDirectSubItems(
			"aligned snippet",
			indexedDocument.path,
			4,
		);
		expect(directSubItems?.[0]?.text).toContain("persisted aligned snippet");
	});

	test("engine direct subitems rank exact ahead of prefix ahead of fuzzy", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<
					Array<{
						nativeSubItemsReady?: boolean;
						directSubItems?: Array<{
							row: number;
							col: number;
							text: string;
							highlightRanges?: Array<{ start: number; end: number }>;
						}>;
					}>
				>;
				getDirectSubItems(
					queryText: string,
					path: string,
					maxSubItemCount: number,
				): Promise<
					Array<{
						row: number;
						col: number;
						text: string;
						highlightRanges?: Array<{ start: number; end: number }>;
					}> | null
				>;
			};
		};

		const documents = [
			{
				path: "pkm-en/mixed/subitem-order.md",
				basename: "subitem-order.md",
				folder: "pkm-en/mixed",
				headings: "Subitem order",
				content: [
					"plugins fast",
					"filler filler filler filler filler filler filler filler filler",
					"plugin fast",
					"filler filler filler filler filler filler filler filler filler",
					"plugons fast",
				].join("\n"),
			},
		];
		registerMockFileSnapshotStore(documents);
		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);

		const results = await engine.searchFiles({
			queryText: "plugins fast",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 3,
			maxDirectSubItemResults: 3,
			maxSubItemResults: 6,
		});

		expect(results[0]?.nativeSubItemsReady).toBe(false);
		const directSubItems = await engine.getDirectSubItems(
			"plugins fast",
			"pkm-en/mixed/subitem-order.md",
			6,
		);
		const topThree = directSubItems?.slice(0, 3) ?? [];
		expect(topThree).toHaveLength(3);
		expect(topThree.map((item) => item.row)).toEqual([0, 2, 4]);
		expect(topThree[0].text.toLowerCase()).toContain("plugins fast");
		expect(topThree[1].text.toLowerCase()).toContain("plugin fast");
		expect(topThree[2].text.toLowerCase()).toContain("plugons fast");
	});

	test("engine direct subitems recall Han single chars and contiguous symbol runs from source text", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<
					Array<{
						nativeSubItemsReady?: boolean;
						directSubItems?: Array<{
							text: string;
							highlightRanges?: Array<{ start: number; end: number }>;
						}>;
					}>
				>;
				getDirectSubItems(
					queryText: string,
					path: string,
					maxSubItemCount: number,
				): Promise<Array<{
					text: string;
					highlightRanges?: Array<{ start: number; end: number }>;
				}> | null>;
			};
		};

		const content = [
			"intro line",
			"\u8fd9\u91cc\u662f\u4e0a\u9762 foo/bar@v1.2#tag \u7684\u539f\u6587\u7247\u6bb5",
			"tail line",
		].join("\n");
		registerMockFileSnapshotStore([
			{
				path: "pkm-zh/mixed/symbol-run.md",
				basename: "symbol-run.md",
				folder: "pkm-zh/mixed",
				headings: "Symbol run",
				content,
			},
		]);
		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "pkm-zh/mixed/symbol-run.md",
				basename: "symbol-run.md",
				folder: "pkm-zh/mixed",
				headings: "Symbol run",
				content,
			},
		]);

		const results = await engine.searchFiles({
			queryText: "\u4e0a\u9762 foo/bar@v1.2#tag",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 3,
			maxDirectSubItemResults: 3,
			maxSubItemResults: 6,
		});

		expect(results[0]?.nativeSubItemsReady).toBe(false);
		const directSubItems = await engine.getDirectSubItems(
			"\u4e0a\u9762 foo/bar@v1.2#tag",
			"pkm-zh/mixed/symbol-run.md",
			6,
		);
		expect(directSubItems?.length ?? 0).toBeGreaterThan(0);
		const first = directSubItems?.[0];
		const firstText = first?.text ?? "";
		expect(first?.text).toContain("\u4e0a\u9762");
		expect(first?.text).toContain("foo/bar@v1.2#tag");
		const highlighted = (first?.highlightRanges ?? []).map((range) =>
			firstText.slice(range.start, range.end),
		);
		expect(highlighted.some((segment) => segment.includes("\u4e0a"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("\u9762"))).toBe(true);
		expect(
			highlighted.some((segment) => segment.includes("foo/bar@v1.2#tag")),
		).toBe(true);
	});

	test("stores the hottest postings buckets as doc id arrays", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		const internalEngine = engine as any;
		await engine.addDocuments([
			{
				path: "pkm-en/phase3/hot-postings.md",
				basename: "hot-postings.md",
				folder: "pkm-en/phase3",
				headings: "Hot postings",
				content: "cache restore cache replay",
				aliases: "hot postings",
				tags: "phase3,cache",
			},
		]);

		const docId = internalEngine.documents.get("pkm-en/phase3/hot-postings.md")?.docId;
		expect(typeof docId).toBe("number");
		expect(internalEngine.bodyPostings.get("cache") instanceof Uint32Array).toBe(true);
		expect(internalEngine.metadataAliasPostings.get("hot") instanceof Uint32Array).toBe(true);
		expect(internalEngine.metadataAliasPhrasePostings.get("hot postings")).toBeUndefined();
		expect(internalEngine.metadataBasenamePostings.get("hot-postings") instanceof Uint32Array).toBe(true);
		expect(internalEngine.metadataFolderPostings.get("phase3") instanceof Uint32Array).toBe(true);
		expect(internalEngine.metadataHeadingPostings.get("hot") instanceof Uint32Array).toBe(true);
		expect(internalEngine.metadataHeadingPhrasePostings.get("hot postings")).toBeUndefined();
		expect(internalEngine.metadataTagPostings.get("phase3") instanceof Uint32Array).toBe(true);
		expect(internalEngine.metadataTagFullPostings.get("phase3,cache") instanceof Uint32Array).toBe(true);
		expect(internalEngine.metadataTagPhrasePostings.get("phase3 cache")).toBeUndefined();
		expect(internalEngine.bodyPostings.get("cache")).toContain(docId);
		expect(internalEngine.metadataAliasPostings.get("hot")).toContain(docId);
		expect(internalEngine.metadataAliasPhrasePostings.get("hot postings")).toBeUndefined();
		expect(internalEngine.metadataBasenamePostings.get("hot-postings")).toContain(docId);
		expect(internalEngine.metadataFolderPostings.get("phase3")).toContain(docId);
		expect(internalEngine.metadataHeadingPostings.get("hot")).toContain(docId);
		expect(internalEngine.metadataHeadingPhrasePostings.get("hot postings")).toBeUndefined();
		expect(internalEngine.metadataTagPostings.get("phase3")).toContain(docId);
		expect(internalEngine.metadataTagFullPostings.get("phase3,cache")).toContain(docId);
		expect(internalEngine.metadataTagPhrasePostings.get("phase3 cache")).toBeUndefined();
		expect(internalEngine.documentPathById[docId]).toBe(
			"pkm-en/phase3/hot-postings.md",
		);
	});

	test("stores metadata char postings as doc id arrays and retains body Han segments", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		const internalEngine = engine as any;
		await engine.addDocuments([
			{
				path: "pkm-zh/\u9636\u6bb5\u4e09/\u7f13\u5b58\u6062\u590d.md",
				basename: "\u7f13\u5b58\u6062\u590d.md",
				folder: "pkm-zh/\u9636\u6bb5\u4e09",
				headings: "\u7f13\u5b58\u6062\u590d",
				content: "\u7f13\u5b58\u6062\u590d\u8bb0\u5f55",
				aliases: "\u6062\u590d\u8bb0\u5f55",
				tags: "\u6062\u590d \u6807\u7b7e",
			},
		]);

		const docId = internalEngine.documents.get(
			"pkm-zh/\u9636\u6bb5\u4e09/\u7f13\u5b58\u6062\u590d.md",
		)?.docId;
		expect(typeof docId).toBe("number");
		expect(
			internalEngine.documentBodyHanSegmentsById[docId],
		).toEqual(["\u7f13\u5b58\u6062\u590d\u8bb0\u5f55"]);
		expect(
			Array.isArray(
				internalEngine.metadataAliasCharPostings.get("\u6062\u590d"),
			),
		).toBe(true);
		expect(
			Array.isArray(
				internalEngine.metadataBasenameCharPostings.get("\u7f13\u5b58"),
			),
		).toBe(true);
		expect(
			Array.isArray(
				internalEngine.metadataFolderCharPostings.get("\u9636\u6bb5"),
			),
		).toBe(true);
		expect(
			internalEngine.metadataHeadingCharPostings.get("\u7f13\u5b58"),
		).toBeUndefined();
		expect(
			Array.isArray(internalEngine.metadataTagCharPostings.get("\u6807\u7b7e")),
		).toBe(true);
		expect(internalEngine.documentBodyHanSegmentsById[docId]?.length ?? 0).toBe(1);
		expect(
			internalEngine.metadataAliasCharPostings.get("\u6062\u590d"),
		).toContain(docId);
		expect(
			internalEngine.metadataBasenameCharPostings.get("\u7f13\u5b58"),
		).toContain(docId);
		expect(
			internalEngine.metadataFolderCharPostings.get("\u9636\u6bb5"),
		).toContain(docId);
		expect(
			internalEngine.metadataHeadingCharPostings.get("\u7f13\u5b58"),
		).toBeUndefined();
		expect(internalEngine.metadataTagCharPostings.get("\u6807\u7b7e")).toContain(
			docId,
		);
	});

	test("preserves stable doc ids across reindex and advances ids after true delete", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				deleteDocuments(paths: string[]): void;
				clearIndex(): void;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		const internalEngine = engine as any;
		await engine.addDocuments([
			{
				path: "pkm-en/phase3/stable-doc-id.md",
				basename: "stable-doc-id.md",
				folder: "pkm-en/phase3",
				headings: "Stable doc id",
				content: "first draft keeps the same logical document identity",
			},
		]);

		const originalDocId = internalEngine.documents.get(
			"pkm-en/phase3/stable-doc-id.md",
		)?.docId;
		expect(originalDocId).toBe(0);

		await engine.addDocuments([
			{
				path: "pkm-en/phase3/stable-doc-id.md",
				basename: "stable-doc-id.md",
				folder: "pkm-en/phase3",
				headings: "Stable doc id updated",
				content: "second draft still belongs to the same logical document",
			},
		]);

		expect(
			internalEngine.documents.get("pkm-en/phase3/stable-doc-id.md")?.docId,
		).toBe(originalDocId);

		engine.deleteDocuments(["pkm-en/phase3/stable-doc-id.md"]);
		expect(
			internalEngine.documentIdByPath.has("pkm-en/phase3/stable-doc-id.md"),
		).toBe(false);

		await engine.addDocuments([
			{
				path: "pkm-en/phase3/new-logical-document.md",
				basename: "new-logical-document.md",
				folder: "pkm-en/phase3",
				headings: "Fresh logical document",
				content: "new ownership should consume a fresh doc id after delete",
			},
		]);

		expect(
			internalEngine.documents.get("pkm-en/phase3/new-logical-document.md")
				?.docId,
		).toBe(originalDocId + 1);

		engine.clearIndex();
		await engine.addDocuments([
			{
				path: "pkm-en/phase3/after-clear.md",
				basename: "after-clear.md",
				folder: "pkm-en/phase3",
				headings: "After clear",
				content: "clear index should reset doc id ownership from zero",
			},
		]);

		expect(internalEngine.documents.get("pkm-en/phase3/after-clear.md")?.docId).toBe(
			0,
		);
	});

	test("reports document identity bytes in the index breakdown", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				getIndexBreakdown(): Record<string, any> | null;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "pkm-en/phase3/index-breakdown.md",
				basename: "index-breakdown.md",
				folder: "pkm-en/phase3",
				headings: "Index breakdown",
				content: "document identity bytes should be visible in the estimate",
			},
		]);

		const breakdown = engine.getIndexBreakdown();
		expect(breakdown?.documentIdentityCount).toBe(1);
		expect(breakdown?.nextDocumentId).toBe(1);
		expect(
			((breakdown?.estimatedBytes as Record<string, any>)?.documentIdentity as Record<
				string,
				any
			>)?.total,
		).toBeGreaterThan(0);
	});
});

