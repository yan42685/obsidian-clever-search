import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import { describeResidentBase } from "src/services/search/coverage-lexical-v3/metrics";

function createDocument(
	overrides: Partial<IndexedDocument> & Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
		generation: overrides.generation,
		size: overrides.size,
	};
}

function sumMetricBuckets(metrics: ReturnType<typeof buildResidentBase>["metrics"]): number {
	return (
		metrics.docArenaBytes +
		metrics.stringArenaBytes +
		metrics.familyLexiconBytes +
		metrics.metadataContainerBytes +
		metrics.headingBytes +
		metrics.bodySummaryBytes +
		metrics.bodyBlockBytes +
		metrics.exactTapeBytes +
		metrics.hanRouteBytes +
		metrics.auxiliaryBytes
	);
}

describe("coverage lexical v3 resident base", () => {
	test("builds an empty resident base", () => {
		const residentBase = buildResidentBase([]);
		const summary = describeResidentBase(residentBase);

		expect(residentBase.docTable.docCount).toBe(0);
		expect(residentBase.familyLexicon.familyCount).toBe(0);
		expect(residentBase.bodyBlocks.blockCount).toBe(0);
		expect(residentBase.metrics.residentBytes).toBe(sumMetricBuckets(residentBase.metrics));
		expect(residentBase.metrics["residentBytes / indexedSurfaceUtf8Bytes"]).toBe(0);
		expect(residentBase.metrics["residentBytes / rawMarkdownUtf8Bytes"]).toBe(0);
		expect(summary.buckets).toHaveLength(10);
	});

	test("builds a single latin document", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "notes/cache-restore.md",
				basename: "cache restore",
				folder: "notes",
				aliases: "restore cache replay",
				tags: "#incident #cache",
				headings: "warm start",
				content: "Cache restore replay steps and warm start checks.",
			}),
		]);

		expect(residentBase.docTable.docCount).toBe(1);
		expect(residentBase.familyLexicon.familyCount).toBeGreaterThan(0);
		expect(residentBase.metadataContainers.identityPostings.docIds.length).toBeGreaterThan(0);
		expect(residentBase.bodySummary.postings.blockIds.length).toBeGreaterThan(0);
		expect(residentBase.bodyBlocks.blockCount).toBe(1);
		expect(residentBase.exactTapes.familyIds.length).toBeGreaterThan(0);
		expect(residentBase.metrics.indexedSurfaceUtf8Bytes).toBeGreaterThan(0);
		expect(residentBase.metrics.residentBytes).toBe(sumMetricBuckets(residentBase.metrics));
	});

	test("builds a single han document", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "技术/缓存恢复.md",
				basename: "缓存恢复",
				folder: "技术",
				headings: "故障回放",
				content: "缓存恢复步骤\n\n回放检查与热启动恢复。",
			}),
		]);

		expect(residentBase.docTable.docCount).toBe(1);
		expect(residentBase.familyLexicon.familyCount).toBeGreaterThan(0);
		expect(residentBase.bodyBlocks.blockCount).toBeGreaterThan(0);
		expect(residentBase.exactTapes.familyIds.length).toBeGreaterThan(0);
		expect(residentBase.metrics.hanRouteBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.residentBytes).toBe(sumMetricBuckets(residentBase.metrics));
	});

	test("builds mixed metadata and body structures with stable byte buckets", () => {
		const residentBase = buildResidentBase([
			createDocument({
				path: "infra/projected-secret-note.md",
				basename: "projected secret note",
				folder: "infra/kubernetes",
				aliases: "pod projected token runtime access",
				tags: "#k8s #runtime",
				headings: "Projected token runtime access",
				content:
					"Pod mounts token and secret together.\n\nProjected secrets and tokens in a pod runtime window.",
			}),
			createDocument({
				path: "daily/cache.md",
				basename: "daily cache replay checks",
				folder: "daily",
				tags: "#daily",
				headings: "cache replay",
				content: "Remember vector cache restore note.",
			}),
		]);
		const summary = describeResidentBase(residentBase);

		expect(residentBase.metrics.docArenaBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.stringArenaBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.metadataContainerBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.headingBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.bodySummaryBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.bodyBlockBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.exactTapeBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.residentBytes).toBe(sumMetricBuckets(residentBase.metrics));
		expect(summary.documentCount).toBe(2);
		expect(summary.familyCount).toBe(residentBase.familyLexicon.familyCount);
		expect(summary["residentBytes / indexedSurfaceUtf8Bytes"]).toBeGreaterThan(0);
	});
});
