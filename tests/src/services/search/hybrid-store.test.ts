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
						{ docId: 10, tfNorm: 1.25 },
						{ docId: 20, tfNorm: 0.75 },
					],
				},
				3: {
					entries: [
						{ docId: 10, tfNorm: 0.5 },
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

		const restored = await blobToBm25(blob);
		expect(restored.docCount).toBe(index.docCount);
		expect(restored.avgDocLen).toBeCloseTo(index.avgDocLen, 5);
		expect(restored.docLengths).toEqual(index.docLengths);
		expect(Object.keys(restored.termDict).sort()).toEqual(Object.keys(index.termDict).sort());
		expect(restored.termDict.alpha.df).toBe(2);
		expect(restored.termDict.beta.df).toBe(1);

		const alphaEntries = restored.postings[restored.termDict.alpha.termId].entries;
		expect(alphaEntries).toHaveLength(2);
		expect(alphaEntries[0].docId).toBe(10);
		expect(alphaEntries[0].positions).toBeUndefined();
		expect(alphaEntries[0].tfNorm).toBeCloseTo(1.25, 2);
		expect(alphaEntries[1].docId).toBe(20);
		expect(alphaEntries[1].positions).toBeUndefined();
		expect(alphaEntries[1].tfNorm).toBeCloseTo(0.75, 2);

		const betaEntries = restored.postings[restored.termDict.beta.termId].entries;
		expect(betaEntries).toHaveLength(1);
		expect(betaEntries[0].docId).toBe(10);
		expect(betaEntries[0].positions).toBeUndefined();
		expect(betaEntries[0].tfNorm).toBeCloseTo(0.5, 2);
	});

	test("rejects legacy JSON BM25 blobs after schema upgrade", async () => {
		const blob = new Blob(["{\"legacy\":true}"], {
			type: "application/json",
		});

		await expect(blobToBm25(blob)).rejects.toThrow("Unsupported BM25 blob format");
	});
});
