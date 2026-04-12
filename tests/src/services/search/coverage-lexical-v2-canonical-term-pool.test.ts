import {
	createCoverageLexicalV2CanonicalTermPool,
	decodeCoverageLexicalV2CanonicalTerm,
	estimateCoverageLexicalV2CanonicalTermPoolBytes,
	findCoverageLexicalV2CanonicalTermId,
	getCoverageLexicalV2CanonicalTermByteLength,
	getCoverageLexicalV2CanonicalTermCount,
	internCoverageLexicalV2CanonicalTerm,
	restoreCoverageLexicalV2CanonicalTermPool,
	serializeCoverageLexicalV2CanonicalTermPool,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-canonical-term-pool";

describe("CoverageLexicalV2CanonicalTermPool", () => {
	test("derives term byte lengths from adjacent offsets", () => {
		const pool = createCoverageLexicalV2CanonicalTermPool();
		const alphaId = internCoverageLexicalV2CanonicalTerm(pool, "alpha");
		const hanId = internCoverageLexicalV2CanonicalTerm(pool, "中文");
		const omegaId = internCoverageLexicalV2CanonicalTerm(pool, "omega");

		expect(alphaId).toBe(0);
		expect(hanId).toBe(1);
		expect(omegaId).toBe(2);
		expect(getCoverageLexicalV2CanonicalTermCount(pool)).toBe(3);
		expect(getCoverageLexicalV2CanonicalTermByteLength(pool, alphaId)).toBe(5);
		expect(getCoverageLexicalV2CanonicalTermByteLength(pool, hanId)).toBe(6);
		expect(getCoverageLexicalV2CanonicalTermByteLength(pool, omegaId)).toBe(5);
		expect(decodeCoverageLexicalV2CanonicalTerm(pool, alphaId)).toBe("alpha");
		expect(decodeCoverageLexicalV2CanonicalTerm(pool, hanId)).toBe("中文");
		expect(decodeCoverageLexicalV2CanonicalTerm(pool, omegaId)).toBe("omega");
	});

	test("serializes and restores without persisted term byte lengths", () => {
		const pool = createCoverageLexicalV2CanonicalTermPool();
		internCoverageLexicalV2CanonicalTerm(pool, "alpha");
		internCoverageLexicalV2CanonicalTerm(pool, "beta");
		internCoverageLexicalV2CanonicalTerm(pool, "中文");

		const snapshot = serializeCoverageLexicalV2CanonicalTermPool(pool);
		expect("termByteLengths" in snapshot).toBe(false);

		const restored = createCoverageLexicalV2CanonicalTermPool();
		restoreCoverageLexicalV2CanonicalTermPool(restored, snapshot);

		expect(findCoverageLexicalV2CanonicalTermId(restored, "alpha")).toBe(0);
		expect(findCoverageLexicalV2CanonicalTermId(restored, "beta")).toBe(1);
		expect(findCoverageLexicalV2CanonicalTermId(restored, "中文")).toBe(2);
		expect(decodeCoverageLexicalV2CanonicalTerm(restored, 2)).toBe("中文");
	});

	test("widens packed offsets when the arena exceeds Uint16 capacity", () => {
		const pool = createCoverageLexicalV2CanonicalTermPool();
		const largeTerm = "a".repeat(70_000);
		internCoverageLexicalV2CanonicalTerm(pool, largeTerm);
		internCoverageLexicalV2CanonicalTerm(pool, "tail");

		expect((pool as any).termOffsets.widthBytes).toBe(4);
		expect(findCoverageLexicalV2CanonicalTermId(pool, largeTerm)).toBe(0);
		expect(findCoverageLexicalV2CanonicalTermId(pool, "tail")).toBe(1);
		expect(estimateCoverageLexicalV2CanonicalTermPoolBytes(pool)).toBe(
			pool.arenaLength + 2 * 4,
		);
	});

	test("packed hash directory handles hash collisions without losing exact lookup", () => {
		const pool = createCoverageLexicalV2CanonicalTermPool();
		const first = "gwzx";
		const second = "16cd";

		expect(first).not.toBe(second);
		internCoverageLexicalV2CanonicalTerm(pool, first);
		internCoverageLexicalV2CanonicalTerm(pool, second);

		expect(findCoverageLexicalV2CanonicalTermId(pool, first)).toBe(0);
		expect(findCoverageLexicalV2CanonicalTermId(pool, second)).toBe(1);
		expect(decodeCoverageLexicalV2CanonicalTerm(pool, 0)).toBe(first);
		expect(decodeCoverageLexicalV2CanonicalTerm(pool, 1)).toBe(second);
		expect((pool as any).termHashDirectory.bucketHeads).toBeInstanceOf(
			Int32Array,
		);
		expect((pool as any).termHashDirectory.nextTermIds).toBeInstanceOf(
			Int32Array,
		);
	});
});
