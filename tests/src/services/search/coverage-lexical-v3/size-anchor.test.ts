import fs from "node:fs";
import path from "node:path";
import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import { describeResidentBase } from "src/services/search/coverage-lexical-v3/metrics";

const originalDescribe = global.describe;
(global as typeof global & { describe: typeof describe }).describe = ((_: string, __: () => void) =>
	undefined) as typeof describe;
const fixtureModule = require("../coverage-lexical-legacy-automation-benchmark.bench") as {
	createAutomationCorpus(): {
		documents: IndexedDocument[];
		queryCases: Array<{ query: string; relevantPath: string }>;
	};
};
(global as typeof global & { describe: typeof describe }).describe = originalDescribe;

describe("coverage lexical v3 size anchor", () => {
	test("automation corpus resident skeleton produces stable bytes and summary", () => {
		const { documents } = fixtureModule.createAutomationCorpus();
		const residentBase = buildResidentBase(documents);
		const summary = describeResidentBase(residentBase);
		const payload = {
			documentCount: residentBase.docTable.docCount,
			familyCount: residentBase.familyLexicon.familyCount,
			blockCount: residentBase.bodyBlocks.blockCount,
			exactTapeValueCount: residentBase.exactTapes.familyIds.length,
			metrics: residentBase.metrics,
			buckets: summary.buckets,
		};

		if (process.env.COVERAGE_LEXICAL_V3_WRITE_BREAKDOWN_PATH) {
			const outputPath = path.resolve(
				process.cwd(),
				process.env.COVERAGE_LEXICAL_V3_WRITE_BREAKDOWN_PATH,
			);
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
		}

		console.log(
			"[coverage-lexical-v3-size-anchor]",
			JSON.stringify(payload, null, 2),
		);

		expect(residentBase.docTable.docCount).toBeGreaterThanOrEqual(80);
		expect(residentBase.metrics.residentBytes).toBeGreaterThan(0);
		expect(residentBase.metrics.indexedSurfaceUtf8Bytes).toBeGreaterThan(0);
		expect(residentBase.metrics.auxiliaryBytes).toBeGreaterThanOrEqual(0);
		expect(residentBase.metrics["residentBytes / indexedSurfaceUtf8Bytes"]).toBeGreaterThan(0);
		expect(summary.buckets).toHaveLength(10);
	});
});
