import { buildLexicalOnlyFreshness, resolveHybridFileItemFreshness } from "src/services/search/hybrid/freshness";

describe("hybrid freshness resolver", () => {
	test("maps shadow snapshots to stale grace with banner", () => {
		const freshness = resolveHybridFileItemFreshness({
			reason: "embedding_wait_interval",
			snapshotGeneration: 42,
			snapshotSource: "shadow",
			nativeSubItemsReady: true,
		});

		expect(freshness).toMatchObject({
			state: "stale_grace",
			reason: "embedding_wait_interval",
			snapshotGeneration: 42,
			snapshotSource: "shadow",
			nativeSubItemsReady: false,
			bannerKey: "hybridNotice.fileEmbeddingWaitInterval",
		});
	});

	test("maps live and indexed snapshots to fresh without banner", () => {
		expect(
			resolveHybridFileItemFreshness({
				snapshotGeneration: 7,
				snapshotSource: "indexed",
				nativeSubItemsReady: true,
			}),
		).toMatchObject({
			state: "fresh",
			reason: "none",
			snapshotGeneration: 7,
			snapshotSource: "indexed",
			nativeSubItemsReady: true,
			bannerKey: null,
		});

		expect(
			resolveHybridFileItemFreshness({ snapshotSource: "live" }),
		).toMatchObject({
			state: "fresh",
			reason: "none",
			snapshotSource: "live",
			bannerKey: null,
		});
	});

	test("falls back to lexical only when freshness is missing", () => {
		expect(resolveHybridFileItemFreshness(undefined)).toMatchObject({
			state: "lexical_only",
			reason: "shadow_missing",
			snapshotSource: "live",
			nativeSubItemsReady: true,
			bannerKey: null,
		});
		expect(buildLexicalOnlyFreshness("dense_unavailable")).toMatchObject({
			state: "lexical_only",
			reason: "dense_unavailable",
			bannerKey: null,
		});
	});
});
