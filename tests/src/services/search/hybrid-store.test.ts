import { blobToBm25, bm25ToBlob } from "src/services/search/hybrid/hybrid-store";
import type { BM25Index } from "src/services/search/hybrid/hybrid-types";

describe("hybrid BM25 storage", () => {
	test("round-trips binary BM25 blobs", async () => {
		const index: BM25Index = {
			termDict: {
				alpha: { termId: 1, df: 2 },
				beta: { termId: 3, df: 1 },
			},
			postings: {
				1: {
					entries: [
						{ docId: 10, tfNorm: 1.25, positions: [0, 2, 4] },
						{ docId: 20, tfNorm: 0.75, positions: [1] },
					],
				},
				3: {
					entries: [
						{ docId: 10, tfNorm: 0.5, positions: [3, 2] },
					],
				},
			},
			docCount: 2,
			avgDocLen: 17.5,
			docLengths: {
				10: 18,
				20: 17,
			},
		};

		const blob = bm25ToBlob(index);
		expect(blob.type).toBe("application/octet-stream");

		await expect(blobToBm25(blob)).resolves.toEqual(index);
	});

	test("rejects legacy JSON BM25 blobs after schema upgrade", async () => {
		const blob = new Blob(["{\"legacy\":true}"], {
			type: "application/json",
		});

		await expect(blobToBm25(blob)).rejects.toThrow("Unsupported BM25 blob format");
	});
});
