import {
	EngineType,
	FileItem,
	FileSubItem,
} from "src/globals/search-types";
import type { HybridLexicalLaneDisplayCandidate } from "./contracts";

export function buildHybridLexicalLaneFileItems(
	queryText: string,
	candidates: readonly HybridLexicalLaneDisplayCandidate[],
): FileItem[] {
	const byFile = new Map<
		string,
		{
			bestScore: number;
			subItems: FileSubItem[];
		}
	>();

	for (const candidate of candidates) {
		const subItem = new FileSubItem(
			candidate.snippetText,
			candidate.startLine,
			candidate.startCol,
			candidate.score,
			candidate.snippetHtml,
		);
		subItem.snippetText = candidate.snippetText;
		subItem.highlightRanges = candidate.highlightRanges.map((range) => ({ ...range }));

		const entry = byFile.get(candidate.filePath) ?? {
			bestScore: candidate.score,
			subItems: [],
		};
		entry.bestScore = Math.max(entry.bestScore, candidate.score);
		entry.subItems.push(subItem);
		if (!byFile.has(candidate.filePath)) {
			byFile.set(candidate.filePath, entry);
		}
	}

	return [...byFile.entries()]
		.sort((left, right) => right[1].bestScore - left[1].bestScore)
		.map(([filePath, entry]) => {
			entry.subItems.sort(
				(left, right) => (right.score ?? 0) - (left.score ?? 0),
			);
			return new FileItem(
				EngineType.SEMANTIC,
				filePath,
				[queryText],
				[],
				entry.subItems,
				null,
			);
		});
}
