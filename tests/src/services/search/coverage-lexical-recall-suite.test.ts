import { container } from "tsyringe";
import { buildCoverageLexicalStructuredMetadataSignatures, buildCoverageLexicalPhraseSignatures } from "src/services/search/coverage-lexical/coverage-lexical-bridge";
import { buildCoverageLexicalPlan } from "src/services/search/coverage-lexical/coverage-lexical-planner";
import {
	collectCoverageLexicalCandidateStatesByDocId,
	collectCoverageLexicalCandidateStatesWithDebug,
} from "src/services/search/coverage-lexical/coverage-lexical-recall";

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
		tokenizeSequence(text: string, _mode?: "index" | "search"): string[] {
			return tokenizeSegment(text);
		},
	};
}

describe("coverage lexical recall suite", () => {
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

	test("canonical title/path queries enter union through targeted lanes", async () => {
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
				path: "pkm-en/guides/shard-checkpoint-guide.md",
				basename: "shard-checkpoint-guide.md",
				folder: "pkm-en/guides",
				headings: "Shard checkpoint guide",
				content: "shard checkpoint restore notes explain warm cache recovery and replay order",
				aliases: "checkpoint restore guide;checkpoint guide",
				tags: "guide restore",
			},
			{
				path: "pkm-en/projects/sdk/vector-cache.md",
				basename: "vector-cache.md",
				folder: "pkm-en/projects/sdk",
				headings: "Vector cache playbook",
				content: "vector cache eviction keeps sdk search warm after shard checkpoint restore",
				aliases: "sdk cache restore;vector cache restore note",
				tags: "sdk cache",
			},
			{
				path: "docs/plugins/better-plugins-page.md",
				basename: "better-plugins-page.md",
				folder: "docs/plugins",
				headings: "better plugins page",
				content: "directory landing page for plugin browsing without the answer paragraph users actually want",
			},
			{
				path: "docs/plugins/better-plugins-roadmap.md",
				basename: "better-plugins-roadmap.md",
				folder: "docs/plugins",
				headings: "better plugins roadmap",
				content: "roadmap page for better plugins workstreams, milestones, and backlog notes",
			},
			{
				path: "tech-en/content/en/docs/concepts/configuration/configmap.md",
				basename: "configmap.md",
				folder: "tech-en/content/en/docs/concepts/configuration",
				headings: "ConfigMap",
				content: "configmap pod data guidance explains how pods read mounted configuration data safely",
			},
			{
				path: "tech-en/content/en/docs/tasks/configure-pod-container/configure-service-account.md",
				basename: "configure-service-account.md",
				folder: "tech-en/content/en/docs/tasks/configure-pod-container",
				headings: "Configure service account",
				content: "service account token setup explains how pods mount projected credentials for runtime access",
			},
		];

		const queryCases = [
			{
				type: "title_exact",
				queryText: "guide for replay order after restore",
				relevantPath: "pkm-en/guides/shard-checkpoint-guide.md",
				acceptableLanes: ["strict_metadata_lane"],
			},
			{
				type: "title_exact",
				queryText: "playbook for cache eviction restore",
				relevantPath: "pkm-en/projects/sdk/vector-cache.md",
				acceptableLanes: ["strict_metadata_lane"],
			},
			{
				type: "title_prefix",
				queryText: "shard checkpoint",
				relevantPath: "pkm-en/guides/shard-checkpoint-guide.md",
				acceptableLanes: ["strict_metadata_lane"],
			},
			{
				type: "title_prefix",
				queryText: "vector cache",
				relevantPath: "pkm-en/projects/sdk/vector-cache.md",
				acceptableLanes: ["strict_metadata_lane"],
			},
			{
				type: "prefix_metadata",
				queryText: "better plu",
				relevantPath: "docs/plugins/better-plugins-page.md",
				acceptableLanes: ["strict_metadata_lane"],
			},
			{
				type: "prefix_metadata",
				queryText: "better plugin road",
				relevantPath: "docs/plugins/better-plugins-roadmap.md",
				acceptableLanes: ["strict_metadata_lane"],
			},
			{
				type: "body_path_anchor",
				queryText: "tech-en service account token",
				relevantPath:
					"tech-en/content/en/docs/tasks/configure-pod-container/configure-service-account.md",
				acceptableLanes: ["strict_hybrid_lane"],
			},
			{
				type: "body_path_anchor",
				queryText: "tech-en configmap pod data",
				relevantPath: "tech-en/content/en/docs/concepts/configuration/configmap.md",
				acceptableLanes: ["strict_hybrid_lane"],
			},
			{
				type: "body_title_anchor",
				queryText: "mounted configuration data for pods",
				relevantPath: "tech-en/content/en/docs/concepts/configuration/configmap.md",
				acceptableLanes: ["strict_hybrid_lane"],
			},
			{
				type: "body_title_anchor",
				queryText: "configure service account runtime access",
				relevantPath:
					"tech-en/content/en/docs/tasks/configure-pod-container/configure-service-account.md",
				acceptableLanes: ["strict_hybrid_lane"],
			},
			{
				type: "basename_partial_body",
				queryText: "vector cache restore",
				relevantPath: "pkm-en/projects/sdk/vector-cache.md",
				acceptableLanes: [
					"strict_hybrid_lane",
					"bridge_lane",
				],
			},
			{
				type: "path_partial_body",
				queryText: "sdk cache restore",
				relevantPath: "pkm-en/projects/sdk/vector-cache.md",
				acceptableLanes: [
					"strict_hybrid_lane",
					"bridge_lane",
				],
			},
		] as const;

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);
		const engineAny = engine as any;
		const tokenizer = createMockTokenizer();
		const rankingDiagnostics: Array<{
			queryText: string;
			relevantPath: string;
			finalRank: number;
			top5: string[];
		}> = [];
		for (const queryCase of queryCases) {
			const queryTerms = tokenizer
				.tokenizeSequence(queryCase.queryText, "search")
				.map((term) => term.toLowerCase());
			const probes = engineAny.buildFamilyProbes(queryTerms);
			const plan = buildCoverageLexicalPlan(queryCase.queryText, queryTerms, probes);
			const phraseSignatures = [
				...buildCoverageLexicalPhraseSignatures(plan.families),
				...buildCoverageLexicalStructuredMetadataSignatures(
					queryCase.queryText,
					plan.families,
				),
			];
			const { candidates, debug } = collectCoverageLexicalCandidateStatesWithDebug(
				{
					bodyPostings: engineAny.bodyPostings,
					bodyCharPostings: engineAny.bodyCharPostings,
					bodyHanSegmentPostings: engineAny.bodyHanSegmentPostings,
					metadataAliasCharPostings: engineAny.metadataAliasCharPostings,
					metadataAliasHanSegmentPostings: engineAny.metadataAliasHanSegmentPostings,
					metadataAliasPhrasePostings: engineAny.metadataAliasPhrasePostings,
					metadataAliasPostings: engineAny.metadataAliasPostings,
					metadataBasenameCharPostings: engineAny.metadataBasenameCharPostings,
					metadataBasenameHanSegmentPostings: engineAny.metadataBasenameHanSegmentPostings,
					metadataBasenamePhrasePostings: engineAny.metadataBasenamePhrasePostings,
					metadataBasenamePostings: engineAny.metadataBasenamePostings,
					metadataFolderCharPostings: engineAny.metadataFolderCharPostings,
					metadataFolderHanSegmentPostings: engineAny.metadataFolderHanSegmentPostings,
					metadataFolderPhrasePostings: engineAny.metadataFolderPhrasePostings,
					metadataFolderPostings: engineAny.metadataFolderPostings,
					metadataHeadingHanSegmentPostings: engineAny.metadataHeadingHanSegmentPostings,
					metadataHeadingPhrasePostings: engineAny.metadataHeadingPhrasePostings,
					metadataHeadingPostings: engineAny.metadataHeadingPostings,
					metadataPhrasePostings: engineAny.metadataPhrasePostings,
					metadataTagCharPostings: engineAny.metadataTagCharPostings,
					metadataTagFullPostings: engineAny.metadataTagFullPostings,
					metadataTagPhrasePostings: engineAny.metadataTagPhrasePostings,
					metadataTagPostings: engineAny.metadataTagPostings,
					sortedLexicon: engineAny.sortedLexicon,
					documentIdByPath: engineAny.documentIdByPath,
					documentPathById: engineAny.documentPathById,
					getDocumentBodyTokens: (docId: number) =>
					engineAny.getDocumentBodyTokens(docId) ?? [],
					documentBodyHanSegmentsById: engineAny.documentBodyHanSegmentsById,
					documentTagValuesById: engineAny.documentTagValuesById,
				},
				plan,
				phraseSignatures,
				{
					queryText: queryCase.queryText,
					isPrefixMatch: true,
					isFuzzy: true,
					maxItemResults: 10,
				},
			);
			expect(candidates.has(queryCase.relevantPath)).toBe(true);
			const matchedAcceptableLane = debug.lanes.some(
				(lane) =>
					queryCase.acceptableLanes.some(
						(acceptableLane) => acceptableLane === lane.laneName,
					) &&
					lane.admittedPaths.includes(queryCase.relevantPath),
				);
			expect(matchedAcceptableLane).toBe(true);
			const ranked = await engine.searchFiles({
				queryText: queryCase.queryText,
				isPrefixMatch: true,
				isFuzzy: true,
				maxItemResults: 5,
			});
			const finalRank =
				ranked.findIndex((result) => result.path === queryCase.relevantPath) + 1;
			expect(finalRank).toBeGreaterThan(0);
			expect(finalRank).toBeLessThanOrEqual(5);
			if (finalRank > 1) {
				rankingDiagnostics.push({
					queryText: queryCase.queryText,
					relevantPath: queryCase.relevantPath,
					finalRank,
					top5: ranked.map((result) => result.path),
				});
			}
		}
		console.log(
			"[coverage-lexical-recall-suite] ranking-diagnostics",
			JSON.stringify(rankingDiagnostics, null, 2),
		);
	});

	test("body phrase witness still fires via token tape", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
			};
		};

		const documents: IndexedDocument[] = [
			{
				path: "adversarial/ranker-lab/en/exact-quality-witness.md",
				basename: "exact-quality-witness.md",
				folder: "adversarial/ranker-lab/en",
				headings: "Exact quality witness",
				content:
					"config data rollout keeps exact family evidence together in one compact note",
			},
			{
				path: "adversarial/ranker-lab/en/exact-quality-loose.md",
				basename: "exact-quality-loose.md",
				folder: "adversarial/ranker-lab/en",
				headings: "Exact quality loose",
				content:
					"config guidance and data handoff happen before the rollout review in a broader note",
			},
		];

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);
		const engineAny = engine as any;
		const tokenizer = createMockTokenizer();
		const queryText = "config data rollout";
		const queryTerms = tokenizer
			.tokenizeSequence(queryText, "search")
			.map((term) => term.toLowerCase());
		const probes = engineAny.buildFamilyProbes(queryTerms);
		const plan = buildCoverageLexicalPlan(queryText, queryTerms, probes);
		const phraseSignatures = [
			...buildCoverageLexicalPhraseSignatures(plan.families),
			...buildCoverageLexicalStructuredMetadataSignatures(
				queryText,
				plan.families,
			),
		];

		const candidates = collectCoverageLexicalCandidateStatesByDocId(
			{
				bodyPostings: engineAny.bodyPostings,
				bodyCharPostings: engineAny.bodyCharPostings,
				bodyHanSegmentPostings: engineAny.bodyHanSegmentPostings,
				metadataAliasCharPostings: engineAny.metadataAliasCharPostings,
				metadataAliasHanSegmentPostings: engineAny.metadataAliasHanSegmentPostings,
				metadataAliasPhrasePostings: engineAny.metadataAliasPhrasePostings,
				metadataAliasPostings: engineAny.metadataAliasPostings,
				metadataBasenameCharPostings: engineAny.metadataBasenameCharPostings,
				metadataBasenameHanSegmentPostings: engineAny.metadataBasenameHanSegmentPostings,
				metadataBasenamePhrasePostings: engineAny.metadataBasenamePhrasePostings,
				metadataBasenamePostings: engineAny.metadataBasenamePostings,
				metadataFolderCharPostings: engineAny.metadataFolderCharPostings,
				metadataFolderHanSegmentPostings: engineAny.metadataFolderHanSegmentPostings,
				metadataFolderPhrasePostings: engineAny.metadataFolderPhrasePostings,
				metadataFolderPostings: engineAny.metadataFolderPostings,
				metadataHeadingHanSegmentPostings: engineAny.metadataHeadingHanSegmentPostings,
				metadataHeadingPhrasePostings: engineAny.metadataHeadingPhrasePostings,
				metadataHeadingPostings: engineAny.metadataHeadingPostings,
				metadataPhrasePostings: engineAny.metadataPhrasePostings,
				metadataTagCharPostings: engineAny.metadataTagCharPostings,
				metadataTagFullPostings: engineAny.metadataTagFullPostings,
				metadataTagPhrasePostings: engineAny.metadataTagPhrasePostings,
				metadataTagPostings: engineAny.metadataTagPostings,
				sortedLexicon: engineAny.sortedLexicon,
				documentIdByPath: engineAny.documentIdByPath,
				documentPathById: engineAny.documentPathById,
				getDocumentBodyTokens: (docId: number) =>
					engineAny.getDocumentBodyTokens(docId) ?? [],
					documentBodyHanSegmentsById: engineAny.documentBodyHanSegmentsById,
					documentTagValuesById: engineAny.documentTagValuesById,
			},
			plan,
			phraseSignatures,
			{
				queryText,
				isPrefixMatch: true,
				isFuzzy: true,
				maxItemResults: 5,
			},
		);

		const witnessDocId = engineAny.documentIdByPath.get(
			"adversarial/ranker-lab/en/exact-quality-witness.md",
		);
		expect(witnessDocId).toBeDefined();
		const witnessState = candidates.get(witnessDocId);
		expect(witnessState?.phraseMatches.length).toBeGreaterThan(0);
	});

	test("metadata prefix stays available for three-character ASCII prefixes", async () => {
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
				path: "notes/zephyr-cache.md",
				basename: "zephyr-cache.md",
				folder: "notes",
				headings: "Zephyr cache",
				aliases: "zephyr cache note",
				content: "cache tuning notes for zephyr services",
			},
			{
				path: "notes/alpha-note.md",
				basename: "alpha-note.md",
				folder: "notes",
				headings: "Alpha note",
				content: "ordinary note without the target prefix",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "notes/zep",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});
		expect(results[0]?.path).toBe("notes/zephyr-cache.md");
	});

	test("body prefix stays disabled for three-character ASCII body queries", async () => {
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
				path: "notes/secret-guide.md",
				basename: "secret-guide.md",
				folder: "notes",
				content: "password rotation policy lives only in body content",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "pas",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});
		expect(results).toHaveLength(0);
	});

	test("three-character ASCII queries can surface basename metadata through assist prefix recall", async () => {
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
				path: "notes/password-guide.md",
				basename: "password-guide.md",
				folder: "notes",
				content: "credential rotation checklist without the target token in body",
			},
			{
				path: "notes/passing-thought.md",
				basename: "passing-thought.md",
				folder: "notes",
				content: "a distracting note that should lose to the basename completion",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "pas",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});
		expect(results[0]?.path).toBe("notes/password-guide.md");
	});

	test("ranked body prefix expansion can keep a useful longer completion under tight budgets", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
			};
		};

		const distractors: IndexedDocument[] = Array.from({ length: 16 }, (_, index) => ({
			path: `noise/pass-${index}.md`,
			basename: `noise-${index}.md`,
			folder: "noise",
			content: `pass${String(index).padStart(3, "0")} marker only`,
		}));
		const targetPath = "notes/password-target.md";
		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			...distractors,
			{
				path: targetPath,
				basename: "password-target.md",
				folder: "notes",
				content: "password rotation handbook",
			},
		]);

		const engineAny = engine as any;
		const tokenizer = createMockTokenizer();
		const queryText = "pass";
		const queryTerms = tokenizer
			.tokenizeSequence(queryText, "search")
			.map((term) => term.toLowerCase());
		const probes = engineAny.buildFamilyProbes(queryTerms);
		const plan = buildCoverageLexicalPlan(queryText, queryTerms, probes);
		const phraseSignatures = [
			...buildCoverageLexicalPhraseSignatures(plan.families),
			...buildCoverageLexicalStructuredMetadataSignatures(
				queryText,
				plan.families,
			),
		];

		const candidates = collectCoverageLexicalCandidateStatesByDocId(
			{
				bodyPostings: engineAny.bodyPostings,
				bodyCharPostings: engineAny.bodyCharPostings,
				bodyHanSegmentPostings: engineAny.bodyHanSegmentPostings,
				metadataAliasCharPostings: engineAny.metadataAliasCharPostings,
				metadataAliasHanSegmentPostings: engineAny.metadataAliasHanSegmentPostings,
				metadataAliasPhrasePostings: engineAny.metadataAliasPhrasePostings,
				metadataAliasPostings: engineAny.metadataAliasPostings,
				metadataBasenameCharPostings: engineAny.metadataBasenameCharPostings,
				metadataBasenameHanSegmentPostings: engineAny.metadataBasenameHanSegmentPostings,
				metadataBasenamePhrasePostings: engineAny.metadataBasenamePhrasePostings,
				metadataBasenamePostings: engineAny.metadataBasenamePostings,
				metadataFolderCharPostings: engineAny.metadataFolderCharPostings,
				metadataFolderHanSegmentPostings: engineAny.metadataFolderHanSegmentPostings,
				metadataFolderPhrasePostings: engineAny.metadataFolderPhrasePostings,
				metadataFolderPostings: engineAny.metadataFolderPostings,
				metadataHeadingHanSegmentPostings: engineAny.metadataHeadingHanSegmentPostings,
				metadataHeadingPhrasePostings: engineAny.metadataHeadingPhrasePostings,
				metadataHeadingPostings: engineAny.metadataHeadingPostings,
				metadataPhrasePostings: engineAny.metadataPhrasePostings,
				metadataTagCharPostings: engineAny.metadataTagCharPostings,
				metadataTagFullPostings: engineAny.metadataTagFullPostings,
				metadataTagPhrasePostings: engineAny.metadataTagPhrasePostings,
				metadataTagPostings: engineAny.metadataTagPostings,
				sortedLexicon: engineAny.sortedLexicon,
				documentIdByPath: engineAny.documentIdByPath,
				documentPathById: engineAny.documentPathById,
				getDocumentBodyTokens: (docId: number) =>
					engineAny.getDocumentBodyTokens(docId) ?? [],
				documentBodyHanSegmentsById: engineAny.documentBodyHanSegmentsById,
				documentTagValuesById: engineAny.documentTagValuesById,
			},
			plan,
			phraseSignatures,
			{
				queryText,
				isPrefixMatch: true,
				isFuzzy: false,
				maxItemResults: 5,
			},
		);

		const targetDocId = engineAny.documentIdByPath.get(targetPath);
		expect(targetDocId).toBeDefined();
		expect(candidates.has(targetDocId)).toBe(true);
		expect(candidates.size).toBeLessThanOrEqual(6);
	});

});
