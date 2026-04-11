import fs from "node:fs";
import path from "node:path";
import {
	CoverageLexicalV2IndexStore,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-index-store";
import type {
	CoverageLexicalV2PreparedDocument,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-index-store-types";
import {
	extractHanBigrams,
	extractHanSegments,
	splitCoverageLexicalTagValues,
} from "src/services/search/coverage-lexical/coverage-lexical-cjk";

type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

const LEGACY_COUPLED_AUTOMATION_LIVE_BYTES_BASELINE = 101_451;

const originalDescribe = global.describe;
(global as typeof global & { describe: typeof describe }).describe = ((_: string, __: () => void) =>
	undefined) as typeof describe;
const fixtureModule = require("./coverage-lexical-automation-benchmark.bench") as {
	createAutomationCorpus(): {
		documents: IndexedDocument[];
		queryCases: Array<{ query: string; relevantPath: string }>;
	};
};
(global as typeof global & { describe: typeof describe }).describe = originalDescribe;

function normalize(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

function tokenize(text: string): string[] {
	return normalize(text).match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
}

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))];
}

function buildPreparedDocument(document: IndexedDocument): CoverageLexicalV2PreparedDocument {
	const basenameText = document.basename ?? "";
	const aliasesText = document.aliases ?? "";
	const headingsText = document.headings ?? "";
	const folderText = document.folder ?? "";
	const tagsText = document.tags ?? "";
	const bodyText = document.content ?? "";
	const bodyTokens = tokenize(bodyText);
	return {
		path: document.path,
		generation: 1,
		indexedRef: {
			path: document.path,
			generation: 1,
			size: Buffer.byteLength(bodyText, "utf8"),
		},
		record: {
			path: document.path,
			stableDeterministicKey: document.path,
			basenameText,
			aliasesText,
			headingsText,
			folderText,
			tagsText,
		},
		exactTermsByField: {
			basename: dedupe(tokenize(basenameText)),
			aliases: dedupe(tokenize(aliasesText)),
			headings: dedupe(tokenize(headingsText)),
			folder: dedupe(tokenize(folderText)),
			tag: dedupe(tokenize(tagsText)),
			body: dedupe(bodyTokens),
		},
		metadataHanBigramsByField: {
			basename: dedupe(extractHanBigrams(basenameText)),
			aliases: dedupe(extractHanBigrams(aliasesText)),
			headings: dedupe(extractHanBigrams(headingsText)),
			folder: dedupe(extractHanBigrams(folderText)),
			tag: dedupe(
				splitCoverageLexicalTagValues(tagsText).flatMap((tagValue) =>
					extractHanBigrams(tagValue),
				),
			),
		},
		bodyHanSegments: extractHanSegments(bodyText),
		bodyTokens,
	};
}

describe("coverage lexical v2 size acceptance", () => {
	test("automation corpus resident bytes stay below the legacy-coupled live baseline", () => {
		const { documents } = fixtureModule.createAutomationCorpus();
		const store = new CoverageLexicalV2IndexStore();
		for (const document of documents) {
			store.replaceDocument(buildPreparedDocument(document));
		}
		store.compactOverlayIntoSegment(true);

		const breakdown = store.buildIndexBreakdown();
		const residentBytes =
			breakdown.estimatedBytes.total - breakdown.estimatedBytes.bodyTokenSidecar;
		const summary = {
			documentCount: breakdown.documentCount,
			segmentCount: breakdown.segmentCount,
			residentBytes,
			coldBytes: breakdown.estimatedBytes.bodyTokenSidecar,
			totalBytes: breakdown.estimatedBytes.total,
			documentViewBytes: breakdown.estimatedBytes.documentView,
			latinExpansionLexiconBytes:
				breakdown.estimatedBytes.latinExpansionLexicon,
			exactIncidenceBytes: breakdown.estimatedBytes.exactIncidence,
			metadataHanGateBytes: breakdown.estimatedBytes.metadataHanGate,
			bodyHanVerificationViewBytes:
				breakdown.estimatedBytes.bodyHanVerificationView,
			legacyCoupledLiveBytesBaseline:
				LEGACY_COUPLED_AUTOMATION_LIVE_BYTES_BASELINE,
		};

		if (process.env.COVERAGE_LEXICAL_V2_WRITE_BREAKDOWN_PATH) {
			const outputPath = path.resolve(
				process.cwd(),
				process.env.COVERAGE_LEXICAL_V2_WRITE_BREAKDOWN_PATH,
			);
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf8");
		}

		console.log(
			"[coverage-lexical-v2-size-acceptance]",
			JSON.stringify(summary, null, 2),
		);

		expect(breakdown.documentCount).toBeGreaterThanOrEqual(80);
		expect(breakdown.estimatedBytes.bodyTokenSidecar).toBeGreaterThan(0);
		expect(residentBytes).toBeLessThan(LEGACY_COUPLED_AUTOMATION_LIVE_BYTES_BASELINE);
	});
});
