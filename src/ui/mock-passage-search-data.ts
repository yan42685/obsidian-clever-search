import type { PassageSearchHit } from "./passage-search-types";

const MOCK_PASSAGE_HITS: PassageSearchHit[] = [
	{
		id: "quick-links",
		path: "Projects/Search/UX notes.md",
		title: "UX notes",
		heading: "Quick links and recent intent",
		snippet:
			"Users usually expect the first few results to feel like a quick switcher instead of a full document search, so path noise should stay visually secondary.",
		score: 0.932,
		line: 18,
		column: 3,
	},
	{
		id: "history-ghost",
		path: "Projects/Search/Search history design.md",
		title: "Search history design",
		heading: "Ghost completion",
		snippet:
			"Ghost completion should only appear when the suffix is genuinely helpful; if the dropdown and ghost disagree, prefer the stronger top history prefix match.",
		score: 0.917,
		line: 42,
		column: 1,
	},
	{
		id: "chunk-ranking",
		path: "Projects/Search/Chunk ranking ideas.md",
		title: "Chunk ranking ideas",
		heading: "Passage-first ordering",
		snippet:
			"If the future UI sorts by passages instead of grouped files, the result card should surface file identity first and keep the body as the third visual layer.",
		score: 0.903,
		line: 9,
		column: 1,
	},
	{
		id: "mixed-query",
		path: "Projects/Search/中英混合测试.md",
		title: "中英混合测试",
		heading: "Mixed query notes",
		snippet:
			"测试 mixed query 时，用户经常会输入 partial English terms，再加上一点中文语义锚点，所以前缀命中和轻量乱序匹配都要比较稳。",
		score: 0.889,
		line: 27,
		column: 2,
	},
	{
		id: "quickswitch-visual",
		path: "Projects/Search/QuickSwitch visual draft.md",
		title: "QuickSwitch visual draft",
		heading: "Card density",
		snippet:
			"The first two lines should mirror a compact file item: filename on top, muted path below, then the snippet body without making the card feel oversized.",
		score: 0.872,
		line: 14,
		column: 1,
	},
	{
		id: "rerank-note",
		path: "Projects/Search/Rerank notes.md",
		title: "Rerank notes",
		heading: "Why passage cards matter",
		snippet:
			"A passage-oriented result list helps users judge relevance faster than grouped files when the strongest evidence sits deep inside a long note.",
		score: 0.851,
		line: 31,
		column: 1,
	},
	{
		id: "meeting",
		path: "Daily/2026-03-22.md",
		title: "2026-03-22",
		heading: "Search polish",
		snippet:
			"Decided to keep the new quick switch UI decoupled from the current lexical service until the result model moves from file aggregation to hit-level ranking.",
		score: 0.833,
		line: 6,
		column: 1,
	},
	{
		id: "pkm-card",
		path: "Knowledge/PKM/Inbox workflow.md",
		title: "Inbox workflow",
		heading: "Capture to retrieval",
		snippet:
			"Capture notes become much easier to revisit when the search surface behaves like a launcher: concise cards, fast keys, low cognitive load.",
		score: 0.821,
		line: 22,
		column: 1,
	},
	{
		id: "planner-note",
		path: "Projects/Search/Planner experiments.md",
		title: "Planner experiments",
		heading: "Result model",
		snippet:
			"Hit-level ranking makes it easier to compare isolated evidence blocks before deciding whether file grouping should happen later in the interaction.",
		score: 0.808,
		line: 11,
		column: 1,
	},
	{
		id: "readme-sketch",
		path: "Projects/Search/README sketch.md",
		title: "README sketch",
		heading: "Version 0.3",
		snippet:
			"Version notes should emphasize search history completion, quick switching behavior, and cleaner hit cards before deeper retrieval changes land.",
		score: 0.794,
		line: 5,
		column: 1,
	},
];

function normalizeText(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

function tokenizeQuery(queryText: string): string[] {
	const normalized = normalizeText(queryText).trim();
	if (!normalized) {
		return [];
	}
	const segments = normalized.match(/[\p{Script=Han}]+|[a-z0-9][a-z0-9_-]*/gu) ?? [];
	return segments.flatMap((segment) => {
		if (/^\p{Script=Han}+$/u.test(segment)) {
			return segment.length <= 4
				? [segment]
				: Array.from({ length: segment.length - 1 }, (_, index) =>
						segment.slice(index, index + 2),
				  );
		}
		return [segment];
	});
}

export function getMockPassageSearchHits(queryText: string): PassageSearchHit[] {
	const queryTokens = tokenizeQuery(queryText);
	if (queryTokens.length === 0) {
		return [...MOCK_PASSAGE_HITS];
	}

	return MOCK_PASSAGE_HITS.map((hit) => {
		const haystack = normalizeText(
			[hit.title, hit.path, hit.heading, hit.snippet].filter(Boolean).join(" "),
		);
		let matchedCount = 0;
		let fileIdentityBoost = 0;

		for (const token of queryTokens) {
			if (!haystack.includes(token)) {
				continue;
			}
			matchedCount += 1;
			if (
				normalizeText(hit.title ?? "").includes(token) ||
				normalizeText(hit.path).includes(token)
			) {
				fileIdentityBoost += 1;
			}
		}

		const coverage = matchedCount / queryTokens.length;
		return {
			hit,
			sortScore: coverage * 1000 + fileIdentityBoost * 100 + (hit.score ?? 0),
			keep: matchedCount > 0,
		};
	})
		.filter((entry) => entry.keep)
		.sort((left, right) => right.sortScore - left.sortScore)
		.map((entry) => entry.hit);
}
