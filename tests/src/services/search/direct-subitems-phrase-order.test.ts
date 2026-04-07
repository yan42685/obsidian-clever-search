import { buildDirectSubitemsExactCandidates } from "src/services/search/coverage-lexical/direct-subitems";

describe("direct subitems phrase order ranking", () => {
	test("prefers exact Han phrase order over reordered exact character coverage", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "\u515a\u7684\u9886\u5bfc",
			snapshotText: [
				"\u6700\u5927\u6cd5\u5b9d\uff1a\u515a\u9886\u5bfc\u7684\u5236\u5ea6\u4f18\u52bf",
				"\u6700\u5927\u4fdd\u8bc1\uff1a\u515a\u7684\u9886\u5bfc",
			].join("\n"),
			options: {
				mergeGap: 4,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
			},
		});

		expect(result.renderPayloads).toHaveLength(2);
		expect(result.renderPayloads[0].text).toContain("\u515a\u7684\u9886\u5bfc");
		expect(result.renderPayloads[1].text).toContain("\u515a\u9886\u5bfc\u7684");
		expect(result.candidateSpans[0].score).toMatchObject({
			coverageCount: 4,
			exactCount: 4,
			rawPhraseExactCount: 1,
			phraseExactPairCount: 3,
			orderedExactPairCount: 3,
		});
		expect(result.candidateSpans[1].score).toMatchObject({
			coverageCount: 4,
			exactCount: 4,
			rawPhraseExactCount: 0,
			phraseExactPairCount: 1,
			orderedExactPairCount: 2,
		});
	});
});