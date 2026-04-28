import type { IndexedDocument } from "src/globals/search-types";
import {
	buildResidentHotBaseArtifactsStreaming,
	type ResidentColdEvidenceSink,
} from "src/services/search/coverage-lexical-v3/build";
import type {
	LexicalHanBodyEvidenceRow,
	LexicalHanDocEvidenceRow,
} from "src/services/database/database";
import type { LexicalBodyEvidencePublishRow } from "src/services/search/shared/file-snapshot-store";

type CapturedColdEvidence = {
	body: LexicalBodyEvidencePublishRow[];
	hanDoc: LexicalHanDocEvidenceRow[];
	hanBody: LexicalHanBodyEvidenceRow[];
};

function createSink(captured: CapturedColdEvidence): ResidentColdEvidenceSink {
	return {
		publishBodyEvidence: async (rows) => {
			captured.body.push(...rows);
		},
		publishHanDocEvidence: async (rows) => {
			captured.hanDoc.push(...rows);
		},
		publishHanBodyEvidence: async (rows) => {
			captured.hanBody.push(...rows);
		},
	};
}

function normalizeForComparison(value: unknown): unknown {
	if (ArrayBuffer.isView(value)) {
		return Array.from(value as unknown as ArrayLike<number>);
	}
	if (Array.isArray(value)) {
		return value.map(normalizeForComparison);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [
				key,
				normalizeForComparison(child),
			]),
		);
	}
	return value;
}

function createDocuments(): IndexedDocument[] {
	return [
		{
			path: "zeta/large.md",
			docRef: 103,
			generation: 7,
			size: 120,
			basename: "large",
			folder: "zeta",
			aliases: "project token\n项目令牌",
			tags: "security/pod",
			headings: "Projected secrets",
			content:
				"Projected secrets and tokens in a pod\n\n" +
				"容器 启动 令牌 投射\n\n" +
				"restore snapshot evidence",
		},
		{
			path: "alpha/small.md",
			docRef: 101,
			generation: 3,
			size: 40,
			basename: "small",
			folder: "alpha",
			aliases: "startup restore",
			tags: "search/index camelCaseTag",
			headings: "Coverage V3 lowMemoryMode",
			content: "coverage lexical v3\n\n分批 索引 内存\n\npod-security projected-token",
		},
		{
			path: "beta/mixed.md",
			docRef: 102,
			generation: 5,
			size: 70,
			basename: "mixed",
			folder: "beta",
			aliases: "han bigram hydrateCandidateEvidence",
			tags: "中文/search route-anchor",
			headings: "Hydrate candidate evidence",
			content: "hydrate candidate evidence by shard\n\n中文 搜索 召回",
		},
	] as IndexedDocument[];
}

describe("coverage lexical v3 segmented builder", () => {
	test("keeps resident artifacts and cold evidence independent of batch cap", async () => {
		const documents = createDocuments();
		const largeBatchEvidence: CapturedColdEvidence = {
			body: [],
			hanDoc: [],
			hanBody: [],
		};
		const tinyBatchEvidence: CapturedColdEvidence = {
			body: [],
			hanDoc: [],
			hanBody: [],
		};

		const largeBatch = await buildResidentHotBaseArtifactsStreaming(
			documents,
			undefined,
			createSink(largeBatchEvidence),
			{ batchRawTextByteCap: 1024 * 1024 },
		);
		const tinyBatch = await buildResidentHotBaseArtifactsStreaming(
			documents,
			undefined,
			createSink(tinyBatchEvidence),
			{ batchRawTextByteCap: 1 },
		);

		expect(normalizeForComparison(tinyBatch.base)).toEqual(
			normalizeForComparison(largeBatch.base),
		);
		expect(normalizeForComparison(tinyBatch.fuzzyRescueIndex)).toEqual(
			normalizeForComparison(largeBatch.fuzzyRescueIndex),
		);
		expect(normalizeForComparison(tinyBatchEvidence)).toEqual(
			normalizeForComparison(largeBatchEvidence),
		);
		expect(tinyBatch.batchMaxRawTextBytes).toBeGreaterThan(0);
		expect(tinyBatch.batchMaxRawTextBytes).toBeLessThanOrEqual(
			Math.max(...documents.map((document) => document.size ?? 0)),
		);
	});
});
