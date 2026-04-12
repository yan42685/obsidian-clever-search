import {
	CoverageLexicalV2IndexStore,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-index-store";
import {
	planCoverageLexicalV2PersistentRecovery,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-index-store-recovery";
import type {
	CoverageLexicalV2PreparedDocument,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-index-store-types";

const textEncoder = new TextEncoder();

function createPreparedDocument(options: {
	path: string;
	generation: number;
	size?: number;
	basenameTerms?: readonly string[];
	aliasesTerms?: readonly string[];
	headingsTerms?: readonly string[];
	folderTerms?: readonly string[];
	tagTerms?: readonly string[];
	bodyTerms?: readonly string[];
	metadataHanBigramsByField?: Partial<
		CoverageLexicalV2PreparedDocument["metadataHanBigramsByField"]
	>;
	bodyHanSegments?: readonly string[];
	bodyTokens?: readonly string[];
}): CoverageLexicalV2PreparedDocument {
	return {
		path: options.path,
		generation: options.generation,
		indexedRef: {
			path: options.path,
			generation: options.generation,
			size: options.size ?? 128,
		},
		record: {
			path: options.path,
			stableDeterministicKey: options.path,
			basenameText: (options.basenameTerms ?? []).join(" "),
			aliasesText: (options.aliasesTerms ?? []).join(" "),
			headingsText: (options.headingsTerms ?? []).join(" "),
			folderText: (options.folderTerms ?? []).join(" "),
			tagsText: (options.tagTerms ?? []).join(" "),
		},
		exactTermsByField: {
			basename: [...(options.basenameTerms ?? [])],
			aliases: [...(options.aliasesTerms ?? [])],
			headings: [...(options.headingsTerms ?? [])],
			folder: [...(options.folderTerms ?? [])],
			tag: [...(options.tagTerms ?? [])],
			body: [...(options.bodyTerms ?? [])],
		},
		metadataHanBigramsByField: {
			basename: [...(options.metadataHanBigramsByField?.basename ?? [])],
			aliases: [...(options.metadataHanBigramsByField?.aliases ?? [])],
			headings: [...(options.metadataHanBigramsByField?.headings ?? [])],
			folder: [...(options.metadataHanBigramsByField?.folder ?? [])],
			tag: [...(options.metadataHanBigramsByField?.tag ?? [])],
		},
		bodyHanSegments: [...(options.bodyHanSegments ?? [])],
		bodyTokens: [...(options.bodyTokens ?? options.bodyTerms ?? [])],
	};
}

function createReader(store: CoverageLexicalV2IndexStore) {
	return store.createStorageReader({
		getBodyTokenSequence: () => undefined,
		prefetchBodyTokenSequences: async () => {},
		prefetchBodyHanExact: async (docIds, _budget) => ({
			fetchedDocIds: [...docIds],
			fetchedDocCount: docIds.length,
			byteSum: 0,
			skippedByBudget: 0,
			skippedReason: "none" as const,
		}),
		getBodyHanExactBackstopStats: (docId, _normalizedText, bigrams) =>
			store.getBodyHanBackstopGateStats(docId, bigrams),
		tokenizeText: (text) => text.split(/\s+/u).filter(Boolean),
	});
}

function estimateDocumentViewBytesForTest(documentState: any): number {
	const ownedStrings = new Set<string>();
	const addOwnedStringBytes = (value: string): number => {
		if (value.length === 0 || ownedStrings.has(value)) {
			return 0;
		}
		ownedStrings.add(value);
		return textEncoder.encode(value).length;
	};
	return (
		addOwnedStringBytes(documentState.path) +
		addOwnedStringBytes(documentState.indexedRef.path) +
		addOwnedStringBytes(documentState.record.path) +
		addOwnedStringBytes(
			documentState.record.stableDeterministicKey ?? documentState.path,
		) +
		addOwnedStringBytes(documentState.record.basenameText) +
		addOwnedStringBytes(documentState.record.aliasesText) +
		addOwnedStringBytes(documentState.record.headingsText) +
		addOwnedStringBytes(documentState.record.folderText) +
		addOwnedStringBytes(documentState.record.tagsText) +
		64
	);
}

describe("CoverageLexicalV2IndexStore", () => {
	test("replace, update, move, and delete preserve doc ids and postings", () => {
		const store = new CoverageLexicalV2IndexStore();
		const firstDoc = createPreparedDocument({
			path: "notes/alpha.md",
			generation: 1,
			basenameTerms: ["alpha"],
			folderTerms: ["notes"],
			tagTerms: ["ship"],
			bodyTerms: ["body", "alpha"],
			bodyHanSegments: ["中文段落"],
			bodyTokens: ["body", "alpha"],
		});

		const firstDocId = store.replaceDocument(firstDoc);
		expect(firstDocId).toBe(0);
		expect(store.getDocumentId("notes/alpha.md")).toBe(0);

		const reader = createReader(store);
		expect(reader.getPostingMatches("basename", "alpha")).toEqual([0]);
		expect(reader.getPostingMatches("body", "alpha")).toEqual([0]);
		expect(reader.getBodyHanSegmentDocIds()).toEqual([0]);

		const updatedDoc = createPreparedDocument({
			path: "notes/alpha.md",
			generation: 2,
			basenameTerms: ["beta"],
			folderTerms: ["notes"],
			tagTerms: ["ship"],
			bodyTerms: ["body", "beta"],
			bodyTokens: ["body", "beta"],
		});
		const updatedDocId = store.replaceDocument(updatedDoc);
		expect(updatedDocId).toBe(firstDocId);
		expect(reader.getPostingMatches("basename", "alpha")).toBeUndefined();
		expect(reader.getPostingMatches("basename", "beta")).toEqual([0]);

		const movedDoc = createPreparedDocument({
			path: "notes/renamed.md",
			generation: 3,
			basenameTerms: ["beta"],
			folderTerms: ["notes"],
			bodyTerms: ["body", "beta"],
			bodyTokens: ["body", "beta"],
		});
		const movedDocId = store.replaceDocument(movedDoc, "notes/alpha.md");
		expect(movedDocId).toBe(firstDocId);
		expect(store.getDocumentId("notes/alpha.md")).toBeUndefined();
		expect(store.getDocumentId("notes/renamed.md")).toBe(firstDocId);

		store.deleteDocument("notes/renamed.md");
		expect(store.getIndexedDocumentCount()).toBe(0);
		expect(reader.getPostingMatches("basename", "beta")).toBeUndefined();
		expect(reader.getBodyHanSegmentDocIds()).toEqual([]);
	});

	test("force compaction rebuilds resident segments from document truth and clears tombstones", () => {
		const store = new CoverageLexicalV2IndexStore();
		store.replaceDocument(
			createPreparedDocument({
				path: "notes/rolling.md",
				generation: 1,
				basenameTerms: ["alpha"],
				bodyTerms: ["alpha", "body"],
				bodyTokens: ["alpha", "body"],
			}),
		);
		store.compactOverlayIntoSegment(true);
		const baselineExactIncidence =
			store.buildIndexBreakdown().estimatedBytes.residentHot.postings.exactIncidence;

		store.replaceDocument(
			createPreparedDocument({
				path: "notes/rolling.md",
				generation: 2,
				basenameTerms: ["beta"],
				bodyTerms: ["beta", "body"],
				bodyTokens: ["beta", "body"],
			}),
		);
		store.compactOverlayIntoSegment();
		store.replaceDocument(
			createPreparedDocument({
				path: "notes/rolling.md",
				generation: 3,
				basenameTerms: ["gamma"],
				bodyTerms: ["gamma", "body"],
				bodyTokens: ["gamma", "body"],
			}),
		);
		store.compactOverlayIntoSegment();

		const inflatedExactIncidence =
			store.buildIndexBreakdown().estimatedBytes.residentHot.postings.exactIncidence;
		expect(inflatedExactIncidence).toBeGreaterThan(baselineExactIncidence);

		store.compactOverlayIntoSegment(true);

		const compactedBreakdown = store.buildIndexBreakdown();
		expect(
			compactedBreakdown.estimatedBytes.residentHot.postings.exactIncidence,
		).toBeLessThan(inflatedExactIncidence);
		const reader = createReader(store);
		expect(reader.getPostingMatches("basename", "alpha")).toBeUndefined();
		expect(reader.getPostingMatches("basename", "beta")).toBeUndefined();
		expect(reader.getPostingMatches("basename", "gamma")).toEqual([0]);
		expect(compactedBreakdown.segmentCount).toBe(1);
	});

	test("snapshot roundtrip preserves resident state and reports cold-sidecar bytes", () => {
		const store = new CoverageLexicalV2IndexStore();
		store.replaceDocument(
			createPreparedDocument({
				path: "notes/han.md",
				generation: 11,
				basenameTerms: ["han"],
				folderTerms: ["notes"],
				bodyTerms: ["han", "body"],
				bodyHanSegments: ["测试正文"],
				bodyTokens: ["han", "body", "tokens"],
				metadataHanBigramsByField: {
					basename: ["测试"],
				},
			}),
		);
		store.replaceDocument(
			createPreparedDocument({
				path: "notes/latin.md",
				generation: 12,
				basenameTerms: ["latin"],
				folderTerms: ["notes"],
				bodyTerms: ["latin", "search"],
				bodyTokens: ["latin", "search", "tokens"],
			}),
		);
		store.compactOverlayIntoSegment(true);

		const snapshot = store.buildSnapshotState();
		expect(snapshot.documents[0]?.record.stableDeterministicKey).toBe("notes/han.md");
		expect(snapshot.documents[0]?.record.basenameText).toBe("han");
		expect(snapshot.documents[0]?.manifest.bodyTokenSidecar.path).toBe(
			"notes/han.md",
		);
		expect(
			snapshot.documents[0]?.manifest.bodyHanGateBloomWords.length,
		).toBeGreaterThan(0);
		expect(snapshot.hanSymbolPool.codePointsBySymbolId.length).toBeGreaterThan(0);
		expect(snapshot.canonicalTermPool.termOffsets.length).toBeGreaterThan(0);
		const restored = new CoverageLexicalV2IndexStore();
		restored.restoreSnapshot(snapshot);
		const reader = createReader(restored);

		expect(reader.getPostingMatches("basename", "han")).toEqual([0]);
		expect(reader.getPostingMatches("basename", "latin")).toEqual([1]);
		expect(reader.getMetadataHanBigramPostingMatches("basename", "测试")).toEqual([0]);
		expect(reader.getBodyHanSegmentDocIds()).toEqual([0]);
		expect(
			reader.getBodyHanExactBackstopStats(0, "测试正文", [
				"测试",
				"试正",
				"正文",
			]),
		).toEqual({
			longestContiguousBigramChain: 3,
			matchedBigramCount: 3,
			bigramCoverageRatio: 1,
		});

		const breakdown = restored.buildIndexBreakdown();
		expect(breakdown.segmentCount).toBeGreaterThan(0);
		expect(breakdown.latinExpansionTermCount).toBeGreaterThan(0);
		expect(breakdown.estimatedBytes.residentHot.total).toBe(
			restored.estimateIndexBytes(),
		);
		expect(breakdown.estimatedBytes.residentHot.postings.exactIncidence).toBeGreaterThan(0);
		expect(breakdown.estimatedBytes.residentHot.documents.view).toBeGreaterThan(0);
		expect(
			breakdown.estimatedBytes.coldOwned.bodyTokensSidecar,
		).toBeGreaterThan(0);
		expect(
			breakdown.estimatedBytes.combinedOwnedTotal,
		).toBe(
			breakdown.estimatedBytes.residentHot.total +
				breakdown.estimatedBytes.coldOwned.total,
		);

		const runtimeDocument = (restored as any).documentById[0];
		expect(runtimeDocument.manifest.stableDeterministicKey).toBeUndefined();
		expect(runtimeDocument.manifest.normalizedMetadataTexts).toBeUndefined();
		expect(runtimeDocument.manifest.bodyTokenSidecar.path).toBeUndefined();
	});

	test("shares empty runtime manifest structures across documents", () => {
		const store = new CoverageLexicalV2IndexStore();
		store.replaceDocument(
			createPreparedDocument({
				path: "notes/empty-a.md",
				generation: 1,
			}),
		);
		store.replaceDocument(
			createPreparedDocument({
				path: "notes/empty-b.md",
				generation: 2,
			}),
		);

		const firstDocument = (store as any).documentById[0];
		const secondDocument = (store as any).documentById[1];
		expect(firstDocument.manifest.exactTermIdsByField).toBe(
			secondDocument.manifest.exactTermIdsByField,
		);
		expect(firstDocument.manifest.metadataHanBigramIdsByField).toBe(
			secondDocument.manifest.metadataHanBigramIdsByField,
		);
		expect(firstDocument.manifest.bodyHanGateBloomWords).toBe(
			secondDocument.manifest.bodyHanGateBloomWords,
		);
	});

	test("shares repeated document-view strings across documents and releases them on delete", () => {
		const store = new CoverageLexicalV2IndexStore();
		const first = createPreparedDocument({
			path: "shared/one.md",
			generation: 1,
			basenameTerms: ["one"],
			aliasesTerms: ["shared alias"],
			headingsTerms: ["shared heading"],
			folderTerms: ["shared-folder"],
			tagTerms: ["shared-tag"],
			bodyTerms: ["one"],
		});
		first.record.stableDeterministicKey = "shared-key";
		const second = createPreparedDocument({
			path: "shared/two.md",
			generation: 2,
			basenameTerms: ["two"],
			aliasesTerms: ["shared alias"],
			headingsTerms: ["shared heading"],
			folderTerms: ["shared-folder"],
			tagTerms: ["shared-tag"],
			bodyTerms: ["two"],
		});
		second.record.stableDeterministicKey = "shared-key";

		store.replaceDocument(first);
		store.replaceDocument(second);

		const firstDocument = (store as any).documentById[0];
		const secondDocument = (store as any).documentById[1];
		const naiveDuplicatedBytes =
			estimateDocumentViewBytesForTest(firstDocument) +
			estimateDocumentViewBytesForTest(secondDocument);
		const pooledBreakdown = store.buildIndexBreakdown();
		expect(pooledBreakdown.estimatedBytes.residentHot.documents.view).toBeLessThan(
			naiveDuplicatedBytes,
		);
		expect((store as any).documentViewSharedStringBytes).toBeGreaterThan(0);

		store.deleteDocument("shared/two.md");
		const afterDeleteBreakdown = store.buildIndexBreakdown();
		expect(afterDeleteBreakdown.estimatedBytes.residentHot.documents.view).toBe(
			estimateDocumentViewBytesForTest((store as any).documentById[0]),
		);

		store.deleteDocument("shared/one.md");
		expect((store as any).documentViewSharedStringBytes).toBe(0);
		expect(store.buildIndexBreakdown().estimatedBytes.residentHot.documents.view).toBe(0);
	});
});

describe("planCoverageLexicalV2PersistentRecovery", () => {
	test("classifies drift and cold-sidecar repair without forcing rebuild", () => {
		const plan = planCoverageLexicalV2PersistentRecovery({
			currentIndexedRefs: [
				{ path: "notes/a.md", generation: 2, size: 20 },
				{ path: "notes/b.md", generation: 1, size: 10 },
			],
			persistedIndexedRefs: [
				{ path: "notes/a.md", generation: 1, size: 20 },
				{ path: "notes/c.md", generation: 1, size: 15 },
			],
			storeIndexedRefs: [
				{ path: "notes/a.md", generation: 1, size: 20 },
				{ path: "notes/c.md", generation: 1, size: 15 },
			],
			coldConsistency: {
				needsRepair: true,
				requiresReset: false,
				reason: "fingerprint-mismatch",
				missingOrStalePaths: ["notes/b.md"],
				danglingPaths: ["notes/c.md"],
			},
		});

		expect(plan.status).toBe("needs_heal");
		expect(plan.reason).toBe("cold_sidecar_drift");
		expect(plan.docsToDelete).toEqual(["notes/c.md"]);
		expect(plan.docsToAdd).toEqual(["notes/b.md"]);
		expect(plan.docsToUpdate).toEqual(["notes/a.md", "notes/b.md"]);
	});

	test("forces rebuild when store refs diverge from persisted refs", () => {
		const plan = planCoverageLexicalV2PersistentRecovery({
			currentIndexedRefs: [{ path: "notes/a.md", generation: 1, size: 10 }],
			persistedIndexedRefs: [{ path: "notes/a.md", generation: 1, size: 10 }],
			storeIndexedRefs: [{ path: "notes/a.md", generation: 9, size: 10 }],
		});

		expect(plan.status).toBe("needs_full_rebuild");
		expect(plan.reason).toBe("persisted_ref_mismatch");
	});

	test("infers simple move plans from matching generation and size", () => {
		const plan = planCoverageLexicalV2PersistentRecovery({
			currentIndexedRefs: [{ path: "notes/renamed.md", generation: 7, size: 33 }],
			persistedIndexedRefs: [{ path: "notes/original.md", generation: 7, size: 33 }],
			storeIndexedRefs: [{ path: "notes/original.md", generation: 7, size: 33 }],
		});

		expect(plan.status).toBe("needs_heal");
		expect(plan.docsToAdd).toEqual([]);
		expect(plan.docsToDelete).toEqual([]);
		expect(plan.docsToMove).toEqual([
			{ oldPath: "notes/original.md", newPath: "notes/renamed.md" },
		]);
	});
});
