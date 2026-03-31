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
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

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

function createComparatorPlan(
	route: CoverageLexicalPlan["route"] = "body-with-anchor",
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
			spans: [],
			familyReasons: [],
			queryKindReasons: [],
		},
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

function createFamilySignal(
	overrides: Partial<CoverageLexicalFamilySignal> & {
		familyCountSummary?: Partial<CoverageLexicalFamilyCountSummary>;
	} = {},
): CoverageLexicalFamilySignal {
	const { familyCountSummary, ...restOverrides } = overrides;
	return {
		familyCountSummary: createFamilyCountSummary(familyCountSummary ?? {}),
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
	};
}

describe("coverage lexical ranking", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
		container.registerInstance(Tokenizer, createMockTokenizer());
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("metadata-first routes prefer metadata distribution before ordinary body detail", () => {
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

		expect(compareSignals(left, right, plan)).toBeLessThan(0);
	});

	test("body-with-anchor routes let dominant body witness beat broad metadata pressure", () => {
		const plan = createComparatorPlan("body-with-anchor");
		const left = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 3,
				metadataMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 3,
				folderMatchedFamilyCount: 1,
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
				metadataMatchedFamilyCount: 3,
				bodyMatchedFamilyCount: 1,
				folderMatchedFamilyCount: 1,
				headingsMatchedFamilyCount: 1,
				tagsMatchedFamilyCount: 1,
			},
			coreBody: {
				coverageCount: 1,
				exactWeight: 5,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
		});

		expect(compareSignals(left, right, plan)).toBeLessThan(0);
	});

	test("metadata-first routes do not let body witness outrank strong basename and alias evidence", () => {
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

		expect(compareSignals(left, right, plan)).toBeGreaterThan(0);
	});

	test("body-first routes keep body count ahead of metadata distribution after total-count ties", () => {
		const plan = createComparatorPlan("body-first");
		const left = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 3,
				metadataMatchedFamilyCount: 2,
				basenameMatchedFamilyCount: 1,
				aliasesMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 1,
			},
		});
		const right = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 3,
				metadataMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 3,
			},
		});

		expect(compareSignals(left, right, plan)).toBeGreaterThan(0);
	});

	test("count-first comparator honors metadata field priority basename over aliases over folder over headings over tags", () => {
		const plan = createComparatorPlan("body-with-anchor");
		const basenameSignal = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 2,
				metadataMatchedFamilyCount: 1,
				basenameMatchedFamilyCount: 1,
			},
		});
		const aliasesSignal = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 2,
				metadataMatchedFamilyCount: 1,
				aliasesMatchedFamilyCount: 1,
			},
		});
		const folderSignal = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 2,
				metadataMatchedFamilyCount: 1,
				folderMatchedFamilyCount: 1,
			},
		});
		const headingsSignal = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 2,
				metadataMatchedFamilyCount: 1,
				headingsMatchedFamilyCount: 1,
			},
		});
		const tagsSignal = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 2,
				metadataMatchedFamilyCount: 1,
				tagsMatchedFamilyCount: 1,
			},
		});

		expect(
			compareSignals(basenameSignal, aliasesSignal, plan),
		).toBeLessThan(0);
		expect(
			compareSignals(aliasesSignal, folderSignal, plan),
		).toBeLessThan(0);
		expect(
			compareSignals(folderSignal, headingsSignal, plan),
		).toBeLessThan(0);
		expect(
			compareSignals(headingsSignal, tagsSignal, plan),
		).toBeLessThan(0);
	});

	test("body matched family count breaks ties only after metadata counts are exhausted", () => {
		const plan = createComparatorPlan("body-first");
		const left = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 3,
				metadataMatchedFamilyCount: 1,
				basenameMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 2,
			},
		});
		const right = createFamilySignal({
			familyCountSummary: {
				totalMatchedFamilyCount: 3,
				metadataMatchedFamilyCount: 1,
				basenameMatchedFamilyCount: 1,
				bodyMatchedFamilyCount: 1,
			},
			coreBody: {
				coverageCount: 1,
				exactWeight: 50,
				prefixWeight: 0,
				fuzzyWeight: 0,
			},
		});

		expect(compareSignals(left, right, plan)).toBeLessThan(0);
	});

	test("detail signals only resolve ties after count summary is equal", () => {
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
				): Array<{
					row: number;
					col: number;
					text: string;
					highlightRanges?: Array<{ start: number; end: number }>;
				}> | null;
			};
		};

		const content = [
			"alpha outline line",
			"第二行 mixed cache 恢复 note bridge",
			"third trailing line",
		].join("\n");
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
			queryText: "cache 恢复 note",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 3,
			maxDirectSubItemResults: 3,
			maxSubItemResults: 6,
		});

		expect(results[0]?.nativeSubItemsReady).toBe(false);
		expect(results[0]?.directSubItems ?? []).toHaveLength(0);
		const directSubItems = engine.getDirectSubItems(
			"cache 恢复 note",
			"pkm-zh/mixed/cache-note.md",
			6,
		);
		expect(directSubItems?.length ?? 0).toBeGreaterThan(0);
		const firstSubItem = directSubItems?.[0];
		expect(firstSubItem?.row).toBe(1);
		expect(firstSubItem?.col).toBe("第二行 mixed ".length);
		expect(firstSubItem?.highlightRanges?.length ?? 0).toBeGreaterThan(0);
		expect(firstSubItem?.text.includes("cache")).toBe(true);
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
						directSubItems?: Array<{ text: string }>;
					}>
				>;
				getDirectSubItems(
					queryText: string,
					path: string,
					maxSubItemCount: number,
				): Array<{ text: string }> | null;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
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
		]);

		const results = await engine.searchFiles({
			queryText: "plugins fast",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 3,
			maxDirectSubItemResults: 3,
			maxSubItemResults: 6,
		});

		expect(results[0]?.nativeSubItemsReady).toBe(false);
		const directSubItems = engine.getDirectSubItems(
			"plugins fast",
			"pkm-en/mixed/subitem-order.md",
			6,
		);
		expect(
			directSubItems
				?.slice(0, 3)
				.map((item) => item.text.toLowerCase().replace(/…/g, "")),
		).toEqual(["plugins fast", "plugin fast", "plugons fast"]);
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
				): Array<{
					text: string;
					highlightRanges?: Array<{ start: number; end: number }>;
				}> | null;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "pkm-zh/mixed/symbol-run.md",
				basename: "symbol-run.md",
				folder: "pkm-zh/mixed",
				headings: "Symbol run",
				content: [
					"引言。",
					"这里是上面 foo/bar@v1.2#tag 的真实原文片段。",
					"尾声。",
				].join("\n"),
			},
		]);

		const results = await engine.searchFiles({
			queryText: "上面 foo/bar@v1.2#tag",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 3,
			maxDirectSubItemResults: 3,
			maxSubItemResults: 6,
		});

		expect(results[0]?.nativeSubItemsReady).toBe(false);
		const directSubItems = engine.getDirectSubItems(
			"上面 foo/bar@v1.2#tag",
			"pkm-zh/mixed/symbol-run.md",
			6,
		);
		expect(directSubItems?.length ?? 0).toBeGreaterThan(0);
		const first = directSubItems?.[0];
		expect(first?.text).toContain("上面");
		expect(first?.text).toContain("foo/bar@v1.2#tag");
		const highlighted = (first?.highlightRanges ?? []).map((range) =>
			first?.text.slice(range.start, range.end),
		);
		expect(highlighted.some((segment) => segment.includes("上"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("面"))).toBe(true);
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
		expect(Array.isArray(internalEngine.bodyPostings.get("cache"))).toBe(true);
		expect(Array.isArray(internalEngine.bodyPhrasePostings.get("cache restore"))).toBe(
			true,
		);
		expect(Array.isArray(internalEngine.metadataPostings.get("phase3"))).toBe(true);
		expect(internalEngine.bodyPostings.get("cache")).toContain(docId);
		expect(internalEngine.documentPathById[docId]).toBe(
			"pkm-en/phase3/hot-postings.md",
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
