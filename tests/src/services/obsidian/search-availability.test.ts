import {
	buildHybridAvailabilityState,
	buildLexicalAvailabilityState,
	resolveHybridFreshnessState,
	resolveHybridHealthSummaryState,
} from "src/services/obsidian/user-data/search-availability";

describe("search availability derivation", () => {
	test("maps lexical bootstrap states into searchable status and notice keys", () => {
		expect(buildLexicalAvailabilityState("searchable")).toEqual({
			bootstrap: "searchable",
			searchable: true,
			blockingNoticeKey: null,
		});
		expect(buildLexicalAvailabilityState("restoring")).toEqual({
			bootstrap: "restoring",
			searchable: false,
			blockingNoticeKey: "searchBootstrap.restoring",
		});
		expect(buildLexicalAvailabilityState("healing")).toEqual({
			bootstrap: "healing",
			searchable: false,
			blockingNoticeKey: "searchBootstrap.healing",
		});
		expect(buildLexicalAvailabilityState("failed")).toEqual({
			bootstrap: "failed",
			searchable: false,
			blockingNoticeKey: "searchBootstrap.failed",
		});
	});

	test("marks hybrid as lexical-only when query can be served without dense search", () => {
		expect(
			buildHybridAvailabilityState({
				enabled: true,
				bootstrap: "searchable",
				runtimeGateOpen: true,
				canServeQuery: true,
				canSearch: false,
				hasFailures: false,
				hasIncompleteEmbeddings: false,
			}),
		).toEqual({
			enabled: true,
			bootstrap: "searchable",
			query: "lexical_only",
			reasons: ["dense_unavailable"],
			prompt: {
				blockingNoticeKey: null,
				fallbackNoticeKey: "hybridNotice.searchFallbackToLexical",
			},
		});
	});

	test("marks hybrid as degraded when dense search works but repair is pending", () => {
		expect(
			buildHybridAvailabilityState({
				enabled: true,
				bootstrap: "searchable",
				runtimeGateOpen: true,
				canServeQuery: true,
				canSearch: true,
				hasFailures: true,
				hasIncompleteEmbeddings: false,
			}),
		).toMatchObject({
			query: "degraded",
			reasons: ["repair_pending"],
			prompt: {
				blockingNoticeKey: null,
				fallbackNoticeKey: null,
			},
		});
	});

	test("includes embedding_incomplete in reasons when embeddings are incomplete", () => {
		expect(
			buildHybridAvailabilityState({
				enabled: true,
				bootstrap: "searchable",
				runtimeGateOpen: true,
				canServeQuery: true,
				canSearch: true,
				hasFailures: false,
				hasIncompleteEmbeddings: true,
			}),
		).toMatchObject({
			query: "degraded",
			reasons: ["embedding_incomplete"],
		});
	});

	test("distinguishes runtime gate blocking from engine query unavailability", () => {
		expect(
			buildHybridAvailabilityState({
				enabled: true,
				bootstrap: "searchable",
				runtimeGateOpen: false,
				canServeQuery: true,
				canSearch: true,
				hasFailures: false,
				hasIncompleteEmbeddings: false,
			}),
		).toMatchObject({
			query: "unavailable",
			reasons: ["runtime_gate_blocked"],
		});
	});

	test("derives hybrid freshness state from updating and repair counts", () => {
		expect(
			resolveHybridFreshnessState({
				updatingFileCount: 0,
				repairFileCount: 0,
			}),
		).toBe("current");
		expect(
			resolveHybridFreshnessState({
				updatingFileCount: 2,
				repairFileCount: 0,
			}),
		).toBe("updating");
		expect(
			resolveHybridFreshnessState({
				updatingFileCount: 0,
				repairFileCount: 1,
			}),
		).toBe("repairing");
		expect(
			resolveHybridFreshnessState({
				updatingFileCount: 2,
				repairFileCount: 1,
			}),
		).toBe("partial");
	});

	test("derives health summary state using the shared rules", () => {
		expect(
			resolveHybridHealthSummaryState({
				enabled: false,
				trackedFileCount: 0,
				storedPathCount: 0,
				indexedFileRefCount: 0,
				readyFileCount: 0,
				lexicalOnlyFileCount: 0,
				unstableFileCount: 0,
				updatingFileCount: 0,
				repairFileCount: 0,
				shadowAlignedSnapshotCount: 0,
				shadowMismatchCount: 0,
			}),
		).toBe("disabled");
		expect(
			resolveHybridHealthSummaryState({
				enabled: true,
				trackedFileCount: 3,
				storedPathCount: 0,
				indexedFileRefCount: 0,
				readyFileCount: 0,
				lexicalOnlyFileCount: 0,
				unstableFileCount: 0,
				updatingFileCount: 0,
				repairFileCount: 0,
				shadowAlignedSnapshotCount: 0,
				shadowMismatchCount: 0,
			}),
		).toBe("empty");
		expect(
			resolveHybridHealthSummaryState({
				enabled: true,
				trackedFileCount: 3,
				storedPathCount: 3,
				indexedFileRefCount: 3,
				readyFileCount: 0,
				lexicalOnlyFileCount: 3,
				unstableFileCount: 0,
				updatingFileCount: 0,
				repairFileCount: 0,
				shadowAlignedSnapshotCount: 0,
				shadowMismatchCount: 0,
			}),
		).toBe("lexical_only");
		expect(
			resolveHybridHealthSummaryState({
				enabled: true,
				trackedFileCount: 3,
				storedPathCount: 3,
				indexedFileRefCount: 3,
				readyFileCount: 2,
				lexicalOnlyFileCount: 0,
				unstableFileCount: 1,
				updatingFileCount: 0,
				repairFileCount: 1,
				shadowAlignedSnapshotCount: 0,
				shadowMismatchCount: 0,
			}),
		).toBe("degraded");
		expect(
			resolveHybridHealthSummaryState({
				enabled: true,
				trackedFileCount: 3,
				storedPathCount: 3,
				indexedFileRefCount: 2,
				readyFileCount: 2,
				lexicalOnlyFileCount: 0,
				unstableFileCount: 0,
				updatingFileCount: 1,
				repairFileCount: 0,
				shadowAlignedSnapshotCount: 0,
				shadowMismatchCount: 0,
			}),
		).toBe("partial");
		expect(
			resolveHybridHealthSummaryState({
				enabled: true,
				trackedFileCount: 3,
				storedPathCount: 3,
				indexedFileRefCount: 3,
				readyFileCount: 3,
				lexicalOnlyFileCount: 0,
				unstableFileCount: 0,
				updatingFileCount: 0,
				repairFileCount: 0,
				shadowAlignedSnapshotCount: 0,
				shadowMismatchCount: 0,
			}),
		).toBe("ready");
	});
});
