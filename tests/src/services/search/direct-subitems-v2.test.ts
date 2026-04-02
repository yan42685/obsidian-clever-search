import {
	buildDirectSubitemsExactCandidates,
	buildDirectSubitemsExactCandidateSpans,
	buildDirectSubitemsExactFileSubItems,
	buildSupplementalCoverageSpans,
	collectDirectSubitemsExactOccurrences,
	compareDirectSubitemsScoreTuples,
	dedupeDirectSubitemsCandidateSpans,
	splitDirectSubitemsQueryTerms,
} from "src/services/search/coverage-lexical/direct-subitems";

function collectOccurrenceKeys(
	occurrences: ReadonlyArray<{
		termId: string;
		start: number;
		end: number;
		tier: string;
	}>,
): Set<string> {
	return new Set(
		occurrences.map(
			(occurrence) =>
				`${occurrence.termId}:${occurrence.start}:${occurrence.end}:${occurrence.tier}`,
		),
	);
}

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

	test("anchors grouped snippets on the first best-tier hit instead of an earlier weaker match", () => {
		const result = buildDirectSubitemsExactCandidates({
			queryText: "plugins fast",
			snapshotText: "plugin fast",
			options: {
				mergeGap: 4,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
			},
		});

		expect(result.candidateSpans).toHaveLength(1);
		expect(result.renderPayloads).toHaveLength(1);
		expect(result.candidateSpans[0].anchorOffset).toBe("plugin ".length);
		expect(result.renderPayloads[0].row).toBe(0);
		expect(result.renderPayloads[0].col).toBe("plugin ".length);
	});

	test("coverage-complete fallback restores exact occurrences absent from the initial span set", () => {
		const queryTerms = splitDirectSubitemsQueryTerms("alpha");
		const snapshotText = `alpha${"x".repeat(96)}alpha`;
		const exactOccurrences = collectDirectSubitemsExactOccurrences(
			snapshotText,
			queryTerms,
		);
		const initialSpans = buildDirectSubitemsExactCandidateSpans({
			snapshotText,
			queryTerms,
			anchorOccurrences: [exactOccurrences[0]],
			allOccurrences: exactOccurrences,
			options: {
				mergeGap: 8,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
			},
		});
		const deduped = dedupeDirectSubitemsCandidateSpans(initialSpans);
		const supplemental = buildSupplementalCoverageSpans({
			snapshotText,
			queryTerms,
			exactOccurrences,
			existingSpans: deduped,
			options: {
				mergeGap: 8,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
			},
		});

		expect(exactOccurrences).toHaveLength(2);
		expect(deduped).toHaveLength(1);
		expect(supplemental).toHaveLength(1);
		expect(collectCoveredOccurrenceKeys([...deduped, ...supplemental])).toEqual(
			collectOccurrenceKeys(exactOccurrences),
		);
	});

	test("keeps distant spans with the same realized term signature after dedupe", () => {
		const snapshotText = ["alpha beta", "x".repeat(72), "alpha beta"].join("");
		const result = buildDirectSubitemsExactCandidates({
			queryText: "alpha beta",
			snapshotText,
			options: {
				mergeGap: 12,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
			},
		});
		const spansByStart = [...result.candidateSpans].sort(
			(left, right) => left.start - right.start,
		);

		expect(result.candidateSpans).toHaveLength(2);
		expect(spansByStart[0].termSignature).toEqual(
			spansByStart[1].termSignature,
		);
		expect(new Set(spansByStart.map((span) => `${span.start}:${span.end}`)).size).toBe(
			2,
		);
		expect(result.renderPayloads).toHaveLength(2);
		expect(
			result.renderPayloads.every((payload) => payload.text.includes("alpha beta")),
		).toBe(true);
	});

	test("keeps dense repeated Han evidence local without candidate explosion or accidental merge", () => {
		const queryText = "\u6062\u590d\u7f13\u5b58";
		const snapshotText = [
			"\u6062\u6062\u6062\u6062\u6062\u590d\u590d\u590d\u7f13\u7f13\u7f13\u5b58\u5b58\u5b58",
			"x".repeat(72),
			"\u6062\u6062\u590d\u7f13\u5b58",
		].join("");
		const result = buildDirectSubitemsExactCandidates({
			queryText,
			snapshotText,
			options: {
				mergeGap: 12,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
			},
		});
		const spansByStart = [...result.candidateSpans].sort(
			(left, right) => left.start - right.start,
		);

		expect(result.exactOccurrences.length).toBeGreaterThanOrEqual(12);
		expect(result.candidateSpans).toHaveLength(2);
		expect(result.candidateSpans.every((span) => span.score.coverageCount === 4)).toBe(
			true,
		);
		expect(spansByStart[1].start - spansByStart[0].end).toBeGreaterThan(40);
	});

	test("renders wider display context than the scoring span", () => {
		const snapshotText =
			"prefix context before alpha beta suffix context after and a little more";
		const result = buildDirectSubitemsExactCandidates({
			queryText: "alpha beta",
			snapshotText,
			options: {
				mergeGap: 4,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
			},
		});

		expect(result.candidateSpans).toHaveLength(1);
		expect(result.candidateSpans[0].end - result.candidateSpans[0].start).toBe(
			"alpha beta".length,
		);
		expect(result.renderPayloads[0].text.length).toBeGreaterThan(
			result.candidateSpans[0].end - result.candidateSpans[0].start,
		);
		expect(result.renderPayloads[0].text).toContain("prefix context before");
		expect(result.renderPayloads[0].text).toContain("suffix context after");
	});

	test("does not add prefix or suffix ellipsis in rendered snippets", () => {
		const snapshotText = `start ${"x".repeat(240)} alpha beta ${"y".repeat(240)} end`;
		const result = buildDirectSubitemsExactCandidates({
			queryText: "alpha beta",
			snapshotText,
			options: {
				mergeGap: 4,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
			},
		});

		expect(result.renderPayloads).toHaveLength(1);
		expect(result.renderPayloads[0].text.startsWith("…")).toBe(false);
		expect(result.renderPayloads[0].text.endsWith("…")).toBe(false);
		expect(result.renderPayloads[0].snippetText.startsWith("…")).toBe(false);
		expect(result.renderPayloads[0].snippetText.endsWith("…")).toBe(false);
		expect(result.renderPayloads[0].html.startsWith("&hellip;")).toBe(false);
		expect(result.renderPayloads[0].html.endsWith("&hellip;")).toBe(false);
	});
	test("expands direct subitem snippets across nearby lines within the char budget", () => {
		const snapshotText = [
			"context line above",
			"alpha mention lives here",
			"beta mention lives here",
			"context line below",
			"second line below",
			"third line below should stay out",
		].join("\n");
		const result = buildDirectSubitemsExactCandidates({
			queryText: "alpha beta",
			snapshotText,
			options: {
				mergeGap: 8,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
				maxChars: 120,
			},
		});

		expect(result.renderPayloads.length).toBeGreaterThanOrEqual(1);
		const payload = result.renderPayloads.find(
			(candidate) =>
				candidate.text.includes("alpha mention lives here") &&
				candidate.text.includes("beta mention lives here"),
		);
		expect(payload).toBeDefined();
		expect(payload?.text).toContain("context line above");
		expect(payload?.text).toContain("context line below");
		expect(payload?.text).not.toContain("third line below should stay out");
		expect(payload?.displayStart ?? 0).toBeLessThan(payload?.coreStart ?? Number.MAX_SAFE_INTEGER);
		expect(payload?.displayEnd ?? 0).toBeGreaterThan(payload?.coreEnd ?? 0);
	});

	test("trims leading and trailing blank lines after display expansion", () => {
		const snapshotText = [
			"",
			"",
			"alpha focus",
			"beta focus",
			"",
			"",
		].join("\n");
		const result = buildDirectSubitemsExactCandidates({
			queryText: "alpha beta",
			snapshotText,
			options: {
				mergeGap: 4,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
				maxChars: 80,
			},
		});

		expect(result.renderPayloads.length).toBeGreaterThanOrEqual(1);
		expect(
			result.renderPayloads.some(
				(payload) =>
					!payload.text.startsWith("\n") && !payload.text.endsWith("\n"),
			),
		).toBe(true);
	});

	test("hides weak tail snippets when top1 is much stronger and no new exact term appears", () => {
		const snapshotText = [
			"alpha beta gamma delta",
			"x".repeat(80),
			"alpha",
			"x".repeat(80),
			"gamma",
		].join("\n");
		const result = buildDirectSubitemsExactCandidates({
			queryText: "alpha beta gamma delta",
			snapshotText,
			options: {
				mergeGap: 1,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
				maxChars: 200,
			},
		});

		expect(result.exactOccurrences.length).toBeGreaterThan(4);
		expect(result.candidateSpans).toHaveLength(1);
		expect(result.renderPayloads).toHaveLength(1);
		expect(result.renderPayloads[0].text).toContain("alpha beta gamma delta");
		expect(result.candidateSpans[0].score.coverageCount).toBe(4);
	});

	test("keeps weak snippets when they introduce a new exact term below the top1 threshold", () => {
		const snapshotText = [
			"plugin fast cache note",
			"x".repeat(80),
			"plugins",
		].join("\n");
		const result = buildDirectSubitemsExactCandidates({
			queryText: "plugins fast cache note",
			snapshotText,
			options: {
				mergeGap: 1,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
				maxChars: 200,
			},
		});

		expect(result.candidateSpans).toHaveLength(2);
		expect(result.renderPayloads).toHaveLength(2);
		expect(result.renderPayloads[0].text.toLowerCase()).toContain(
			"plugin fast cache note",
		);
		expect(result.renderPayloads[1].text.toLowerCase()).toContain("plugins");
	});

	test("hides single-term tails for two-term queries at the half-coverage boundary", () => {
		const snapshotText = [
			"alpha beta",
			"x".repeat(80),
			"alpha",
		].join("\n");
		const result = buildDirectSubitemsExactCandidates({
			queryText: "alpha beta",
			snapshotText,
			options: {
				mergeGap: 1,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
				maxChars: 200,
			},
		});

		expect(result.exactOccurrences.length).toBeGreaterThan(2);
		expect(result.candidateSpans).toHaveLength(1);
		expect(result.renderPayloads).toHaveLength(1);
		expect(result.candidateSpans[0].score.coverageCount).toBe(2);
		expect(result.renderPayloads[0].text).toContain("alpha beta");
	});

	test("keeps separate candidates even when expanded display windows overlap", () => {
		const snapshotText = [
			"shared context top",
			"shared context upper",
			"alpha first hit",
			"shared middle context that both snippets can include",
			"alpha second hit",
			"shared context lower",
			"shared context bottom",
		].join("\n");
		const result = buildDirectSubitemsExactCandidates({
			queryText: "alpha",
			snapshotText,
			options: {
				mergeGap: 0,
				contextLeft: 0,
				contextRight: 0,
				boundaryLookaround: 0,
				maxChars: 200,
			},
		});

		expect(result.candidateSpans).toHaveLength(2);
		expect(result.renderPayloads).toHaveLength(2);
		expect(result.renderPayloads[0].displayEnd).toBeGreaterThan(
			result.renderPayloads[1].displayStart,
		);
	});
});
