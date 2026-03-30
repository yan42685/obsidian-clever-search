import {
	buildDirectSubitemsExactCandidates,
	buildDirectSubitemsExactFileSubItems,
	collectDirectSubitemsExactOccurrences,
	compareDirectSubitemsScoreTuples,
	splitDirectSubitemsQueryTerms,
} from "src/services/search/coverage-lexical/direct-subitems";

function collectCoveredOccurrenceKeys(
	spans: ReturnType<typeof buildDirectSubitemsExactCandidates>["candidateSpans"],
): Set<string> {
	return new Set(
		spans.flatMap((span) =>
			span.occurrences.map(
				(occurrence) =>
					`${occurrence.termId}:${occurrence.start}:${occurrence.end}:${occurrence.tier}`,
			),
		),
	);
}

describe("direct subitems v2 exact-only pipeline", () => {
	test("splits query into Han single characters and contiguous non-Han runs", () => {
		const terms = splitDirectSubitemsQueryTerms(
			"上面 foo/bar@v1.2#tag 快速 abc-123",
		);

		expect(
			terms.map((term) => ({
				kind: term.kind,
				rawText: term.rawText,
				normalizedText: term.normalizedText,
			})),
		).toEqual([
			{ kind: "han_char", rawText: "上", normalizedText: "上" },
			{ kind: "han_char", rawText: "面", normalizedText: "面" },
			{
				kind: "non_han_run",
				rawText: "foo/bar@v1.2#tag",
				normalizedText: "foo/bar@v1.2#tag",
			},
			{ kind: "han_char", rawText: "快", normalizedText: "快" },
			{ kind: "han_char", rawText: "速", normalizedText: "速" },
			{
				kind: "non_han_run",
				rawText: "abc-123",
				normalizedText: "abc-123",
			},
		]);
	});

	test("collects every exact occurrence from snapshot text", () => {
		const queryTerms = splitDirectSubitemsQueryTerms("上面 foo/bar@v1.2#tag");
		const snapshotText =
			"上面 foo/bar@v1.2#tag\n夹在中间\n上面 foo/bar@v1.2#tag";

		const occurrences = collectDirectSubitemsExactOccurrences(
			snapshotText,
			queryTerms,
		);

		const byTerm = new Map<string, number>();
		for (const occurrence of occurrences) {
			byTerm.set(occurrence.termId, (byTerm.get(occurrence.termId) ?? 0) + 1);
		}

		expect([...byTerm.values()].sort((left, right) => left - right)).toEqual([
			2, 2, 2,
		]);
		expect(occurrences.length).toBe(6);
	});

	test("keeps nearby exact evidence inside one candidate span", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "上面 快速",
			snapshotText: "前言。这里提到上面这段内容，并且支持快速定位。后文。",
		});

		expect(result.candidateSpans).toHaveLength(1);
		expect(result.candidateSpans[0].score.coverageCount).toBe(4);
		expect(result.candidateSpans[0].termStats.filter((stat) => stat.bestTier === "exact")).toHaveLength(4);
	});

	test("splits distant evidence clusters into multiple candidate spans", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "上面 快速",
			snapshotText:
				"前言里提到上面。这里是很长很长很长很长很长的无关内容，用来拉开距离。最后才出现快速定位。",
			options: {
				mergeGap: 20,
			},
		});

		expect(result.candidateSpans).toHaveLength(2);
		expect(result.candidateSpans.every((span) => span.score.coverageCount === 2)).toBe(true);
	});

	test("does not dedupe distant spans that realize the same term signature", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "上面",
			snapshotText:
				"上面。这里是足够长的间隔内容，用来保证两个命中不会被切到一个窗口里。第二处再次出现上面。",
			options: {
				mergeGap: 16,
			},
		});

		expect(result.candidateSpans).toHaveLength(2);
		expect(result.candidateSpans[0].termSignature).toEqual(
			result.candidateSpans[1].termSignature,
		);
		expect(result.candidateSpans[0].start).not.toBe(result.candidateSpans[1].start);
	});

	test("final candidate spans still cover every exact occurrence", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "上面 foo/bar@v1.2#tag",
			snapshotText:
				"上面 foo/bar@v1.2#tag\n中间有段落\n上面 foo/bar@v1.2#tag\n尾声",
			options: {
				mergeGap: 12,
			},
		});

		const coveredKeys = collectCoveredOccurrenceKeys(result.candidateSpans);
		const exactKeys = new Set(
			result.exactOccurrences.map(
				(occurrence) =>
					`${occurrence.termId}:${occurrence.start}:${occurrence.end}:${occurrence.tier}`,
			),
		);

		expect(coveredKeys).toEqual(exactKeys);
	});

	test("score tuple comparator keeps the strict priority order", () => {
		expect(
			compareDirectSubitemsScoreTuples(
				{
					coverageCount: 3,
					exactCount: 1,
					prefixCount: 2,
					fuzzyCount: 0,
					distancePenaltyTotal: 100,
					distancePenaltyMax: 100,
					spanLength: 100,
					anchorOffset: 50,
				},
				{
					coverageCount: 2,
					exactCount: 2,
					prefixCount: 0,
					fuzzyCount: 0,
					distancePenaltyTotal: 0,
					distancePenaltyMax: 0,
					spanLength: 1,
					anchorOffset: 0,
				},
			),
		).toBeLessThan(0);

		expect(
			compareDirectSubitemsScoreTuples(
				{
					coverageCount: 3,
					exactCount: 2,
					prefixCount: 0,
					fuzzyCount: 1,
					distancePenaltyTotal: 100,
					distancePenaltyMax: 100,
					spanLength: 100,
					anchorOffset: 50,
				},
				{
					coverageCount: 3,
					exactCount: 1,
					prefixCount: 2,
					fuzzyCount: 0,
					distancePenaltyTotal: 0,
					distancePenaltyMax: 0,
					spanLength: 1,
					anchorOffset: 0,
				},
			),
		).toBeLessThan(0);
	});

	test("renders snippet payloads with stable row col and highlight ranges", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "上面 foo/bar@v1.2#tag",
			snapshotText: [
				"前言。",
				"这里提到上面 foo/bar@v1.2#tag 和更多背景。",
				"尾声。",
			].join("\n"),
		});

		expect(result.renderPayloads).toHaveLength(1);
		const payload = result.renderPayloads[0];
		expect(payload.row).toBe(1);
		expect(payload.col).toBeGreaterThanOrEqual(0);
		expect(payload.text).toContain("上面");
		expect(payload.text).toContain("foo/bar@v1.2#tag");
		const highlighted = payload.highlightRanges.map((range) =>
			payload.text.slice(range.start, range.end),
		);
		expect(highlighted.some((segment) => segment.includes("上"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("面"))).toBe(true);
		expect(
			highlighted.some((segment) => segment.includes("foo/bar@v1.2#tag")),
		).toBe(true);
		expect(payload.html).toContain("<mark>");
	});

	test("does not fabricate one continuous highlight across separated exact hits", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "笔记 插件",
			snapshotText: "查看笔记间关系的一款插件，感觉还不错。",
		});

		expect(result.renderPayloads).toHaveLength(1);
		const payload = result.renderPayloads[0];
		const highlighted = payload.highlightRanges.map((range) =>
			payload.text.slice(range.start, range.end),
		);
		expect(highlighted.some((segment) => segment.includes("笔记"))).toBe(true);
		expect(highlighted.some((segment) => segment.includes("插件"))).toBe(true);
		expect(highlighted).not.toContain("笔记间关系的一款插件");
	});

	test("builds FileSubItem payloads compatible with the existing UI contract", () => {
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
		const subItems = buildDirectSubitemsExactFileSubItems({
			queryText: "上面 快速",
			snapshotText: [
				"无关开头。",
				"也是上面这位开发的，快速跳到指定日期。",
				"无关结尾。",
			].join("\n"),
		});

		expect(subItems).toHaveLength(1);
		expect(subItems[0].row).toBe(1);
		expect(subItems[0].text).toContain("上面");
		expect(subItems[0].text).toContain("快速");
		expect(subItems[0].snippet).toContain("<mark>");
		expect(subItems[0].highlightRanges?.length).toBeGreaterThan(0);
		delete (global as any).window;
	});

	test("creates a support-only prefix span when no exact occurrence exists", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "plugins",
			snapshotText: "这个文档只提到 plugin，没有完整复数形式。",
		});

		expect(result.candidateSpans).toHaveLength(1);
		expect(result.candidateSpans[0].score.coverageCount).toBe(1);
		expect(result.candidateSpans[0].score.exactCount).toBe(0);
		expect(result.candidateSpans[0].score.prefixCount).toBe(1);
		expect(result.renderPayloads[0].text.toLowerCase()).toContain("plugin");
	});

	test("creates a support-only fuzzy span when no exact or prefix occurrence exists", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "plugins",
			snapshotText: "这个文档只提到plugons，没有完整目标词。",
		});

		expect(result.candidateSpans).toHaveLength(1);
		expect(result.candidateSpans[0].score.coverageCount).toBe(1);
		expect(result.candidateSpans[0].score.exactCount).toBe(0);
		expect(result.candidateSpans[0].score.prefixCount).toBe(0);
		expect(result.candidateSpans[0].score.fuzzyCount).toBe(1);
		expect(result.renderPayloads[0].text.toLowerCase()).toContain("plugons");
	});

	test("ranks exact ahead of prefix ahead of fuzzy under equal coverage", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "plugins fast",
			snapshotText: [
				"plugins fast",
				"plugin fast",
				"plugons fast",
			].join("\n"),
			options: {
				mergeGap: 4,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
			},
		});

		expect(result.renderPayloads).toHaveLength(3);
		expect(result.candidateSpans[0].score).toMatchObject({
			coverageCount: 2,
			exactCount: 2,
			prefixCount: 0,
			fuzzyCount: 0,
		});
		expect(result.candidateSpans[1].score).toMatchObject({
			coverageCount: 2,
			exactCount: 1,
			prefixCount: 1,
			fuzzyCount: 0,
		});
		expect(result.candidateSpans[2].score).toMatchObject({
			coverageCount: 2,
			exactCount: 1,
			prefixCount: 0,
			fuzzyCount: 1,
		});
		expect(result.renderPayloads[0].text.toLowerCase()).toContain("plugins");
		expect(result.renderPayloads[1].text.toLowerCase()).toContain("plugin");
		expect(result.renderPayloads[2].text.toLowerCase()).toContain("plugons");
	});
});
