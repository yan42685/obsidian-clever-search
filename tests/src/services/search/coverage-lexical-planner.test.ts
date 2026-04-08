import { buildCoverageLexicalPlan } from "src/services/search/coverage-lexical/coverage-lexical-planner";
import type { CoverageLexicalFamilyProbe } from "src/services/search/coverage-lexical/coverage-lexical-types";

describe("coverage lexical planner", () => {
	test("promotes basename partial terms into hard anchors for basename plus body queries", () => {
		const queryTerms = ["vector", "cache", "restore"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 2,
				metadataExactDocCount: 3,
				basenameExactDocCount: 2,
				folderExactDocCount: 0,
				headingExactDocCount: 2,
				aliasExactDocCount: 1,
			},
			{
				bodyExactDocCount: 8,
				metadataExactDocCount: 4,
				basenameExactDocCount: 2,
				folderExactDocCount: 0,
				headingExactDocCount: 2,
				aliasExactDocCount: 1,
			},
			{
				bodyExactDocCount: 10,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 1,
			},
		];

		const plan = buildCoverageLexicalPlan(
			"vector cache restore",
			queryTerms,
			probes,
		);

		expect(plan.queryKind).toBe("anchor_body_hybrid");
		expect(plan.route).toBe("body-with-anchor");
		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toEqual(
			expect.arrayContaining(["vector", "cache"]),
		);
		expect(plan.decisiveBodyFamilies.map((family) => family.normalizedTerm)).toContain(
			"restore",
		);
		expect(plan.bridgeFamilies.map((family) => family.normalizedTerm)).toEqual(
			expect.arrayContaining(["vector", "cache"]),
		);
		expect(plan.explain.spans.length).toBeGreaterThan(0);
		expect(plan.explain.familyReasons.some((reason) => reason.bucket === "hard_anchor")).toBe(
			true,
		);
		expect(plan.explain.queryKindReasons.length).toBeGreaterThan(0);
	});

	test("promotes checkpoint partials into hard anchors when basename signal is stronger than body", () => {
		const queryTerms = ["checkpoint", "replay", "order"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 3,
				metadataExactDocCount: 4,
				basenameExactDocCount: 2,
				folderExactDocCount: 0,
				headingExactDocCount: 1,
				aliasExactDocCount: 1,
			},
			{
				bodyExactDocCount: 8,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 6,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
		];

		const plan = buildCoverageLexicalPlan(
			"checkpoint replay order",
			queryTerms,
			probes,
		);

		expect(plan.queryKind).toBe("anchor_body_hybrid");
		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toContain(
			"checkpoint",
		);
		expect(plan.decisiveBodyFamilies.map((family) => family.normalizedTerm)).toEqual(
			expect.arrayContaining(["replay", "order"]),
		);
	});

	test("promotes path partial terms into hard anchors for path plus body queries", () => {
		const queryTerms = ["sdk", "cache", "restore"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 0,
				metadataExactDocCount: 2,
				basenameExactDocCount: 0,
				folderExactDocCount: 2,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 7,
				metadataExactDocCount: 4,
				basenameExactDocCount: 2,
				folderExactDocCount: 1,
				headingExactDocCount: 2,
				aliasExactDocCount: 1,
			},
			{
				bodyExactDocCount: 12,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 1,
			},
		];

		const plan = buildCoverageLexicalPlan(
			"sdk cache restore",
			queryTerms,
			probes,
		);

		expect(plan.queryKind).toBe("anchor_body_hybrid");
		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toContain(
			"sdk",
		);
		expect(plan.bridgeFamilies.map((family) => family.normalizedTerm)).toEqual(
			expect.arrayContaining(["sdk", "cache"]),
		);
		expect(
			plan.explain.familyReasons.find((reason) => reason.term === "sdk")?.bucket,
		).toBe("hard_anchor");
	});

	test("does not invent anchors when no path or basename signal exists", () => {
		const queryTerms = ["restore", "warm", "cache"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 10,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 1,
			},
			{
				bodyExactDocCount: 6,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 9,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 1,
			},
		];

		const plan = buildCoverageLexicalPlan(
			"restore warm cache",
			queryTerms,
			probes,
		);

		expect(plan.hardAnchorFamilies).toHaveLength(0);
		expect(plan.queryKind).toBe("body_only_local");
	});

	test("compresses metadata wrapper queries into identity plus topic buckets", () => {
		const queryTerms = ["which", "compatibility", "page", "to", "check", "before", "upgrade"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 50,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 8,
				metadataExactDocCount: 4,
				basenameExactDocCount: 1,
				folderExactDocCount: 0,
				headingExactDocCount: 1,
				aliasExactDocCount: 1,
			},
			{
				bodyExactDocCount: 15,
				metadataExactDocCount: 2,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 40,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 12,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 30,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 6,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
		];

		const plan = buildCoverageLexicalPlan(
			"which compatibility page to check before upgrade",
			queryTerms,
			probes,
		);

		expect(plan.queryKind).toBe("anchor_body_hybrid");
		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toContain(
			"compatibility",
		);
		expect(plan.decisiveBodyFamilies.map((family) => family.normalizedTerm)).toContain(
			"upgrade",
		);
		expect(plan.decisiveBodyFamilies.map((family) => family.normalizedTerm)).not.toEqual(
			expect.arrayContaining(["which", "page", "check", "before"]),
		);
		expect(
			plan.explain.spans.some(
				(span) =>
					span.kind === "metadata_intent" &&
					span.text.includes("compatibility page"),
			),
		).toBe(true);
	});

	test("compresses memory wrapper queries so replay evidence outranks wrapper terms", () => {
		const queryTerms = ["where", "we", "wrote", "replay", "order", "after", "the", "outage"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 80,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 80,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 40,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 5,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 4,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 30,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 70,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 7,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
			},
		];

		const plan = buildCoverageLexicalPlan(
			"where we wrote replay order after the outage",
			queryTerms,
			probes,
		);

		expect(plan.queryKind).toBe("memory_relaxed");
		expect(plan.decisiveBodyFamilies.map((family) => family.normalizedTerm)).toEqual(
			expect.arrayContaining(["replay", "order", "outage"]),
		);
		expect(plan.decisiveBodyFamilies.map((family) => family.normalizedTerm)).not.toEqual(
			expect.arrayContaining(["where", "we", "wrote", "after", "the"]),
		);
		expect(
			plan.explain.spans.some(
				(span) =>
					span.kind === "filler" &&
					span.text.includes("where we wrote"),
			),
		).toBe(true);
	});

	test("does not over-compress short metadata query check page", () => {
		const queryTerms = ["check", "page"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 5,
				metadataExactDocCount: 2,
				basenameExactDocCount: 1,
				folderExactDocCount: 0,
				headingExactDocCount: 1,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 1,
				metadataExactDocCount: 4,
				basenameExactDocCount: 2,
				folderExactDocCount: 0,
				headingExactDocCount: 1,
				aliasExactDocCount: 1,
			},
		];

		const plan = buildCoverageLexicalPlan("check page", queryTerms, probes);

		expect(plan.queryKind).toBe("metadata_only_anchored");
		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toEqual(
			expect.arrayContaining(["check", "page"]),
		);
		expect(plan.explain.spans.some((span) => span.kind === "filler")).toBe(false);
	});

	test("does not over-compress short title-ish query plugin check page", () => {
		const queryTerms = ["plugin", "check", "page"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 6,
				metadataExactDocCount: 3,
				basenameExactDocCount: 1,
				folderExactDocCount: 1,
				headingExactDocCount: 1,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 4,
				metadataExactDocCount: 3,
				basenameExactDocCount: 1,
				folderExactDocCount: 0,
				headingExactDocCount: 1,
				aliasExactDocCount: 0,
			},
			{
				bodyExactDocCount: 2,
				metadataExactDocCount: 5,
				basenameExactDocCount: 2,
				folderExactDocCount: 0,
				headingExactDocCount: 2,
				aliasExactDocCount: 1,
			},
		];

		const plan = buildCoverageLexicalPlan("plugin check page", queryTerms, probes);

		expect(plan.queryKind).not.toBe("memory_relaxed");
		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toContain(
			"page",
		);
		expect(plan.explain.spans.filter((span) => span.kind === "filler")).toHaveLength(0);
	});

	test("does not over-compress status page when page is the real target noun", () => {
		const queryTerms = ["status", "page"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 3,
				metadataExactDocCount: 3,
				basenameExactDocCount: 1,
				folderExactDocCount: 0,
				headingExactDocCount: 1,
				aliasExactDocCount: 1,
			},
			{
				bodyExactDocCount: 1,
				metadataExactDocCount: 6,
				basenameExactDocCount: 3,
				folderExactDocCount: 0,
				headingExactDocCount: 2,
				aliasExactDocCount: 1,
			},
		];

		const plan = buildCoverageLexicalPlan("status page", queryTerms, probes);

		expect(plan.queryKind).toBe("metadata_only_anchored");
		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toEqual(
			expect.arrayContaining(["status", "page"]),
		);
	});

	test("keeps alias-intent families as hard anchors in long mixed queries", () => {
		const queryTerms = ["old", "names", "still", "resolve", "through", "aliases"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 3,
				metadataExactDocCount: 2,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 2,
				aliasExactDocCount: 1,
				combinedExactDocCount: 3,
				familyWeight: 0.43,
				familyTier: "weak",
			},
			{
				bodyExactDocCount: 3,
				metadataExactDocCount: 2,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 1,
				aliasExactDocCount: 1,
				combinedExactDocCount: 3,
				familyWeight: 0.61,
				familyTier: "support",
			},
			{
				bodyExactDocCount: 0,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 0,
				familyWeight: 0.69,
				familyTier: "support",
			},
			{
				bodyExactDocCount: 0,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 0,
				familyWeight: 0.81,
				familyTier: "decisive",
			},
			{
				bodyExactDocCount: 0,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 0,
				familyWeight: 0.81,
				familyTier: "decisive",
			},
			{
				bodyExactDocCount: 1,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 1,
				aliasExactDocCount: 1,
				combinedExactDocCount: 1,
				familyWeight: 0.77,
				familyTier: "decisive",
			},
		];

		const plan = buildCoverageLexicalPlan(
			"old names still resolve through aliases",
			queryTerms,
			probes,
		);

		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toEqual(
			expect.arrayContaining(["names", "aliases"]),
		);
		expect(plan.weightedAnchorMass).toBeGreaterThan(0);
		expect(plan.explain.familyReasons.some((reason) => reason.term === "aliases")).toBe(
			true,
		);
	});

	test("prefers metadata-first route for short Han fallback-bigram hybrids with strong structured anchors", () => {
		const queryTerms = [
			"\u7535\u5b50\u6280",
			"\u7535\u5b50",
			"\u5b50\u6280",
		];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 1,
				metadataExactDocCount: 3,
				basenameExactDocCount: 2,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 3,
				familyWeight: 0.92,
				familyTier: "decisive",
			},
			{
				bodyExactDocCount: 3,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 3,
				familyWeight: 0.58,
				familyTier: "support",
			},
			{
				bodyExactDocCount: 4,
				metadataExactDocCount: 0,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 4,
				familyWeight: 0.34,
				familyTier: "weak",
			},
		];

		const plan = buildCoverageLexicalPlan(
			"\u7535\u5b50\u6280",
			queryTerms,
			probes,
		);

		expect(plan.queryKind).toBe("anchor_body_hybrid");
		expect(plan.route).toBe("metadata-first");
		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toContain(
			"\u7535\u5b50\u6280",
		);
	});

	test("does not treat jieba-style Han words as fallback bigram expansion", () => {
		const queryTerms = [
			"\u7535\u5b50\u6280\u672f",
			"\u5165\u95e8",
		];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 1,
				metadataExactDocCount: 3,
				basenameExactDocCount: 2,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 3,
				familyWeight: 0.92,
				familyTier: "decisive",
			},
			{
				bodyExactDocCount: 3,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 3,
				familyWeight: 0.68,
				familyTier: "support",
			},
		];

		const plan = buildCoverageLexicalPlan(
			"\u7535\u5b50\u6280\u672f\u5165\u95e8",
			queryTerms,
			probes,
		);

		expect(plan.queryKind).toBe("anchor_body_hybrid");
		expect(plan.route).toBe("body-with-anchor");
	});

	test("uses the same tier-based short-query anchor rule for latin support families", () => {
		const queryTerms = ["checkpoint", "restore"];
		const probes: CoverageLexicalFamilyProbe[] = [
			{
				bodyExactDocCount: 1,
				metadataExactDocCount: 3,
				basenameExactDocCount: 2,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 3,
				familyWeight: 0.92,
				familyTier: "decisive",
			},
			{
				bodyExactDocCount: 3,
				metadataExactDocCount: 1,
				basenameExactDocCount: 0,
				folderExactDocCount: 0,
				headingExactDocCount: 0,
				aliasExactDocCount: 0,
				combinedExactDocCount: 3,
				familyWeight: 0.62,
				familyTier: "support",
			},
		];

		const plan = buildCoverageLexicalPlan("checkpoint restore", queryTerms, probes);

		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).toContain(
			"checkpoint",
		);
		expect(plan.hardAnchorFamilies.map((family) => family.normalizedTerm)).not.toContain(
			"restore",
		);
		expect(plan.supportBodyFamilies.map((family) => family.normalizedTerm)).toContain(
			"restore",
		);
	});
});
