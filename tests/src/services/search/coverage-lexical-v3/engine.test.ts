import type { IndexedDocument } from "src/globals/search-types";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import {
	splitBodyBlocks,
	type V3DocumentTokenizer,
} from "src/services/search/coverage-lexical-v3/query";

function createDocument(
	overrides: Partial<IndexedDocument> & Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
		generation: overrides.generation,
		size: overrides.size,
	};
}

function createDocumentTokenizer(
	termMap: Readonly<Record<string, readonly string[]>>,
): V3DocumentTokenizer {
	return (text) => termMap[text] ?? [];
}

function buildLongSentenceText(sentenceCount: number): string {
	return Array.from({ length: sentenceCount }, (_, index) =>
		`Sentence ${String(index + 1).padStart(4, "0")} ends here.`,
	).join(" ");
}

function buildAdjacentChunkBoundaryContent(): string {
	for (let charCount = 900; charCount <= 1400; charCount += 1) {
		const content = `${"x".repeat(charCount)} cache\nrestore`;
		const blocks = splitBodyBlocks(content);
		const previous = blocks[0]?.normalizedText ?? "";
		const last = blocks[1]?.normalizedText ?? "";
		if (
			blocks.length === 2 &&
			previous.endsWith("cache") &&
			last.startsWith("restore")
		) {
			return content;
		}
	}
	throw new Error("failed to construct adjacent chunk boundary content");
}

describe("coverage lexical v3 engine", () => {
	test("search read path builds candidates and ranks the stronger packed document first", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "infra/projected-token.md",
				basename: "projected token runtime access",
				folder: "infra/kubernetes",
				tags: "#k8s #runtime",
				headings: "Projected token runtime access",
				content:
					"Projected token runtime access in pod.\n\nPod mounts token and secret together.",
			}),
			createDocument({
				path: "infra/scattered-note.md",
				basename: "runtime note",
				folder: "infra",
				tags: "#misc",
				headings: "pod",
				content:
					"Projected details.\n\nRuntime reminder.\n\nToken facts.\n\nAccess notes.",
			}),
		]);

		const result = engine.search("projected token runtime access");

		expect(result.rankedCandidates).toHaveLength(2);
		expect(result.rankedCandidates[0].path).toBe("infra/projected-token.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBeGreaterThanOrEqual(3);
	});

	test("one query unit binds to one best realized family per candidate", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "notes/pre-note.md",
				basename: "pre note",
				folder: "notes",
				content: "present prefer preload",
			}),
		]);

		const result = engine.search("pre");
		const candidate = result.rankedCandidates[0];

		expect(candidate.realizedCoverageCount).toBe(1);
		expect(candidate.realizedFamilies).toHaveLength(1);
	});

	test("han tokenizer real terms become the only primary units for ranking", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u7cfb\u7edf": ["\u7cfb\u7edf"],
			"\u4ee3\u7406": ["\u4ee3\u7406"],
			"\u7cfb\u7edf\u4ee3\u7406": ["\u7cfb\u7edf\u4ee3\u7406"],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/split-hit.md",
					basename: "\u7cfb\u7edf",
					folder: "zh",
					content: "\u4ee3\u7406",
				}),
				createDocument({
					path: "zh/opaque-body.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u7cfb\u7edf\u4ee3\u7406",
				}),
			],
			tokenizer,
		);

		const result = engine.search(
			"\u7cfb\u7edf\u4ee3\u7406",
			["\u7cfb\u7edf", "\u4ee3\u7406"],
		);

		expect(
			result.recallState.queryAnalysis.primaryUnits.map((unit) => ({
				text: unit.text,
				source: unit.source,
			})),
		).toEqual([
			{ text: "\u7cfb\u7edf", source: "han_tokenizer_real" },
			{ text: "\u4ee3\u7406", source: "han_tokenizer_real" },
		]);
		expect(result.recallState.queryAnalysis.hanBackstopGroups).toHaveLength(0);
		expect(result.rankedCandidates[0].path).toBe("zh/split-hit.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBe(2);
		expect(
			result.rankedCandidates[0].realizedFamilies.map((family) => family.familyText),
		).toEqual(["\u7cfb\u7edf", "\u4ee3\u7406"]);
	});

	test("bridge bigrams can recall han candidates without inflating realized coverage", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u59d4\u5458": ["\u59d4\u5458"],
			"\u957f\u5927": ["\u957f\u5927"],
			"\u5458\u957f": ["\u5458\u957f"],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/committee.md",
					basename: "\u59d4\u5458",
					folder: "zh",
					content: "\u957f\u5927",
				}),
				createDocument({
					path: "zh/bridge-only.md",
					basename: "\u5458\u957f",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u59d4\u5458\u957f", ["\u59d4\u5458"]);

		expect(
			result.recallState.queryAnalysis.primaryUnits.map((unit) => unit.text),
		).toEqual(["\u59d4\u5458"]);
		expect(result.recallState.queryAnalysis.hanBackstopGroups).toEqual([
			expect.objectContaining({
				triggerKind: "bridge_bigram",
				normalizedText: "\u957f",
				bigrams: ["\u5458\u957f"],
			}),
		]);
		expect(result.recallState.candidateDocs).toHaveLength(2);
		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].path).toBe("zh/committee.md");
		expect(result.rankedCandidates[0].realizedCoverageCount).toBe(1);
		expect(result.rankedCandidates[0].completedHanSurfaceGroupCount).toBe(0);
		expect(
			result.rankedCandidates[0].realizedFamilies.map((family) => family.familyText),
		).toEqual(["\u59d4\u5458"]);
	});

	test("completed Han surface witness in body outranks a partial real-term hit", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u751f\u547d\u529b": ["\u751f\u547d"],
			"\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d\u529b\u8bad\u7ec3": ["\u8fd9\u91cc", "\u8bb0\u5f55", "\u751f\u547d", "\u8bad\u7ec3"],
			"\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d": ["\u8fd9\u91cc", "\u8bb0\u5f55", "\u751f\u547d"],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/life-force.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d\u529b\u8bad\u7ec3",
				}),
				createDocument({
					path: "zh/life-only.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u8fd9\u91cc\u8bb0\u5f55\u751f\u547d",
				}),
			],
			tokenizer,
		);

		const result = engine.search("\u751f\u547d\u529b", ["\u751f\u547d"]);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/life-force.md",
			"zh/life-only.md",
		]);
		expect(result.rankedCandidates[0].completedHanSurfaceGroupCount).toBe(1);
		expect(result.rankedCandidates[0].strongestHanSurfaceCompletionTier).toBe(
			"body_residue",
		);
		expect(result.rankedCandidates[1].completedHanSurfaceGroupCount).toBe(0);
	});

	test("metadata dual real-term coverage outranks body dual coverage which outranks split coverage", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u7cfb\u7edf\u7684\u4ee3\u7406": ["\u7cfb\u7edf", "\u4ee3\u7406"],
			"\u7cfb\u7edf": ["\u7cfb\u7edf"],
			"\u4ee3\u7406": ["\u4ee3\u7406"],
			"\u8fd9\u91cc\u8bb0\u5f55\u7cfb\u7edf\u7684\u4ee3\u7406\u6d41\u7a0b": [
				"\u8fd9\u91cc",
				"\u8bb0\u5f55",
				"\u7cfb\u7edf",
				"\u4ee3\u7406",
				"\u6d41\u7a0b",
			],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/metadata-strong.md",
					basename: "\u7cfb\u7edf\u7684\u4ee3\u7406",
					folder: "zh",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
				createDocument({
					path: "zh/body-strong.md",
					basename: "\u666e\u901a\u7b14\u8bb0",
					folder: "zh",
					content: "\u8fd9\u91cc\u8bb0\u5f55\u7cfb\u7edf\u7684\u4ee3\u7406\u6d41\u7a0b",
				}),
				createDocument({
					path: "zh/split-weak.md",
					basename: "\u7cfb\u7edf",
					folder: "zh",
					content: "\u4ee3\u7406",
				}),
			],
			tokenizer,
		);

		const result = engine.search(
			"\u7cfb\u7edf\u4ee3\u7406",
			["\u7cfb\u7edf", "\u4ee3\u7406"],
		);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/metadata-strong.md",
			"zh/body-strong.md",
			"zh/split-weak.md",
		]);
		expect(result.rankedCandidates[0].identityContainer?.coveredDistinctUnitCount).toBe(2);
		expect(result.rankedCandidates[1].bodyWindowContainer?.coveredDistinctUnitCount).toBe(2);
		expect(result.rankedCandidates[2].identityContainer?.coveredDistinctUnitCount).toBe(1);
		expect(result.rankedCandidates[2].bodyWindowContainer).toBeNull();
	});

	test("heading han real terms corroborate body but do not form standalone realized coverage", () => {
		const engine = new CoverageLexicalV3Engine();
		const tokenizer = createDocumentTokenizer({
			"\u7cfb\u7edf\u4ee3\u7406": ["\u7cfb\u7edf", "\u4ee3\u7406"],
			"\u7cfb\u7edf\u7684\u4ee3\u7406\u6d41\u7a0b": [
				"\u7cfb\u7edf",
				"\u4ee3\u7406",
				"\u6d41\u7a0b",
			],
		});
		engine.buildResidentBase(
			[
				createDocument({
					path: "zh/heading-only.md",
					basename: "\u666e\u901a\u8bb0\u5f55",
					folder: "zh",
					headings: "\u7cfb\u7edf\u4ee3\u7406",
					content: "\u666e\u901a\u8bb0\u5f55",
				}),
				createDocument({
					path: "zh/body-with-heading.md",
					basename: "\u666e\u901a\u8bb0\u5f55",
					folder: "zh",
					headings: "\u7cfb\u7edf\u4ee3\u7406",
					content: "\u7cfb\u7edf\u7684\u4ee3\u7406\u6d41\u7a0b",
				}),
			],
			tokenizer,
		);

		const result = engine.search(
			"\u7cfb\u7edf\u4ee3\u7406",
			["\u7cfb\u7edf", "\u4ee3\u7406"],
		);

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"zh/body-with-heading.md",
		]);
		expect(result.rankedCandidates[0].bodyWindowContainer).not.toBeNull();
		expect(
			result.rankedCandidates[0].bodyWindowContainer?.headingCorroboration.unitCount,
		).toBeGreaterThan(0);
	});

	test("metadata split hit outranks same-block body hits that fail the approximate gap gate", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "latin/split.md",
				basename: "cache",
				folder: "latin",
				content: "restore",
			}),
			createDocument({
				path: "latin/long-gap-body.md",
				basename: "notes",
				folder: "latin",
				content: `cache ${"a".repeat(170)} restore`,
			}),
		]);

		const result = engine.search("cache restore");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"latin/split.md",
			"latin/long-gap-body.md",
		]);
		expect(result.rankedCandidates[0].identityContainer?.coveredDistinctUnitCount).toBe(1);
		expect(result.rankedCandidates[0].bodyWindowContainer).toBeNull();
		expect(result.rankedCandidates[1].bodyWindowContainer).toBeNull();
	});

	test("adjacent chunk evidence can still form a bodyWindow with zero cross-block penalty", () => {
		const engine = new CoverageLexicalV3Engine();
		const adjacentChunkContent = buildAdjacentChunkBoundaryContent();
		engine.buildResidentBase([
			createDocument({
				path: "latin/same-block.md",
				basename: "notes",
				folder: "latin",
				content: "cache restore",
			}),
			createDocument({
				path: "latin/adjacent-chunks.md",
				basename: "notes",
				folder: "latin",
				content: adjacentChunkContent,
			}),
		]);

		const result = engine.search("cache restore");

		const sameBlockCandidate = result.rankedCandidates.find(
			(candidate) => candidate.path === "latin/same-block.md",
		);
		const adjacentChunkCandidate = result.rankedCandidates.find(
			(candidate) => candidate.path === "latin/adjacent-chunks.md",
		);

		expect(sameBlockCandidate?.bodyWindowContainer?.boundaryCrossingCount).toBe(0);
		expect(adjacentChunkCandidate?.bodyWindowContainer?.boundaryCrossingCount).toBe(1);
		expect(adjacentChunkCandidate?.bodyWindowContainer?.blockIds).toHaveLength(2);
	});

	test("same-block chain drift fails bodyWindow when head-tail span exceeds the approximate budget", () => {
		const engine = new CoverageLexicalV3Engine();
		const leftTerm = `left${"a".repeat(80)}`;
		const rightTerm = `right${"b".repeat(80)}`;
		engine.buildResidentBase([
			createDocument({
				path: "latin/head-tail-span.md",
				basename: "notes",
				folder: "latin",
				content: `${leftTerm} ${rightTerm}`,
			}),
		]);

		const result = engine.search(`${leftTerm} ${rightTerm}`);

		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].bodyWindowContainer).toBeNull();
	});

	test("compact body evidence survives many short intervening tokens under approximate locality", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "latin/compact-many-tokens.md",
				basename: "notes",
				folder: "latin",
				content: "alpha a a a a a omega",
			}),
		]);

		const result = engine.search("alpha omega");

		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].bodyWindowContainer).not.toBeNull();
		expect(result.rankedCandidates[0].bodyWindowContainer?.coveredDistinctUnitCount).toBe(2);
	});

	test("route stays corroborative when identity and body already explain the query, but becomes main evidence when it adds a missing unit", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "latin/redundant-route.md",
				basename: "vector cache",
				folder: "latin",
				tags: "sdk cache",
				content: "vector cache restore note",
			}),
			createDocument({
				path: "latin/novel-route.md",
				basename: "cache note",
				folder: "latin",
				tags: "vector",
				content: "cache note",
			}),
		]);

		const result = engine.search("vector cache");
		const redundantRoute = result.rankedCandidates.find(
			(candidate) => candidate.path === "latin/redundant-route.md",
		);
		const novelRoute = result.rankedCandidates.find(
			(candidate) => candidate.path === "latin/novel-route.md",
		);

		expect(redundantRoute?.routeContainer).not.toBeNull();
		expect(redundantRoute?.strongestContainer?.tier).toBe("identity");
		expect(redundantRoute?.secondStrongestContainer?.tier).toBe("bodyWindow");
		expect(redundantRoute?.fragmentationPenalty.explanatoryContainerCount).toBe(2);
		expect(novelRoute?.routeContainer).not.toBeNull();
		expect(novelRoute?.strongestContainer?.tier).toBe("identity");
		expect(novelRoute?.secondStrongestContainer?.tier).toBe("route");
		expect(novelRoute?.fragmentationPenalty.explanatoryContainerCount).toBe(2);
	});

	test("vector cache canonical playbook stays in the top five when route support is only corroborative", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "pkm-en/projects/sdk/vector-cache.md",
				basename: "Vector cache playbook",
				folder: "pkm-en/projects/sdk",
				headings: "Eviction restore",
				aliases: "sdk cache restore;vector cache restore note",
				tags: "sdk cache",
				content:
					"vector cache eviction keeps sdk search warm after shard checkpoint restore",
			}),
			createDocument({
				path: "pkm-en/archive/vector-cache.md",
				basename: "Vector cache playbook",
				folder: "pkm-en/archive",
				headings: "Eviction restore",
				aliases: "archive cache restore",
				tags: "archive cache",
				content:
					"vector cache eviction keeps archive search warm after shard checkpoint restore",
			}),
			createDocument({
				path: "pkm-en/inbox/restart-cache-after-outage.md",
				basename: "Restart cache after outage",
				folder: "pkm-en/inbox",
				headings: "Restart checklist",
				aliases: "vector cache crash note",
				tags: "inbox outage",
				content:
					"remember to restart cache after outage, restore vector cache shards, and verify checkpoint replay",
			}),
			createDocument({
				path: "pkm-en/scratch/vector-cache-migration.md",
				basename: "Vector cache migration",
				folder: "pkm-en/scratch",
				headings: "Migration scratch",
				content:
					"scratch thoughts about vector cache migration, hotfixes, and unstable warm restart ideas",
			}),
			createDocument({
				path: "pkm-en/ops/vector-cache-hotfix.md",
				basename: "Vector cache hotfix",
				folder: "pkm-en/ops",
				headings: "Hotfix steps",
				content:
					"ops hotfix for vector cache crash handling after outage with follow up verification steps",
			}),
			createDocument({
				path: "pkm-en/incidents/vector-cache-postmortem.md",
				basename: "Vector cache postmortem",
				folder: "pkm-en/incidents",
				headings: "Postmortem notes",
				aliases: "vector cache outage follow up",
				tags: "incident postmortem",
				content:
					"vector cache outage postmortem covers warm restart, replay gaps, mitigation, and follow up actions",
			}),
		]);

		const result = engine.search("vector cache");
		const targetIndex = result.rankedCandidates.findIndex(
			(candidate) => candidate.path === "pkm-en/projects/sdk/vector-cache.md",
		);
		const aliasBackedIndex = result.rankedCandidates.findIndex(
			(candidate) => candidate.path === "pkm-en/inbox/restart-cache-after-outage.md",
		);
		const target = result.rankedCandidates[targetIndex];

		expect(targetIndex).toBeGreaterThanOrEqual(0);
		expect(targetIndex).toBeLessThan(5);
		expect(aliasBackedIndex).toBeGreaterThan(targetIndex);
		expect(target?.routeContainer).not.toBeNull();
		expect(target?.strongestContainer?.tier).toBe("identity");
		expect(target?.secondStrongestContainer?.tier).toBe("bodyWindow");
		expect(target?.fragmentationPenalty.explanatoryContainerCount).toBe(2);
		expect(target?.metadataPackingSignature.basenameUnitCount).toBeGreaterThan(0);
	});

	test("basename exact beats alias exact when exact counts tie", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "latin/canonical-vector-cache.md",
				basename: "vector cache",
				folder: "latin",
				content: "plain note",
			}),
			createDocument({
				path: "latin/alias-vector-cache.md",
				basename: "restart note",
				folder: "latin",
				aliases: "vector cache",
				content: "plain note",
			}),
		]);

		const result = engine.search("vector cache");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"latin/canonical-vector-cache.md",
			"latin/alias-vector-cache.md",
		]);
		expect(result.rankedCandidates[0].exactUnitCount).toBe(
			result.rankedCandidates[1].exactUnitCount,
		);
		expect(result.rankedCandidates[0].metadataPackingSignature.basenameUnitCount).toBe(2);
		expect(result.rankedCandidates[1].metadataPackingSignature.aliasUnitCount).toBe(2);
	});

	test("mixed basename and alias hits use best-source-only metadata packing", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "latin/mixed-source.md",
				basename: "vector cache",
				folder: "latin",
				aliases: "vector cache crash note",
				content: "plain note",
			}),
		]);

		const result = engine.search("vector cache");
		const candidate = result.rankedCandidates[0];

		expect(candidate.metadataPackingSignature.basenameUnitCount).toBe(2);
		expect(candidate.metadataPackingSignature.aliasUnitCount).toBe(0);
		expect(candidate.realizedFamilies.every((family) => family.metadataPackingSource === "basename")).toBe(
			true,
		);
	});

	test("prefix-only body hits prefer smaller completion gain and then non-compound tokens", () => {
		const engine = new CoverageLexicalV3Engine();
		engine.buildResidentBase([
			createDocument({
				path: "latin/preference.md",
				basename: "notes",
				folder: "latin",
				content: "preference",
			}),
			createDocument({
				path: "latin/prefer.md",
				basename: "notes",
				folder: "latin",
				content: "prefer",
			}),
			createDocument({
				path: "latin/prefer-compound.md",
				basename: "notes",
				folder: "latin",
				content: "prefer-cache",
			}),
		]);

		const result = engine.search("prefe");

		expect(result.rankedCandidates.map((candidate) => candidate.path)).toEqual([
			"latin/prefer.md",
			"latin/preference.md",
			"latin/prefer-compound.md",
		]);
		expect(result.rankedCandidates[0].prefixCompletionGainTotal).toBe(1);
		expect(result.rankedCandidates[1].prefixCompletionGainTotal).toBe(5);
		expect(result.rankedCandidates[2].compoundPrefixCount).toBe(1);
	});
});
