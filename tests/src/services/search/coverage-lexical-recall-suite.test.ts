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
	});

	// Candidate-survival guardrails: the goal here is to keep intuitively
	// relevant candidates alive through recall/union, not to freeze the exact
	// lane provenance as a permanent product requirement.
	test("candidate-survival compatibility keeps ambiguous anchored queries eligible for later body lanes", async () => {
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
				headings: "Alias migration note",
				aliases: "legacy project names note;old project alias note",
				content:
					"old project names and rename history live in this note about alias compatibility and redirect mapping",
				tags: "aliases migration note",
			},
			{
				path: "pkm-en/glossary/aliases.md",
				basename: "aliases.md",
				folder: "pkm-en/glossary",
				headings: "Aliases glossary",
				content:
					"glossary definition for aliases and alternate labels without the migration details",
				tags: "aliases glossary",
			},
			{
				path: "pkm-en/projects/renames.md",
				basename: "renames.md",
				folder: "pkm-en/projects",
				headings: "Rename ledger",
				content:
					"project rename ledger tracks previous names but does not describe alias note compatibility",
				tags: "rename history",
			},
		];

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);
		const engineAny = engine as any;
		const tokenizer = createMockTokenizer();
		const queryText = "aliases note for old project names";
		const queryTerms = tokenizer
			.tokenizeSequence(queryText, "search")
			.map((term) => term.toLowerCase());
		const probes = engineAny.buildFamilyProbes(queryTerms);
		const plan = buildCoverageLexicalPlan(queryText, queryTerms, probes);
		expect(plan.queryKind).not.toBe("body_only_local");
		expect(plan.route).not.toBe("body-first");
		const phraseSignatures = [
			...buildCoverageLexicalPhraseSignatures(plan.families),
			...buildCoverageLexicalStructuredMetadataSignatures(
				queryText,
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
				metadataBasenameHanSegmentPostings:
					engineAny.metadataBasenameHanSegmentPostings,
				metadataBasenamePhrasePostings: engineAny.metadataBasenamePhrasePostings,
				metadataBasenamePostings: engineAny.metadataBasenamePostings,
				metadataFolderCharPostings: engineAny.metadataFolderCharPostings,
				metadataFolderHanSegmentPostings: engineAny.metadataFolderHanSegmentPostings,
				metadataFolderPhrasePostings: engineAny.metadataFolderPhrasePostings,
				metadataFolderPostings: engineAny.metadataFolderPostings,
				metadataHeadingHanSegmentPostings:
					engineAny.metadataHeadingHanSegmentPostings,
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
		expect(candidates.has("pkm-en/notes/linking/aliases-deep-dive.md")).toBe(true);
		const rescuedByBodyLane = debug.lanes.some(
			(lane) =>
				(lane.laneName === "relaxed_hybrid_lane" ||
					lane.laneName === "local_body_lane") &&
				lane.admittedPaths.includes("pkm-en/notes/linking/aliases-deep-dive.md"),
		);
		expect(rescuedByBodyLane).toBe(true);
		const ranked = await engine.searchFiles({
			queryText,
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		expect(
			ranked.some(
				(result) =>
					result.path === "pkm-en/notes/linking/aliases-deep-dive.md",
			),
		).toBe(true);
	});

	// Candidate-survival and pruning behavior should remain testable even after
	// the final ranking worldview changes.
	test("candidate-survival compatibility trims weak admitted tail while keeping strong ambiguous candidate", async () => {
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

		const distractors: IndexedDocument[] = Array.from({ length: 48 }, (_, index) => ({
			path: `pkm-en/archive/alias-tail-${index + 1}.md`,
			basename: `alias-tail-${index + 1}.md`,
			folder: "pkm-en/archive",
			headings: `Alias tail ${index + 1}`,
			aliases: `legacy alias note ${index + 1};old alias archive ${index + 1}`,
			content:
				"archive note mentions aliases and old names without the project compatibility detail",
			tags: "aliases archive",
		}));
		const documents: IndexedDocument[] = [
			{
				path: "pkm-en/notes/linking/aliases-deep-dive.md",
				basename: "aliases-deep-dive.md",
				folder: "pkm-en/notes/linking",
				headings: "Alias migration note",
				aliases: "legacy alias note;old project alias note",
				content:
					"old project names and alias compatibility details live in this migration note with redirect mapping",
				tags: "aliases migration note",
			},
			...distractors,
		];

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);
		const engineAny = engine as any;
		const tokenizer = createMockTokenizer();
		const queryText = "legacy alias note for old project names";
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
		const { candidates } = collectCoverageLexicalCandidateStatesWithDebug(
			{
				bodyPostings: engineAny.bodyPostings,
				bodyCharPostings: engineAny.bodyCharPostings,
				bodyHanSegmentPostings: engineAny.bodyHanSegmentPostings,
				metadataAliasCharPostings: engineAny.metadataAliasCharPostings,
				metadataAliasHanSegmentPostings: engineAny.metadataAliasHanSegmentPostings,
				metadataAliasPhrasePostings: engineAny.metadataAliasPhrasePostings,
				metadataAliasPostings: engineAny.metadataAliasPostings,
				metadataBasenameCharPostings: engineAny.metadataBasenameCharPostings,
				metadataBasenameHanSegmentPostings:
					engineAny.metadataBasenameHanSegmentPostings,
				metadataBasenamePhrasePostings: engineAny.metadataBasenamePhrasePostings,
				metadataBasenamePostings: engineAny.metadataBasenamePostings,
				metadataFolderCharPostings: engineAny.metadataFolderCharPostings,
				metadataFolderHanSegmentPostings: engineAny.metadataFolderHanSegmentPostings,
				metadataFolderPhrasePostings: engineAny.metadataFolderPhrasePostings,
				metadataFolderPostings: engineAny.metadataFolderPostings,
				metadataHeadingHanSegmentPostings:
					engineAny.metadataHeadingHanSegmentPostings,
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
				maxItemResults: 3,
			},
		);
		expect(candidates.has("pkm-en/notes/linking/aliases-deep-dive.md")).toBe(true);
		expect(candidates.size).toBeLessThan(documents.length);
		const ranked = await engine.searchFiles({
			queryText,
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		expect(ranked[0]?.path).toBe("pkm-en/notes/linking/aliases-deep-dive.md");
	});

	test("candidate-survival compatibility keeps balanced mixed-script candidates through final union", async () => {
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
		const mixedPath = "pkm-mixed/runtime/projected-token-runtime-access.md";
		const englishDistractors: IndexedDocument[] = Array.from(
			{ length: 24 },
			(_, index) => ({
				path: `tech-en/archive/projected-token-tail-${index + 1}.md`,
				basename: `projected-token-tail-${index + 1}.md`,
				folder: "tech-en/archive",
				headings: `Projected token tail ${index + 1}`,
				aliases: `projected token access ${index + 1}`,
				content:
					"projected token projected token access guidance for service account credentials and rotation",
			}),
		);
		const chineseDistractors: IndexedDocument[] = Array.from(
			{ length: 24 },
			(_, index) => ({
				path: `pkm-zh/runtime/${runtimeAccess}-记录-${index + 1}.md`,
				basename: `${runtimeAccess}-记录-${index + 1}.md`,
				folder: "pkm-zh/runtime",
				headings: `${runtimeAccess}记录 ${index + 1}`,
				aliases: `${runtimeAccess} 访问记录 ${index + 1}`,
				content: `${runtimeAccess} ${runtimeAccess} 访问记录汇总，只讨论运行指标，不讨论 projected token 身份文件`,
			}),
		);
		const documents: IndexedDocument[] = [
			{
				path: mixedPath,
				basename: "projected-token-runtime-access.md",
				folder: "pkm-mixed/runtime",
				headings: `Projected token ${runtimeAccess}`,
				aliases: `${runtimeAccess} projected token access`,
				content: `projected token runtime access note explains ${runtimeAccess} constraints and token rotation`,
			},
			...englishDistractors,
			...chineseDistractors,
		];

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);
		const engineAny = engine as any;
		const tokenizer = createMockTokenizer();
		const queryText = `projected token ${runtimeAccess}`;
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
		const { candidates } = collectCoverageLexicalCandidateStatesWithDebug(
			{
				bodyPostings: engineAny.bodyPostings,
				bodyCharPostings: engineAny.bodyCharPostings,
				bodyHanSegmentPostings: engineAny.bodyHanSegmentPostings,
				metadataAliasCharPostings: engineAny.metadataAliasCharPostings,
				metadataAliasHanSegmentPostings: engineAny.metadataAliasHanSegmentPostings,
				metadataAliasPhrasePostings: engineAny.metadataAliasPhrasePostings,
				metadataAliasPostings: engineAny.metadataAliasPostings,
				metadataBasenameCharPostings: engineAny.metadataBasenameCharPostings,
				metadataBasenameHanSegmentPostings:
					engineAny.metadataBasenameHanSegmentPostings,
				metadataBasenamePhrasePostings: engineAny.metadataBasenamePhrasePostings,
				metadataBasenamePostings: engineAny.metadataBasenamePostings,
				metadataFolderCharPostings: engineAny.metadataFolderCharPostings,
				metadataFolderHanSegmentPostings: engineAny.metadataFolderHanSegmentPostings,
				metadataFolderPhrasePostings: engineAny.metadataFolderPhrasePostings,
				metadataFolderPostings: engineAny.metadataFolderPostings,
				metadataHeadingHanSegmentPostings:
					engineAny.metadataHeadingHanSegmentPostings,
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
				maxItemResults: 3,
			},
		);
		expect(candidates.has(mixedPath)).toBe(true);
		expect(candidates.size).toBeLessThan(documents.length);

		const ranked = await engine.searchFiles({
			queryText,
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		expect(ranked[0]?.path).toBe(mixedPath);
	});

	test("bridge lane does not admit metadata-assist-only candidates without bridge connection", async () => {
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
				path: "pkm-en/projects/sdk/vector-cache.md",
				basename: "vector-cache.md",
				folder: "pkm-en/projects/sdk",
				headings: "Vector cache restore",
				content:
					"sdk cache restore checklist keeps the recovery steps together in one project note",
				tags: "sdk cache restore",
			},
			{
				path: "pkm-en/notes/ops-glossary.md",
				basename: "ops-glossary.md",
				folder: "pkm-en/notes",
				headings: "Cache glossary",
				aliases: "restore topic;cache topic",
				content:
					"glossary index for operational topics without the project recovery walkthrough",
				tags: "cache glossary",
			},
			...Array.from({ length: 28 }, (_, index) => ({
				path: `pkm-en/archive/cache-restore-tail-${index + 1}.md`,
				basename: `cache-restore-tail-${index + 1}.md`,
				folder: "pkm-en/archive",
				headings: `Cache restore archive ${index + 1}`,
				aliases: `cache restore archive ${index + 1}`,
				content:
					"archive note about cache topics that should not outrank the sdk recovery note",
				tags: "cache archive",
			})),
		];

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);
		const engineAny = engine as any;
		const tokenizer = createMockTokenizer();
		const queryText = "sdk cache restore";
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
				metadataBasenameHanSegmentPostings:
					engineAny.metadataBasenameHanSegmentPostings,
				metadataBasenamePhrasePostings: engineAny.metadataBasenamePhrasePostings,
				metadataBasenamePostings: engineAny.metadataBasenamePostings,
				metadataFolderCharPostings: engineAny.metadataFolderCharPostings,
				metadataFolderHanSegmentPostings: engineAny.metadataFolderHanSegmentPostings,
				metadataFolderPhrasePostings: engineAny.metadataFolderPhrasePostings,
				metadataFolderPostings: engineAny.metadataFolderPostings,
				metadataHeadingHanSegmentPostings:
					engineAny.metadataHeadingHanSegmentPostings,
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
				maxItemResults: 3,
			},
		);

		const bridgeLane = debug.lanes.find((lane) => lane.laneName === "bridge_lane");
		expect(bridgeLane?.admittedPaths).toContain(
			"pkm-en/projects/sdk/vector-cache.md",
		);
		expect(bridgeLane?.admittedPaths).not.toContain(
			"pkm-en/notes/ops-glossary.md",
		);
		expect(candidates.has("pkm-en/projects/sdk/vector-cache.md")).toBe(true);
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

	test("offloaded body phrase witness stays unresolved instead of silently weakening", async () => {
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
				getDocumentBodyTokens: () => undefined,
				allowPassageSignalInRecall: false,
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
		expect(witnessState?.unresolvedBodyEvidence.hasUnverifiedPhraseWitness).toBe(
			true,
		);
		expect(
			witnessState?.unresolvedBodyEvidence.unresolvedFamilyCount ?? 0,
		).toBeGreaterThan(0);
		expect(
			witnessState?.unresolvedBodyEvidence.unresolvedWeightUpperBound ?? 0,
		).toBeGreaterThan(0);
	});

	test("offloaded body prefix witness records unresolved surface evidence", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "docs/body-target.md",
				basename: "body-target.md",
				folder: "docs",
				headings: "Body target",
				content:
					"beta compatibility guidance lives in the body and should still be tracked as unresolved when tokens are cold",
			},
			{
				path: "docs/noise.md",
				basename: "noise.md",
				folder: "docs",
				headings: "Noise",
				content: "better plugin compatibility notes that should remain a distractor",
			},
		]);
		const engineAny = engine as any;
		const tokenizer = createMockTokenizer();
		const queryText = "beta comp";
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
				getDocumentBodyTokens: () => undefined,
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

		const targetDocId = engineAny.documentIdByPath.get("docs/body-target.md");
		expect(targetDocId).toBeDefined();
		const targetState = candidates.get(targetDocId);
		expect(targetState).toBeDefined();
		expect(targetState?.bodyPrefixWitness).not.toBeNull();
		expect(
			targetState?.unresolvedBodyEvidence.hasUnresolvedPrefixSurface,
		).toBe(true);
		expect(
			targetState?.unresolvedBodyEvidence.unresolvedWeightUpperBound ?? 0,
		).toBeGreaterThan(0);
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
