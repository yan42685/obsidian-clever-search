import { performance } from "perf_hooks";
import { container } from "tsyringe";
import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentHotBaseArtifactsStreaming } from "src/services/search/coverage-lexical-v3/build";
import { registerProductionTokenizerStartupDependencies } from "./coverage-lexical-v3-startup-production-tokenizer";

jest.mock("src/utils/web/assets-provider", () => ({
	AssetsProvider: class MockAssetsProvider {},
}));

const textEncoder = new TextEncoder();

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function parseTargetMegabytes(): number[] {
	const raw = process.env.COVERAGE_LEXICAL_V3_SYNTHETIC_MB ?? "8";
	return raw
		.split(",")
		.map((value) => Number.parseInt(value.trim(), 10))
		.filter((value) => Number.isFinite(value) && value > 0);
}

function estimateUtf8Bytes(text: string): number {
	return textEncoder.encode(text).byteLength;
}

function createSyntheticDocuments(targetBytes: number): IndexedDocument[] {
	const paragraph = [
		"Projected secrets and tokens in a pod need stable lexical coverage.",
		"Coverage V3 rebuild restore snapshot hydrate candidate evidence.",
		"分批 索引 内存 令牌 投射 搜索 召回 证据。",
		"metadata route basename alias heading body block family posting.",
	].join("\n");
	const content = Array.from({ length: 24 }, () => paragraph).join("\n\n");
	const contentBytes = estimateUtf8Bytes(content);
	const documents: IndexedDocument[] = [];
	let totalBytes = 0;
	for (let index = 0; totalBytes < targetBytes; index += 1) {
		const path = `synthetic/folder-${index % 64}/doc-${index}.md`;
		const document: IndexedDocument = {
			path,
			docRef: index + 1,
			generation: 1,
			size: contentBytes,
			basename: `doc-${index}`,
			folder: `synthetic/folder-${index % 64}`,
			aliases: `projected token ${index}\n分批索引 ${index % 17}`,
			tags: `coverage/v3 synthetic-${index % 31}`,
			headings: `Synthetic Coverage V3 ${index % 11}`,
			content,
		};
		documents.push(document);
		totalBytes += contentBytes;
	}
	return documents;
}

describe("coverage lexical v3 synthetic startup rebuild benchmark", () => {
	test("measure bounded segmented rebuild on synthetic large corpus", async () => {
		await registerProductionTokenizerStartupDependencies("coverage-lexical");
		const { Tokenizer } = require("src/services/search/tokenizer");
		const tokenizer = container.resolve(Tokenizer) as {
			tokenizeSequence(text: string, mode: "index" | "search"): string[];
		};
		for (const targetMb of parseTargetMegabytes()) {
			const targetBytes = targetMb * 1024 * 1024;
			const documents = createSyntheticDocuments(targetBytes);
			let bodyEvidenceRows = 0;
			let hanDocEvidenceRows = 0;
			let hanBodyEvidenceRows = 0;
			const beforeMemory = process.memoryUsage();
			const startedAt = performance.now();
			const artifacts = await buildResidentHotBaseArtifactsStreaming(
				documents,
				(text) => tokenizer.tokenizeSequence(text, "index"),
				{
					publishBodyEvidence: async (rows) => {
						bodyEvidenceRows += rows.length;
					},
					publishHanDocEvidence: async (rows) => {
						hanDocEvidenceRows += rows.length;
					},
					publishHanBodyEvidence: async (rows) => {
						hanBodyEvidenceRows += rows.length;
					},
				},
			);
			const rebuildMs = performance.now() - startedAt;
			const afterMemory = process.memoryUsage();
			console.log(
				"[coverage-lexical-v3-startup-synthetic-benchmark] segmented-rebuild",
				JSON.stringify(
					{
						targetMb,
						noteCount: documents.length,
						totalMarkdownBytes: documents.reduce(
							(sum, document) => sum + (document.size ?? 0),
							0,
						),
						rebuildMs: round(rebuildMs),
						rebuildPhases: {
							batchMaxRawTextBytes: artifacts.batchMaxRawTextBytes,
							pass1Ms: round(artifacts.pass1Ms),
							pass2Ms: round(artifacts.pass2Ms),
							mergeMs: round(artifacts.mergeMs),
							coldEvidenceFlushCount: artifacts.coldEvidenceFlushCount,
							maxColdEvidenceChunkSize: artifacts.maxColdEvidenceChunkSize,
						},
						lexicalResidentRuntime: {
							estimatedResidentIndexBytes: artifacts.base.metrics.residentBytes,
							documentCount: artifacts.base.docTable.docCount,
							familyCount: artifacts.base.familyLexicon.familyCount,
							bodyBlockCount: artifacts.base.bodyBlocks.blockCount,
						},
						coldEvidenceRows: {
							bodyEvidenceRows,
							hanDocEvidenceRows,
							hanBodyEvidenceRows,
						},
						memory: {
							heapUsedBeforeBytes: beforeMemory.heapUsed,
							heapUsedAfterBytes: afterMemory.heapUsed,
							heapUsedDeltaBytes: afterMemory.heapUsed - beforeMemory.heapUsed,
							rssBeforeBytes: beforeMemory.rss,
							rssAfterBytes: afterMemory.rss,
							rssDeltaBytes: afterMemory.rss - beforeMemory.rss,
						},
					},
					null,
					2,
				),
			);
			expect(artifacts.batchMaxRawTextBytes).toBeLessThanOrEqual(
				32 * 1024 * 1024,
			);
			expect(artifacts.base.docTable.docCount).toBe(documents.length);
		}
	});
});
