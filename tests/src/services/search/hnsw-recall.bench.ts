import { HnswIndex } from "src/services/search/hybrid/hnsw";
import type { StoredVector } from "src/services/search/hybrid/hybrid-types";

const DIM = 64;
const DOC_COUNT = 900;
const QUERY_COUNT = 60;
const TOP_K = 25;

type QuantizedVector = Extract<StoredVector, { precision: "int8" }>;

function createRng(seed: number): () => number {
	let value = seed >>> 0;
	return () => {
		value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
		return value / 0xffffffff;
	};
}

function normalize(values: number[]): number[] {
	let norm = 0;
	for (const value of values) {
		norm += value * value;
	}
	norm = Math.sqrt(norm) || 1;
	return values.map((value) => value / norm);
}

function createCenter(rng: () => number): number[] {
	return normalize(
		Array.from({ length: DIM }, () => rng() * 2 - 1),
	);
}

function createNearbyVector(center: number[], rng: () => number): number[] {
	const raw = center.map((value) => value + (rng() * 2 - 1) * 0.12);
	return normalize(raw);
}

function quantizeInt8(values: number[]): QuantizedVector {
	let maxAbs = 0;
	for (const value of values) {
		maxAbs = Math.max(maxAbs, Math.abs(value));
	}
	const scale = maxAbs < 1e-10 ? 1 : maxAbs;
	const vector = new Int8Array(values.length);
	for (let index = 0; index < values.length; index++) {
		vector[index] = Math.round((values[index] / scale) * 127);
	}
	return {
		precision: "int8",
		vector,
		scale,
	};
}

function cosineScore(query: QuantizedVector, candidate: QuantizedVector): number {
	let dot = 0;
	for (let index = 0; index < query.vector.length; index++) {
		dot += query.vector[index] * candidate.vector[index];
	}
	return (dot * query.scale * candidate.scale) / (127 * 127);
}

function buildDataset() {
	const rng = createRng(7);
	const centers = Array.from({ length: 18 }, () => createCenter(rng));
	const docs: Array<{ id: number; vector: QuantizedVector }> = [];
	for (let id = 1; id <= DOC_COUNT; id++) {
		const center = centers[id % centers.length];
		docs.push({
			id,
			vector: quantizeInt8(createNearbyVector(center, rng)),
		});
	}
	const queries: QuantizedVector[] = [];
	for (let index = 0; index < QUERY_COUNT; index++) {
		const center = centers[(index * 3) % centers.length];
		queries.push(quantizeInt8(createNearbyVector(center, rng)));
	}
	return { docs, queries };
}

function exactTopK(
	query: QuantizedVector,
	docs: Array<{ id: number; vector: QuantizedVector }>,
	limit: number,
): number[] {
	return docs
		.map((doc) => ({ id: doc.id, score: cosineScore(query, doc.vector) }))
		.sort((left, right) => right.score - left.score)
		.slice(0, limit)
		.map((item) => item.id);
}

function recallAtK(actual: number[], expected: number[]): number {
	const expectedSet = new Set(expected);
	let hits = 0;
	for (const id of actual) {
		if (expectedSet.has(id)) {
			hits++;
		}
	}
	return hits / Math.max(1, expected.length);
}

describe("HNSW recall", () => {
	test("higher ef improves or preserves approximate recall on clustered vectors", () => {
		const { docs, queries } = buildDataset();
		const index = new HnswIndex("int8");
		for (const doc of docs) {
			index.insert(doc.id, doc.vector);
		}

		let recall40 = 0;
		let recall96 = 0;

		for (const query of queries) {
			const expected = exactTopK(query, docs, TOP_K);
			const actual40 = index.search(query, TOP_K, 40).map((item) => item.id);
			const actual96 = index.search(query, TOP_K, 96).map((item) => item.id);
			recall40 += recallAtK(actual40, expected);
			recall96 += recallAtK(actual96, expected);
		}

		recall40 /= queries.length;
		recall96 /= queries.length;
		console.info(
			`[hnsw-recall] recall@${TOP_K}: ef40=${recall40.toFixed(3)}, ef96=${recall96.toFixed(3)}`,
		);

		expect(recall96).toBeGreaterThanOrEqual(recall40);
		expect(recall96).toBeGreaterThan(0.9);
	});
});
