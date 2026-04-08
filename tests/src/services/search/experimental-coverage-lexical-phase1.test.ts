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

function registerMockFileSnapshotStore(
	documents: readonly IndexedDocument[] = [],
): {
	currentTexts: Map<string, string>;
	readCurrentTexts: jest.Mock;
} {
	const { FileSnapshotStore } = require(
		"src/services/search/shared/file-snapshot-store",
	) as {
		FileSnapshotStore: new () => unknown;
	};
	const currentTexts = new Map<string, string>();
	for (const document of documents) {
		currentTexts.set(document.path, document.content ?? "");
	}
	const readCurrentTexts = jest.fn(
		async (fileOrPaths: ReadonlyArray<string | { path: string }>) => {
			const result = new Map<string, string>();
			for (const fileOrPath of fileOrPaths) {
				const path =
					typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
				const text = currentTexts.get(path);
				if (text !== undefined) {
					result.set(path, text);
				}
			}
			return result;
		},
	);
	container.registerInstance(FileSnapshotStore, {
		readCurrentTexts,
	} as any);
	return { currentTexts, readCurrentTexts };
}

function normalize(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

function createEmptyExperimentalCandidateState() {
	return {
		bodyMatches: [],
		bodyCharMatchIndices: [],
		bodyCharMatchFlags: [],
		bodyPrefixWitness: null,
		metadataMatches: [],
		metadataAssistFieldMatches: {
			aliases: [],
			basename: [],
			folder: [],
			headings: [],
			tags: [],
		},
		metadataCharMatchIndices: [],
		metadataCharMatchFlags: [],
		metadataFieldMatches: {
			aliases: [],
			basename: [],
			folder: [],
			headings: [],
			tags: [],
		},
		metadataPrefixWitness: null,
		phraseMatches: [],
		phraseMatchFlags: [],
		unresolvedBodyPhraseMatchIndices: [],
		tagCharMatchIndices: [],
		tagCharMatchFlags: [],
		tagExactMatchIndices: [],
		tagExactMatchFlags: [],
		unresolvedBodyEvidence: {
			needsPassageSignal: false,
			hasUnverifiedPhraseWitness: false,
			hasUnresolvedPrefixSurface: false,
			hasUnresolvedBodyCharVerification: false,
			unresolvedFamilyCount: 0,
			unresolvedWeightUpperBound: 0,
		},
	};
}

function createEmptyExperimentalAreaSignal() {
	return {
		coverageCount: 0,
		exactWeight: 0,
		prefixWeight: 0,
		fuzzyWeight: 0,
	};
}

function createEmptyExperimentalCharSignal() {
	return {
		matchCount: 0,
		matchRatio: 0,
		exactSegmentCount: 0,
		fullSegmentCount: 0,
		bestSegmentCoverageCount: 0,
		bestSegmentCoverageRatio: 0,
	};
}

function createEmptyExperimentalWindowSignal() {
	return {
		exactWeight: 0,
		prefixWeight: 0,
		fuzzyWeight: 0,
		anchorCoverageCount: 0,
		softCoverageCount: 0,
		phraseMatchCount: 0,
		phraseMatchWeight: 0,
		compactnessScore: 0,
	};
}

function createExperimentalCoverageSignal(totalMatchedFamilyCount: number) {
	return {
		familyCountSummary: {
			totalMatchedFamilyCount,
			metadataMatchedFamilyCount: totalMatchedFamilyCount,
			bodyMatchedFamilyCount: 0,
			basenameMatchedFamilyCount: 0,
			aliasesMatchedFamilyCount: 0,
			folderMatchedFamilyCount: 0,
			headingsMatchedFamilyCount: 0,
			tagsMatchedFamilyCount: 0,
		},
		coreBody: createEmptyExperimentalAreaSignal(),
		softBody: createEmptyExperimentalAreaSignal(),
		metadataAnchor: createEmptyExperimentalAreaSignal(),
		metadataPrefixAssist: createEmptyExperimentalAreaSignal(),
		metadataIdentity: {
			phraseCoverageCount: 0,
			phraseWeight: 0,
			overall: createEmptyExperimentalAreaSignal(),
			alias: createEmptyExperimentalAreaSignal(),
			basename: createEmptyExperimentalAreaSignal(),
			heading: createEmptyExperimentalAreaSignal(),
			path: createEmptyExperimentalAreaSignal(),
			tag: createEmptyExperimentalAreaSignal(),
		},
		bodyPrefixWitness: null,
		metadataPrefixWitness: null,
		bodyChar: createEmptyExperimentalCharSignal(),
		metadataChar: createEmptyExperimentalCharSignal(),
		tagSignal: {
			exactMatchCount: 0,
			charMatchCount: 0,
			charMatchRatio: 0,
		},
		tailCoreWeight: 0,
		tailSoftWeight: 0,
		phraseBridgeCount: 0,
		phraseBridgeWeight: 0,
		localEvidence: {
			primary: createEmptyExperimentalWindowSignal(),
			support: createEmptyExperimentalWindowSignal(),
			supportWindowCount: 0,
			corroboratedCoreCoverageCount: 0,
			corroboratedExactCoreWeight: 0,
			corroboratedPrefixCoreWeight: 0,
			corroboratedFuzzyCoreWeight: 0,
			corroboratedAnchorCoverageCount: 0,
			corroboratedSoftCoverageCount: 0,
		},
		matchedTerms: [],
	};
}

function createEmptyExperimentalAdmissionSignal() {
	return {
		coreCoverageCount: 0,
		exactWeight: 0,
		prefixWeight: 0,
		fuzzyWeight: 0,
		anchorCoverageCount: 0,
		softCoverageCount: 0,
		phraseMatchCount: 0,
		phraseMatchWeight: 0,
		compactnessScore: 0,
	};
}

async function withExperimentalBodyTokenOffloadEnv<T>(
	enabled: boolean | undefined,
	action: () => Promise<T>,
): Promise<T> {
	const previous = process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
	if (enabled === undefined) {
		delete process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
	} else {
		process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD = enabled
			? "1"
			: "0";
	}
	try {
		return await action();
	} finally {
		if (previous === undefined) {
			delete process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
		} else {
			process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD = previous;
		}
	}
}

function createExperimentalTokenizer() {
	return {
		tokenize(text: string): string[] {
			return Array.from(new Set(this.tokenizeSequence(text)));
		},
		tokenizeSequence(text: string): string[] {
			const normalized = normalize(text).replace(/([a-z0-9])(?=[A-Z])/g, "$1 ");
			const matches =
				normalized.match(/[\p{Script=Han}]+|[a-z0-9]+(?:[-_][a-z0-9]+)*/gu) ?? [];
			const tokens: string[] = [];
			for (const match of matches) {
				tokens.push(match);
				if (/^[a-z0-9_-]+$/u.test(match) && match.length > 3) {
					for (const part of match.split(/[-_]/u)) {
						if (part.length > 1) {
							tokens.push(part);
						}
					}
				}
			}
			return tokens;
		},
		tokenizeSequenceWithOffsets(text: string): Array<{
			token: string;
			start: number;
			end: number;
		}> {
			const normalized = normalize(text).replace(/([a-z0-9])(?=[A-Z])/g, "$1 ");
			return Array.from(
				normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9]+(?:[-_][a-z0-9]+)*/gu),
			).map((match) => ({
				token: match[0],
				start: match.index ?? 0,
				end: (match.index ?? 0) + match[0].length,
			}));
		},
	};
}

describe("coverage lexical phase 1 memory experiments", () => {
	beforeEach(() => {
		process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD = "0";
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
		container.registerInstance(Tokenizer, createExperimentalTokenizer());
	});

	afterEach(() => {
		delete process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("verifies metadata phrase ranking without resident metadata phrase postings", async () => {
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
				reIndexAll(data: unknown): Promise<boolean>;
				serialize(): unknown;
				getIndexBreakdown(): Record<string, unknown> | null;
			};
		};
		const { buildCoverageLexicalPlan } = require(
			"src/services/search/coverage-lexical/coverage-lexical-planner",
		) as typeof import("src/services/search/coverage-lexical/coverage-lexical-planner");
		const {
			buildCoverageLexicalPhraseSignatures,
			buildCoverageLexicalStructuredMetadataSignatures,
		} = require(
			"src/services/search/coverage-lexical/coverage-lexical-bridge",
		) as typeof import("src/services/search/coverage-lexical/coverage-lexical-bridge");
		const { collectCoverageLexicalCandidateStatesByDocId } = require(
			"src/services/search/coverage-lexical/coverage-lexical-recall",
		) as typeof import("src/services/search/coverage-lexical/coverage-lexical-recall");

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/cache-restore.md",
				basename: "cache-restore",
				folder: "notes",
				content: "operational notes",
				headings: "cache restore",
			},
			{
				path: "notes/restore-cache.md",
				basename: "restore-cache",
				folder: "notes",
				content: "operational notes",
				headings: "restore cache",
			},
		]);

		const breakdown = engine.getIndexBreakdown();
		expect(breakdown?.metadataAliasPhraseTermCount).toBe(0);
		expect(breakdown?.metadataBasenamePhraseTermCount).toBe(0);
		expect(breakdown?.metadataFolderPhraseTermCount).toBe(0);
		expect(breakdown?.metadataHeadingPhraseTermCount).toBe(0);
		expect(breakdown?.metadataTagPhraseTermCount).toBe(0);
		expect(
			((breakdown?.estimatedBytes as Record<string, unknown>)?.postings as Record<
				string,
				unknown
			>)?.metadataAliasPhrase,
		).toBeUndefined();
		expect(
			((breakdown?.estimatedBytes as Record<string, unknown>)?.postings as Record<
				string,
				unknown
			>)?.metadataTagPhrase,
		).toBeUndefined();

		const request = {
			queryText: "cache restore",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		};
		const tokenizer = createExperimentalTokenizer();
		const queryTerms = tokenizer
			.tokenizeSequence(request.queryText)
			.map((term) => term.toLowerCase());
		const familyProbes = (engine as any).buildFamilyProbes(queryTerms);
		const plan = buildCoverageLexicalPlan(
			request.queryText,
			queryTerms,
			familyProbes,
		);
		const phraseSignatures = [
			...buildCoverageLexicalPhraseSignatures(plan.families),
			...buildCoverageLexicalStructuredMetadataSignatures(
				request.queryText,
				plan.families,
			),
		];
		const candidates = collectCoverageLexicalCandidateStatesByDocId(
			{
				bodyPostings: (engine as any).bodyPostings,
				documentBodyHanSegmentsById: (engine as any).documentBodyHanSegmentsById,
				metadataAliasCharPostings: (engine as any).metadataAliasCharPostings,
				metadataAliasPhrasePostings: (engine as any).metadataAliasPhrasePostings,
				metadataAliasPostings: (engine as any).metadataAliasPostings,
				metadataBasenameCharPostings: (engine as any).metadataBasenameCharPostings,
				metadataBasenamePhrasePostings: (engine as any).metadataBasenamePhrasePostings,
				metadataBasenamePostings: (engine as any).metadataBasenamePostings,
				metadataFolderCharPostings: (engine as any).metadataFolderCharPostings,
				metadataFolderPhrasePostings: (engine as any).metadataFolderPhrasePostings,
				metadataFolderPostings: (engine as any).metadataFolderPostings,
				metadataHeadingPhrasePostings: (engine as any).metadataHeadingPhrasePostings,
				metadataHeadingPostings: (engine as any).metadataHeadingPostings,
				metadataTagCharPostings: (engine as any).metadataTagCharPostings,
				metadataTagFullPostings: (engine as any).metadataTagFullPostings,
				metadataTagPhrasePostings: (engine as any).metadataTagPhrasePostings,
				metadataTagPostings: (engine as any).metadataTagPostings,
				sortedLexicon: (engine as any).getSortedLexicon(),
				documentIdByPath: (engine as any).documentIdByPath,
				documentPathById: (engine as any).documentPathById,
				getDocumentBodyTokens: (docId: number) =>
					(engine as any).getDocumentBodyTokens(docId) ?? [],
				getDocumentMetadataFieldText: (
					docId: number,
					field: "basename" | "aliases" | "folder" | "headings" | "tags",
				) => (engine as any).getDocumentMetadataFieldText(docId, field),
				documentTagValuesById: (engine as any).documentTagValuesById,
			},
			plan,
			phraseSignatures,
			request,
		);
		const docIdByPath = (engine as any).documentIdByPath as Map<string, number>;
		const cacheRestoreState = candidates.get(docIdByPath.get("notes/cache-restore.md")!);
		const restoreCacheState = candidates.get(docIdByPath.get("notes/restore-cache.md")!);

		expect(cacheRestoreState?.phraseMatches.length).toBeGreaterThan(
			restoreCacheState?.phraseMatches.length ?? 0,
		);

		const snapshot = engine.serialize();
		const restored = new CoverageLexicalFileSearchEngine();
		expect(await restored.reIndexAll(snapshot)).toBe(true);
		const restoredBreakdown = restored.getIndexBreakdown();
		expect(restoredBreakdown?.metadataAliasPhraseTermCount).toBe(0);
		expect(restoredBreakdown?.metadataBasenamePhraseTermCount).toBe(0);
		expect(restoredBreakdown?.metadataFolderPhraseTermCount).toBe(0);
		expect(restoredBreakdown?.metadataHeadingPhraseTermCount).toBe(0);
		expect(restoredBreakdown?.metadataTagPhraseTermCount).toBe(0);
	});

	test("deletes and rebuilds documents even when resident body token sequences are missing", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				deleteDocuments(paths: string[]): void;
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
				path: "notes/offload-target.md",
				basename: "offload-target",
				folder: "notes",
				content: "alpha beta gamma",
			},
			{
				path: "notes/offload-peer.md",
				basename: "offload-peer",
				folder: "notes",
				content: "peer document",
			},
		]);

		const docId = ((engine as any).documentIdByPath as Map<string, number>).get(
			"notes/offload-target.md",
		);
		expect(docId).toBeDefined();
		(engine as any).clearDocumentBodyTokens(docId);
		(engine as any).compactDocumentBodyTokenLexicon();

		engine.deleteDocuments(["notes/offload-target.md"]);
		const afterDelete = await engine.searchFiles({
			queryText: "alpha beta gamma",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		expect(afterDelete.map((entry: { path: string }) => entry.path)).not.toContain(
			"notes/offload-target.md",
		);

		await engine.addDocuments([
			{
				path: "notes/offload-target.md",
				basename: "offload-target",
				folder: "notes",
				content: "fresh rebuild target",
			},
		]);
		const afterRebuild = await engine.searchFiles({
			queryText: "fresh rebuild target",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});
		expect(afterRebuild[0]?.path).toBe("notes/offload-target.md");
	});

	test("falls back to snapshot-backed body tokens when resident tokens are missing at query time", async () => {
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

		const documents = [
			{
				path: "notes/snapshot-fallback-target.md",
				basename: "snapshot-fallback-target",
				folder: "notes",
				content: "alpha beta gamma for snapshot fallback",
				headings: "snapshot fallback target",
			},
			{
				path: "notes/snapshot-fallback-peer.md",
				basename: "snapshot-fallback-peer",
				folder: "notes",
				content: "neighbor note",
			},
		];
		const fileSnapshotStore = registerMockFileSnapshotStore(documents);
		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);

		const docId = ((engine as any).documentIdByPath as Map<string, number>).get(
			"notes/snapshot-fallback-target.md",
		);
		expect(docId).toBeDefined();
		(engine as any).clearDocumentBodyTokens(docId);

		const results = await engine.searchFiles({
			queryText: "snapshot fallback target",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(fileSnapshotStore.readCurrentTexts).toHaveBeenCalled();
		expect(results[0]?.path).toBe("notes/snapshot-fallback-target.md");
	});

	test("experimentally offloads resident body token tape while keeping query quality alive", async () => {
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
				getIndexBreakdown(): Record<string, unknown> | null;
			};
		};

		const documents = [
			{
				path: "notes/body-token-offload-target.md",
				basename: "body-token-offload-target",
				folder: "notes",
				content: "alpha beta gamma sits tightly together for phrase witness validation",
				headings: "alpha beta gamma",
			},
			{
				path: "notes/body-token-offload-peer.md",
				basename: "body-token-offload-peer",
				folder: "notes",
				content: "alpha appears here while gamma sits far away from beta in another clause",
			},
		];

		await withExperimentalBodyTokenOffloadEnv(true, async () => {
			const fileSnapshotStore = registerMockFileSnapshotStore(documents);
			const engine = new CoverageLexicalFileSearchEngine();
			await engine.addDocuments(documents);

			const docId = ((engine as any).documentIdByPath as Map<string, number>).get(
				"notes/body-token-offload-target.md",
			);
			expect(docId).toBeDefined();
			expect((engine as any).hasResidentDocumentBodyTokens(docId)).toBe(false);

			const breakdown = engine.getIndexBreakdown();
			const documentIdentity = (breakdown?.estimatedBytes as Record<string, unknown>)
				?.documentIdentity as Record<string, unknown>;
			const bodyTokensById = documentIdentity?.bodyTokensById as
				| Record<string, unknown>
				| undefined;
			expect(bodyTokensById?.populatedCount).toBe(0);

			const results = await engine.searchFiles({
				queryText: "alpha beta gamma",
				isPrefixMatch: true,
				isFuzzy: false,
				maxItemResults: 5,
			});

			expect(fileSnapshotStore.readCurrentTexts).not.toHaveBeenCalled();
			expect(results[0]?.path).toBe("notes/body-token-offload-target.md");
		});
	});

	test("defaults to offloading resident body token tape when file snapshots are available", async () => {
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
				getIndexBreakdown(): Record<string, unknown> | null;
			};
		};

		const documents = [
			{
				path: "notes/default-offload-target.md",
				basename: "default-offload-target",
				folder: "notes",
				content: "alpha beta gamma stays contiguous in the body for default offload",
				headings: "default offload target",
			},
			{
				path: "notes/default-offload-peer.md",
				basename: "default-offload-peer",
				folder: "notes",
				content: "alpha appears while beta and gamma are separated elsewhere",
			},
		];

		await withExperimentalBodyTokenOffloadEnv(undefined, async () => {
			const fileSnapshotStore = registerMockFileSnapshotStore(documents);
			const engine = new CoverageLexicalFileSearchEngine();
			await engine.addDocuments(documents);

			const docId = ((engine as any).documentIdByPath as Map<string, number>).get(
				"notes/default-offload-target.md",
			);
			expect(docId).toBeDefined();
			expect((engine as any).hasResidentDocumentBodyTokens(docId)).toBe(false);

			const breakdown = engine.getIndexBreakdown();
			const documentIdentity = (breakdown?.estimatedBytes as Record<string, unknown>)
				?.documentIdentity as Record<string, unknown>;
			const bodyTokensById = documentIdentity?.bodyTokensById as
				| Record<string, unknown>
				| undefined;
			expect(bodyTokensById?.populatedCount).toBe(0);

			const results = await engine.searchFiles({
				queryText: "alpha beta gamma",
				isPrefixMatch: true,
				isFuzzy: false,
				maxItemResults: 5,
			});

			expect(fileSnapshotStore.readCurrentTexts).not.toHaveBeenCalled();
			expect(results[0]?.path).toBe("notes/default-offload-target.md");
		});
	});

	test("keeps resident body token tape when cold offload initialization fails", async () => {
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

		const documents = [
			{
				path: "notes/offload-failure-target.md",
				basename: "offload-failure-target",
				folder: "notes",
				content: "alpha beta gamma remains searchable after cold offload failure",
			},
		];

		await withExperimentalBodyTokenOffloadEnv(undefined, async () => {
			registerMockFileSnapshotStore(documents);
			const engine = new CoverageLexicalFileSearchEngine();
			(engine as any).writeOffloadedColdBodyTokenSource = jest.fn(() => false);

			await engine.addDocuments(documents);

			const docId = ((engine as any).documentIdByPath as Map<string, number>).get(
				"notes/offload-failure-target.md",
			);
			expect(docId).toBeDefined();
			expect((engine as any).hasResidentDocumentBodyTokens(docId)).toBe(true);

			const results = await engine.searchFiles({
				queryText: "alpha beta gamma",
				isPrefixMatch: true,
				isFuzzy: false,
				maxItemResults: 5,
			});
			expect(results[0]?.path).toBe("notes/offload-failure-target.md");
		});
	});

	test("offloaded coarse ranking hydrates only a bounded candidate subset", async () => {
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
				path: "notes/staged-offload-target.md",
				basename: "staged-offload-target",
				folder: "notes",
				content:
					"alpha beta gamma target cluster keeps the strongest body locality and target clue together",
				headings: "alpha beta gamma target",
			},
			...Array.from({ length: 150 }, (_, index) => ({
				path: `notes/staged-offload-decoy-${index}.md`,
				basename: `staged-offload-decoy-${index}`,
				folder: "notes",
				content: `alpha beta gamma decoy sequence ${index} keeps similar recall anchors without the decisive target token`,
			})),
		];

		await withExperimentalBodyTokenOffloadEnv(true, async () => {
			const fileSnapshotStore = registerMockFileSnapshotStore(documents);
			const engine = new CoverageLexicalFileSearchEngine();
			await engine.addDocuments(documents);
			const loadedFromColdSource = new Set<number>();
			const originalGetOffloadedDocumentBodyTokenIds = (engine as any)
				.getOffloadedDocumentBodyTokenIds
				.bind(engine);
			(engine as any).getOffloadedDocumentBodyTokenIds = (docId: number) => {
				const tokenIds = originalGetOffloadedDocumentBodyTokenIds(docId);
				if (tokenIds) {
					loadedFromColdSource.add(docId);
				}
				return tokenIds;
			};

			const results = await engine.searchFiles({
				queryText: "alpha beta gamma target",
				isPrefixMatch: true,
				isFuzzy: false,
				maxItemResults: 5,
			});

			expect(fileSnapshotStore.readCurrentTexts).not.toHaveBeenCalled();
			expect(loadedFromColdSource.size).toBeGreaterThan(0);
			expect(loadedFromColdSource.size).toBeLessThan(documents.length);
			expect(results[0]?.path).toBe("notes/staged-offload-target.md");
		});
	});

	test("stores document metadata text directly on document records", async () => {
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
				getIndexBreakdown(): Record<string, unknown> | null;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/metadata-pack-target.md",
				basename: "metadata-pack-target",
				folder: "notes/archive",
				content: "ordinary body text",
				aliases: "metadata archive target",
				tags: "#metadata #target",
				headings: "packed metadata heading",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "packed metadata heading",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});
		expect(results[0]?.path).toBe("notes/metadata-pack-target.md");

		const breakdown = engine.getIndexBreakdown();
		const estimatedBytes = (breakdown?.estimatedBytes as Record<string, unknown>) ?? {};
		const stringPool = (estimatedBytes.stringPool as Record<string, unknown>) ?? {};
		const stringPoolByGroup =
			(stringPool.byGroup as Record<string, Record<string, unknown>>) ?? {};
		const documentTextGroup = stringPoolByGroup.documentText ?? {};

		expect((documentTextGroup.bytes ?? 0) as number).toBeGreaterThan(0);
		expect(
			(((engine as any).documentById as Array<Record<string, unknown> | undefined>)[0] ??
				{}).headingsText,
		).toBe("packed metadata heading");
	});

	test("publishes body token cold rows through the Dexie-backed cold store token", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				deleteDocuments(paths: string[]): void;
			};
		};
		const { COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN } = require(
			"src/services/search/coverage-lexical/coverage-lexical-body-token-cold-types",
		) as {
			COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN: string;
		};
		const upsertDocuments = jest.fn(async () => undefined);
		const deleteDocuments = jest.fn(async () => undefined);
		const clearAll = jest.fn(async () => undefined);

		container.registerInstance(COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN, {
			upsertDocuments,
			deleteDocuments,
			clearAll,
		} as any);

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/cold-store-target.md",
				basename: "cold-store-target",
				folder: "notes",
				content: "alpha alpha beta beta gamma gamma",
			},
		]);

		expect(upsertDocuments).toHaveBeenCalledTimes(1);
		expect(upsertDocuments).toHaveBeenCalledWith([
			expect.objectContaining({
				path: "notes/cold-store-target.md",
				bodyTokens: [
					"alpha",
					"alpha",
					"alpha",
					"alpha",
					"beta",
					"beta",
					"beta",
					"beta",
					"gamma",
					"gamma",
					"gamma",
					"gamma",
				],
			}),
		]);

		engine.deleteDocuments(["notes/cold-store-target.md"]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(deleteDocuments).toHaveBeenCalledWith([
			"notes/cold-store-target.md",
		]);
		expect(clearAll).not.toHaveBeenCalled();
	});

	test("coarse hydration treats unresolved body evidence as upgrade potential", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => unknown;
		};

		const engine = new CoverageLexicalFileSearchEngine() as any;
		const plan = {
			queryKind: "metadata_only_anchored",
			route: "metadata-first",
			hasPathShapeHint: false,
			hasTitleShapeHint: false,
		};
		const coarseRanked = Array.from({ length: 30 }, (_, index) => ({
			docId: index,
			queryTerms: ["alpha"],
			matchedTerms: ["alpha"],
			score: 30 - index,
			coverageLexicalSignal: createExperimentalCoverageSignal(30 - index),
			admissionSignal: createEmptyExperimentalAdmissionSignal(),
		}));
		const candidates = new Map<number, ReturnType<
			typeof createEmptyExperimentalCandidateState
		>>();
		for (const result of coarseRanked) {
			candidates.set(result.docId, createEmptyExperimentalCandidateState());
		}
		const unresolvedState = candidates.get(24);
		expect(unresolvedState).toBeDefined();
		unresolvedState!.unresolvedBodyEvidence.hasUnverifiedPhraseWitness = true;
		unresolvedState!.unresolvedBodyEvidence.unresolvedFamilyCount = 1;
		unresolvedState!.unresolvedBodyEvidence.unresolvedWeightUpperBound = 2;

		const hydratedDocIds = engine.computeCoarseHydrationDocIds(
			coarseRanked,
			candidates,
			plan,
			5,
		) as ReadonlySet<number>;

		expect(hydratedDocIds.has(24)).toBe(true);
		expect(hydratedDocIds.has(25)).toBe(false);
	});

	test("coarse hydration grants a bounded tail budget to unresolved body evidence", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => unknown;
		};

		const engine = new CoverageLexicalFileSearchEngine() as any;
		const plan = {
			queryKind: "metadata_only_anchored",
			route: "metadata-first",
			hasPathShapeHint: false,
			hasTitleShapeHint: false,
		};
		const coarseRanked = Array.from({ length: 60 }, (_, index) => ({
			docId: index,
			queryTerms: ["alpha"],
			matchedTerms: ["alpha"],
			score: 60 - index,
			coverageLexicalSignal: createExperimentalCoverageSignal(60 - index),
			admissionSignal: createEmptyExperimentalAdmissionSignal(),
		}));
		const candidates = new Map<number, ReturnType<
			typeof createEmptyExperimentalCandidateState
		>>();
		for (const result of coarseRanked) {
			candidates.set(result.docId, createEmptyExperimentalCandidateState());
		}
		const unresolvedState = candidates.get(55);
		expect(unresolvedState).toBeDefined();
		unresolvedState!.unresolvedBodyEvidence.hasUnverifiedPhraseWitness = true;
		unresolvedState!.unresolvedBodyEvidence.unresolvedFamilyCount = 2;
		unresolvedState!.unresolvedBodyEvidence.unresolvedWeightUpperBound = 3;

		const hydratedDocIds = engine.computeCoarseHydrationDocIds(
			coarseRanked,
			candidates,
			plan,
			5,
		) as ReadonlySet<number>;

		expect(hydratedDocIds.has(55)).toBe(true);
		expect(hydratedDocIds.size).toBeLessThan(40);
	});
});
