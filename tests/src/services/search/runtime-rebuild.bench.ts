import { container } from "tsyringe";

jest.mock(
	"electron",
	() => ({
		app: { getPath: () => "mockedPath" },
		remote: {
			app: { getPath: () => "mockedPath" },
		},
	}),
	{ virtual: true },
);

jest.mock("src/services/search/tokenizer", () => {
	class MockTokenizer {
		tokenize(text: string): string[] {
			return Array.from(new Set(this.tokenizeSequence(text)));
		}

		tokenizeSequence(text: string): string[] {
			return text
				.toLowerCase()
				.split(/[^a-z0-9_-]+/g)
				.filter((term) => term.length >= 2);
		}
	}

	return { Tokenizer: MockTokenizer };
});

type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

type HeadingOutlineEntry = {
	line: number;
	level: number;
	title: string;
};

type SyntheticFile = {
	path: string;
	plainText: string;
	indexedDocument: IndexedDocument;
	headingOutline: HeadingOutlineEntry[];
};

type PreparedChunk = {
	id: number;
	filePath: string;
	chunkIndex: number;
	text: string;
	startOffset: number;
	endOffset: number;
	startLine: number;
	startCol: number;
	endLine: number;
	embedKey: string;
	embeddingInput: string;
};

type StageMetric = {
	stage: string;
	ms: number;
	perItemMs?: number;
};

const FILE_COUNT = 180;
const SECTION_COUNT = 7;
const PARAGRAPH_LINES = 9;
const VECTOR_DIM = 96;
const LEXICAL_BATCH_SIZE = 64;

jest.setTimeout(180_000);

describe("runtime rebuild benchmark", () => {
	beforeAll(() => {
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "en"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
		(global as any).alert = jest.fn();
	});

	afterAll(() => {
		delete (global as any).window;
		delete (global as any).alert;
	});

	test("prints local-only rebuild timings", async () => {
		resetContainer();

		const {
			OuterSetting,
			DEFAULT_OUTER_SETTING,
		} = require("src/globals/plugin-setting");
		const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
		setting.enableChinesePatch = false;
		setting.enableStopWordsZh = false;
		setting.enableStopWordsEn = false;
		container.register(OuterSetting, { useValue: setting });

		const { MiniSearchFileEngine, CustomFileSearchEngine } = require(
			"src/services/search/file-search-engine",
		);
		const { BM25Engine } = require("src/services/search/hybrid/bm25");
		const { chunkFile, createChunkEmbeddingInputBuilder } = require(
			"src/services/search/hybrid/chunker",
		);
		const { HnswIndex } = require("src/services/search/hybrid/hnsw");
		const {
			analyzeHybridStoredFileConsistency,
		} = require("src/services/search/hybrid/hybrid-consistency");
		const {
			bm25ToBlob,
			blobToBm25,
			hnswToBlob,
			blobToHnsw,
			buildChunkVectorShard,
			chunkVectorShardToRow,
			rowToChunkVectorRecords,
			chunkToRow,
			rowToChunk,
		} = require("src/services/search/hybrid/hybrid-store");

		const corpus = buildSyntheticCorpus(FILE_COUNT);
		const stages: StageMetric[] = [];

		const mini = new MiniSearchFileEngine();
		await recordStage(stages, "lexical.rebuild.minisearch", corpus.files.length, async () => {
			await rebuildLexicalInBatches(mini, corpus.documents, LEXICAL_BATCH_SIZE);
		});

		const custom = new CustomFileSearchEngine();
		await recordStage(stages, "lexical.rebuild.custom-bm25", corpus.files.length, async () => {
			await rebuildLexicalInBatches(custom, corpus.documents, LEXICAL_BATCH_SIZE);
		});

		let preparedChunks: PreparedChunk[] = [];
		await recordStage(stages, "hybrid.chunk.prepare", corpus.files.length, async () => {
			preparedChunks = prepareChunks(
				corpus.files,
				chunkFile,
				createChunkEmbeddingInputBuilder,
			);
		});

		const bm25 = new BM25Engine();
		await recordStage(stages, "hybrid.bm25.build", preparedChunks.length, async () => {
			for (const chunk of preparedChunks) {
				bm25.addDocument(chunk.id, chunk.text);
			}
		});

		const hnsw = new HnswIndex("int8");
		const chunkRows = preparedChunks.map((chunk) => chunkToRow(chunk));
		const snapshotRows = corpus.files.map((file, index) => ({
			filePath: file.path,
			plainText: file.plainText,
			generation: index + 1,
		}));
		let vectorShards: any[] = [];

		await recordStage(stages, "hybrid.vector-hnsw.build", preparedChunks.length, async () => {
			vectorShards = buildHybridVectorsAndGraph(
				corpus.files,
				preparedChunks,
				hnsw,
				buildChunkVectorShard,
			);
		});

		let bm25Blob: Blob;
		let hnswBlob: Blob;
		let shardRows: any[] = [];
		await recordStage(stages, "hybrid.persist.serialize", preparedChunks.length, async () => {
			bm25Blob = bm25ToBlob(bm25.serialize());
			hnswBlob = hnswToBlob(hnsw.serialize());
			shardRows = vectorShards.map((shard) => chunkVectorShardToRow(shard));
		});

		let restoredChunkCount = 0;
		let restoredVectorCount = 0;
		await recordStage(stages, "hybrid.hydrate.deserialize", preparedChunks.length, async () => {
			const restoredBm25 = await blobToBm25(bm25Blob!);
			const hydratedBm25 = new BM25Engine();
			hydratedBm25.deserialize(restoredBm25);

			const restoredHnswData = await blobToHnsw(hnswBlob!);
			const hydratedHnsw = new HnswIndex("int8");
			hydratedHnsw.deserialize(restoredHnswData);

			for (let index = 0; index < shardRows.length; index++) {
				const restoredVectors = await rowToChunkVectorRecords(shardRows[index]);
				hydratedHnsw.hydrateVectors(restoredVectors, {
					append: index > 0,
				});
				restoredVectorCount += restoredVectors.length;
			}

			const snapshotByPath = new Map(
				snapshotRows.map((row) => [row.filePath, row.plainText] as const),
			);
			restoredChunkCount = chunkRows
				.map((row) => rowToChunk(row, snapshotByPath.get(row.filePath) ?? ""))
				.filter((chunk) => chunk.text.length > 0).length;
		});

		let repairCount = 0;
		await recordStage(stages, "hybrid.self-heal.analyze", corpus.files.length, async () => {
			repairCount = analyzeSyntheticConsistency(
				corpus.files,
				preparedChunks,
				analyzeHybridStoredFileConsistency,
			);
		});

		console.info(
			`[runtime-rebuild-benchmark] local only; no embedding/rerank API calls; files=${corpus.files.length}, chunks=${preparedChunks.length}, chars=${corpus.totalChars}`,
		);
		console.info(
			`[runtime-rebuild-benchmark] serialized bytes: bm25=${bm25Blob!.size}, hnsw=${hnswBlob!.size}, vectorShards=${sumBlobBytes(shardRows)}`,
		);
		console.info(
			`[runtime-rebuild-benchmark] hydrate sanity: restoredChunks=${restoredChunkCount}, restoredVectors=${restoredVectorCount}, repairCount=${repairCount}`,
		);
		console.table(
			stages.map((stage) => ({
				stage: stage.stage,
				ms: Number(stage.ms.toFixed(1)),
				perItemMs:
					stage.perItemMs === undefined
						? "-"
						: Number(stage.perItemMs.toFixed(4)),
			})),
		);

		expect(preparedChunks.length).toBeGreaterThan(corpus.files.length);
		expect(restoredChunkCount).toBe(preparedChunks.length);
		expect(restoredVectorCount).toBe(preparedChunks.length);
		expect(repairCount).toBeGreaterThan(0);
	});
});

function resetContainer(): void {
	if ("reset" in container && typeof (container as any).reset === "function") {
		(container as any).reset();
		return;
	}
	container.clearInstances();
}

async function recordStage(
	stages: StageMetric[],
	stage: string,
	itemCount: number,
	fn: () => Promise<void>,
): Promise<void> {
	const start = performance.now();
	await fn();
	const ms = performance.now() - start;
	stages.push({
		stage,
		ms,
		perItemMs: itemCount > 0 ? ms / itemCount : undefined,
	});
}

async function rebuildLexicalInBatches(
	engine: { clearIndex(): void; addDocuments(documents: IndexedDocument[]): Promise<void> },
	documents: IndexedDocument[],
	batchSize: number,
): Promise<void> {
	engine.clearIndex();
	for (let start = 0; start < documents.length; start += batchSize) {
		await engine.addDocuments(documents.slice(start, start + batchSize));
	}
}

function buildSyntheticCorpus(fileCount: number): {
	files: SyntheticFile[];
	documents: IndexedDocument[];
	totalChars: number;
} {
	const rng = createRng(20260322);
	const folders = ["projects", "research", "daily", "specs", "labs", "reviews"];
	const topics = [
		"calendar",
		"dataview",
		"plugin",
		"retrieval",
		"ranking",
		"chunking",
		"embedding",
		"vector",
		"lexical",
		"hybrid",
		"workflow",
		"design",
	];
	const qualities = [
		"stable",
		"adaptive",
		"incremental",
		"lightweight",
		"semantic",
		"local",
		"robust",
		"layered",
	];
	const fillers = [
		"cache",
		"buffer",
		"signal",
		"context",
		"window",
		"fallback",
		"repair",
		"storage",
		"index",
		"query",
		"result",
		"evidence",
		"heading",
		"snippet",
		"latency",
		"consistency",
		"stream",
		"session",
	];

	const files: SyntheticFile[] = [];
	let totalChars = 0;

	for (let index = 0; index < fileCount; index++) {
		const folder = pick(rng, folders);
		const topic = pick(rng, topics);
		const secondaryTopic = pick(rng, topics.filter((item) => item !== topic));
		const quality = pick(rng, qualities);
		const basename = `${topic}-${quality}-${index}`;
		const path = `${folder}/${basename}.md`;
		const title = `${capitalize(topic)} ${capitalize(quality)} Notes ${index}`;
		const alias = `${topic} ${quality} memo ${index}`;
		const tags = `${topic} ${secondaryTopic} ${quality}`;
		const headingOutline: HeadingOutlineEntry[] = [];
		const lines: string[] = [`# ${title}`, ""];
		headingOutline.push({ line: 0, level: 1, title });

		for (let section = 0; section < SECTION_COUNT; section++) {
			const sectionTopic = pick(rng, topics);
			const sectionTitle = `${capitalize(sectionTopic)} ${capitalize(
				pick(rng, qualities),
			)} ${section}`;
			headingOutline.push({
				line: lines.length,
				level: 2,
				title: sectionTitle,
			});
			lines.push(`## ${sectionTitle}`);
			for (let paragraphLine = 0; paragraphLine < PARAGRAPH_LINES; paragraphLine++) {
				lines.push(
					buildSentence(rng, [
						title,
						sectionTitle,
						alias,
						topic,
						secondaryTopic,
						quality,
						`id${index}`,
						`section${section}`,
						...fillers,
					]),
				);
			}
			lines.push("");
		}

		const plainText = lines.join("\n");
		totalChars += plainText.length;
		files.push({
			path,
			plainText,
			headingOutline,
			indexedDocument: {
				path,
				basename,
				folder,
				content: plainText,
				aliases: alias,
				tags,
				headings: headingOutline.map((entry) => entry.title).join(" "),
			},
		});
	}

	return {
		files,
		documents: files.map((file) => file.indexedDocument),
		totalChars,
	};
}

function prepareChunks(
	files: SyntheticFile[],
	chunkFile: (filePath: string, plainText: string) => { chunks: Array<any> },
	createChunkEmbeddingInputBuilder: (
		filePath: string,
		plainText: string,
		headingOutline?: HeadingOutlineEntry[],
	) => (chunk: any) => string,
): PreparedChunk[] {
	let nextChunkId = 1;
	const preparedChunks: PreparedChunk[] = [];

	for (const file of files) {
		const { chunks } = chunkFile(file.path, file.plainText);
		const buildEmbeddingInput = createChunkEmbeddingInputBuilder(
			file.path,
			file.plainText,
			file.headingOutline,
		);
		for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
			const chunk = chunks[chunkIndex];
			preparedChunks.push({
				id: nextChunkId++,
				filePath: file.path,
				chunkIndex,
				text: chunk.text,
				startOffset: chunk.startOffset,
				endOffset: chunk.endOffset,
				startLine: chunk.startLine,
				startCol: chunk.startCol,
				endLine: chunk.endLine,
				embedKey: `${file.path}:${chunk.startOffset}:${chunk.endOffset}`,
				embeddingInput: buildEmbeddingInput(chunk),
			});
		}
	}

	return preparedChunks;
}

function buildHybridVectorsAndGraph(
	files: SyntheticFile[],
	preparedChunks: PreparedChunk[],
	hnsw: { insert(id: number, vector: any): void },
	buildChunkVectorShard: (
		filePath: string,
		chunkIds: number[],
		vectors: any[],
		dim: number,
	) => any,
): any[] {
	const chunkIdsByFile = new Map<string, number[]>();
	const vectorsByFile = new Map<string, any[]>();

	withSeededRandom(17, () => {
		for (const chunk of preparedChunks) {
			const vector = buildMockInt8Vector(chunk.embeddingInput, VECTOR_DIM);
			hnsw.insert(chunk.id, vector);

			if (!chunkIdsByFile.has(chunk.filePath)) {
				chunkIdsByFile.set(chunk.filePath, []);
				vectorsByFile.set(chunk.filePath, []);
			}
			chunkIdsByFile.get(chunk.filePath)!.push(chunk.id);
			vectorsByFile.get(chunk.filePath)!.push(vector);
		}
	});

	return files
		.map((file) => {
			const chunkIds = chunkIdsByFile.get(file.path) ?? [];
			const vectors = vectorsByFile.get(file.path) ?? [];
			if (chunkIds.length === 0) {
				return null;
			}
			return buildChunkVectorShard(file.path, chunkIds, vectors, VECTOR_DIM);
		})
		.filter((shard): shard is any => shard !== null);
}

function analyzeSyntheticConsistency(
	files: SyntheticFile[],
	preparedChunks: PreparedChunk[],
	analyzeHybridStoredFileConsistency: (input: any) => { repairReasons: string[] },
): number {
	const chunkCounts = new Map<string, number>();
	for (const chunk of preparedChunks) {
		chunkCounts.set(chunk.filePath, (chunkCounts.get(chunk.filePath) ?? 0) + 1);
	}

	let repairCount = 0;
	for (let index = 0; index < files.length; index++) {
		const file = files[index];
		const chunkCount = chunkCounts.get(file.path) ?? 0;
		const input =
			index % 11 === 0
				? {
						existsInVault: true,
						hasChunks: true,
						chunkCount,
						snapshot: { generation: index + 1 },
						vectorInfo: undefined,
						indexedFileRef: {
							path: file.path,
							updateTime: index,
							state: "ready",
							chunkCount,
							generation: index + 1,
							vectorPrecision: "int8",
						},
						currentPrecision: "int8",
					}
				: index % 13 === 0
				? {
						existsInVault: false,
						hasChunks: true,
						chunkCount,
						snapshot: { generation: index + 1 },
						vectorInfo: { precision: "int8", chunkCount, generation: index + 1 },
						indexedFileRef: {
							path: file.path,
							updateTime: index,
							state: "ready",
							chunkCount,
							generation: index + 1,
							vectorPrecision: "int8",
						},
						currentPrecision: "int8",
					}
				: index % 17 === 0
				? {
						existsInVault: true,
						hasChunks: true,
						chunkCount,
						snapshot: { generation: index + 2 },
						vectorInfo: { precision: "float16", chunkCount, generation: index + 1 },
						indexedFileRef: {
							path: file.path,
							updateTime: index,
							state: "ready",
							chunkCount,
							generation: index + 1,
							vectorPrecision: "int8",
						},
						currentPrecision: "int8",
					}
				: {
						existsInVault: true,
						hasChunks: true,
						chunkCount,
						snapshot: { generation: index + 1 },
						vectorInfo: { precision: "int8", chunkCount, generation: index + 1 },
						indexedFileRef: {
							path: file.path,
							updateTime: index,
							state: "ready",
							chunkCount,
							generation: index + 1,
							vectorPrecision: "int8",
						},
						currentPrecision: "int8",
					};

		if (analyzeHybridStoredFileConsistency(input).repairReasons.length > 0) {
			repairCount++;
		}
	}

	return repairCount;
}

function buildMockInt8Vector(text: string, dim: number): {
	precision: "int8";
	vector: Int8Array;
	scale: number;
} {
	const values = new Array<number>(dim).fill(0);
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
		const index = (hash >>> 0) % dim;
		const sign = (hash & 1) === 0 ? 1 : -1;
		values[index] += sign * (1 + ((hash >>> 8) % 7) / 10);
	}

	let norm = 0;
	for (const value of values) {
		norm += value * value;
	}
	norm = Math.sqrt(norm) || 1;
	for (let i = 0; i < values.length; i++) {
		values[i] /= norm;
	}

	let maxAbs = 0;
	for (const value of values) {
		maxAbs = Math.max(maxAbs, Math.abs(value));
	}
	const scale = maxAbs < 1e-10 ? 1 : maxAbs;
	const vector = new Int8Array(values.length);
	for (let i = 0; i < values.length; i++) {
		vector[i] = Math.round((values[i] / scale) * 127);
	}

	return {
		precision: "int8",
		vector,
		scale,
	};
}

function withSeededRandom(seed: number, fn: () => void): void {
	const originalRandom = Math.random;
	const rng = createRng(seed);
	Math.random = () => rng();
	try {
		fn();
	} finally {
		Math.random = originalRandom;
	}
}

function createRng(seed: number): () => number {
	let value = seed >>> 0;
	return () => {
		value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
		return value / 0xffffffff;
	};
}

function pick<T>(rng: () => number, values: T[]): T {
	return values[Math.floor(rng() * values.length)];
}

function buildSentence(rng: () => number, vocabulary: string[]): string {
	const words: string[] = [];
	const length = 18 + Math.floor(rng() * 10);
	for (let index = 0; index < length; index++) {
		words.push(pick(rng, vocabulary));
	}
	return words.join(" ") + ".";
}

function capitalize(value: string): string {
	return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function sumBlobBytes(rows: Array<{ chunkIds: Blob; vectorData: Blob; scaleData?: Blob }>): number {
	return rows.reduce(
		(total, row) =>
			total +
			row.chunkIds.size +
			row.vectorData.size +
			(row.scaleData?.size ?? 0),
		0,
	);
}
