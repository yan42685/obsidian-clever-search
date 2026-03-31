import { container } from "tsyringe";
import { buildCoverageLexicalStructuredMetadataSignatures, buildCoverageLexicalPhraseSignatures } from "src/services/search/coverage-lexical/coverage-lexical-bridge";
import { buildCoverageLexicalPlan } from "src/services/search/coverage-lexical/coverage-lexical-planner";
import { collectCoverageLexicalCandidateStatesWithDebug } from "src/services/search/coverage-lexical/coverage-lexical-recall";

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
					metadataHeadingCharPostings: engineAny.metadataHeadingCharPostings,
					metadataHeadingHanSegmentPostings: engineAny.metadataHeadingHanSegmentPostings,
					metadataHeadingPhrasePostings: engineAny.metadataHeadingPhrasePostings,
					metadataHeadingPostings: engineAny.metadataHeadingPostings,
					metadataPostings: engineAny.metadataPostings,
					bodyPhrasePostings: engineAny.bodyPhrasePostings,
					metadataPhrasePostings: engineAny.metadataPhrasePostings,
					metadataTagCharPostings: engineAny.metadataTagCharPostings,
					metadataTagFullPostings: engineAny.metadataTagFullPostings,
					metadataTagPhrasePostings: engineAny.metadataTagPhrasePostings,
					metadataTagPostings: engineAny.metadataTagPostings,
					sortedLexicon: engineAny.sortedLexicon,
					documentIdByPath: engineAny.documentIdByPath,
					documentPathById: engineAny.documentPathById,
					documentBodyTokensByPath: engineAny.documentBodyTokensByPath,
					documentTagValuesByPath: engineAny.documentTagValuesByPath,
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
					queryCase.acceptableLanes.includes(lane.laneName as (typeof queryCase.acceptableLanes)[number]) &&
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
});
