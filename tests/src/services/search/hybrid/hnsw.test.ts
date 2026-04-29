import { HnswIndex } from "src/services/search/hybrid/hnsw";
import type { StoredVector } from "src/services/search/hybrid/hybrid-types";

function int8Vector(values: number[], scale = 1): StoredVector {
	return {
		precision: "int8",
		vector: Int8Array.from(values),
		scale,
	};
}

describe("HnswIndex runtime stats", () => {
	test("orders int8 vectors by dequantized cosine when scales differ", () => {
		const index = new HnswIndex("int8");
		index.insert(1, int8Vector([64, 0], 1));
		index.insert(2, int8Vector([10, 127], 0.001));

		const results = index.search(int8Vector([127, 0], 1), 2, 8);

		expect(results.map((result) => result.id)).toEqual([1, 2]);
		expect(results[0].score).toBeGreaterThan(0.5);
		expect(results[1].score).toBeLessThan(0.001);
	});

	test("reports hydrated vector count separately from graph nodes", () => {
		const index = new HnswIndex("int8");
		index.insert(1, int8Vector([127, 0, 0]));
		index.insert(2, int8Vector([0, 127, 0]));

		index.hydrateVectors([
			{ id: 1, vector: int8Vector([127, 0, 0]) },
			{ id: 2, vector: int8Vector([0, 127, 0]) },
			{ id: 3, vector: int8Vector([0, 0, 127]) },
		]);

		expect(index.getRuntimeStats()).toMatchObject({
			nodeCount: 2,
			deletedNodeCount: 0,
			liveNodeCount: 2,
			vectorCount: 2,
			precision: "int8",
		});
	});

	test("excludes deleted nodes from live node count", () => {
		const index = new HnswIndex("int8");
		index.insert(1, int8Vector([127, 0, 0]));
		index.insert(2, int8Vector([0, 127, 0]));

		index.delete(1);

		expect(index.getRuntimeStats()).toMatchObject({
			nodeCount: 2,
			deletedNodeCount: 1,
			liveNodeCount: 1,
			vectorCount: 1,
		});
	});
});
