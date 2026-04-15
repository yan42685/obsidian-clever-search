import {
	buildIntegerArray,
	describeIntegerSection,
	sentinelStartsEncodingFlag,
	sliceSentinelBucket,
} from "src/services/search/coverage-lexical-v3/layout/integer-arrays";

describe("coverage lexical v3 integer arrays", () => {
	test("selects the narrowest safe width for resident integer arrays", () => {
		expect(buildIntegerArray([0, 1, 255])).toBeInstanceOf(Uint8Array);
		expect(buildIntegerArray([0, 256, 65_535])).toBeInstanceOf(Uint16Array);
		expect(buildIntegerArray([0, 65_536])).toBeInstanceOf(Uint32Array);
	});

	test("reads sentinel buckets consistently across integer widths", () => {
		const starts = buildIntegerArray([0, 2, 5]);
		const values = buildIntegerArray([3, 4, 10, 11, 12]);

		expect(sliceSentinelBucket(starts, values, 0)).toEqual([3, 4]);
		expect(sliceSentinelBucket(starts, values, 1)).toEqual([10, 11, 12]);
	});

	test("describes section encodings without depending on a concrete Uint32 contract", () => {
		const section = describeIntegerSection(
			"metadata.identityPostings.starts",
			buildIntegerArray([0, 2, 5]),
			sentinelStartsEncodingFlag(),
		);

		expect(section).toEqual({
			sectionKind: "metadata.identityPostings.starts",
			elementCount: 3,
			valueKind: "u8",
			bytesPerElement: 1,
			encodingFlags: sentinelStartsEncodingFlag(),
		});
	});
});
