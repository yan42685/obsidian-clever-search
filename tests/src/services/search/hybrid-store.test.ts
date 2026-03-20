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
			avgBigChunkLen: 17.5,
			docLengths: {
				10: 18,
				20: 17,
			},
		};

		const blob = bm25ToBlob(index);
		expect(blob.type).toBe("application/octet-stream");

		await expect(blobToBm25(blob)).resolves.toEqual(index);
	});

	test("keeps compatibility with legacy JSON BM25 blobs", async () => {
		const legacyIndex: BM25Index = {
			termDict: {
				query: { termId: 0, df: 1 },
			},
			postings: {
				0: {
					entries: [
						{ docId: 7, tfNorm: 2, positions: [5, 3] },
					],
				},
			},
			docCount: 1,
			avgBigChunkLen: 12,
			docLengths: {
				7: 12,
			},
		};

		const blob = new Blob([JSON.stringify(legacyIndex)], {
			type: "application/json",
		});

		await expect(blobToBm25(blob)).resolves.toEqual(legacyIndex);
	});
});
