import {
	EngineType,
	FileItem,
	FileSubItem,
} from "src/globals/search-types";
import type { HybridLexicalLaneDisplayCandidate } from "./contracts";
import {
	HYBRID_LEXICAL_LANE_MAX_DISPLAY_FILES,
	HYBRID_LEXICAL_LANE_MAX_SUBITEMS_PER_FILE,
} from "./config";
import { buildHybridLexicalLaneSnapshotKey } from "./candidate-key";

export function buildHybridLexicalLaneFileItems(
	queryText: string,
	candidates: readonly HybridLexicalLaneDisplayCandidate[],
	options: Readonly<{ maxDisplayFiles?: number }> = {},
): FileItem[] {
	const maxDisplayFiles = Math.max(
		0,
		Math.floor(options.maxDisplayFiles ?? HYBRID_LEXICAL_LANE_MAX_DISPLAY_FILES),
	);
	const bySnapshot = new Map<
		string,
		{
			filePath: string;
			aggregateScore: number;
			bestScore: number;
			subItems: FileSubItem[];
			snapshotGeneration?: number;
			snapshotSource?: "live" | "indexed" | "shadow";
		}
	>();

	for (const candidate of candidates) {
		if (
			!shouldAcceptDisplayCandidateForFileQuota(
				bySnapshot,
				buildHybridLexicalLaneSnapshotKey(candidate),
				maxDisplayFiles,
			)
		) {
			continue;
		}
		const subItem = new FileSubItem(
			candidate.snippetText,
			candidate.startLine,
			candidate.startCol,
			candidate.score,
			candidate.snippetHtml,
		);
		subItem.snippetText = candidate.snippetText;
		subItem.highlightRanges = candidate.highlightRanges.map((range) => ({ ...range }));

		const snapshotKey = buildHybridLexicalLaneSnapshotKey(candidate);
		const entry = bySnapshot.get(snapshotKey) ?? {
			filePath: candidate.filePath,
			aggregateScore: candidate.score,
			bestScore: candidate.score,
			subItems: [],
			snapshotGeneration: candidate.snapshotGeneration,
			snapshotSource: candidate.snapshotSource,
		};
		entry.subItems.push(subItem);
		if (!bySnapshot.has(snapshotKey)) {
			bySnapshot.set(snapshotKey, entry);
		}
	}

	return [...bySnapshot.values()]
		.map((entry) => {
			entry.subItems.sort(
				(left, right) => (right.score ?? 0) - (left.score ?? 0),
			);
			entry.bestScore = entry.subItems[0]?.score ?? entry.bestScore;
			entry.aggregateScore = computeHybridLexicalLaneFileAggregateScore(
				entry.subItems,
			);
			return entry;
		})
		.sort((left, right) => {
			if (right.aggregateScore !== left.aggregateScore) {
				return right.aggregateScore - left.aggregateScore;
			}
			return right.bestScore - left.bestScore;
		})
		.map((entry) => {
			const item = new FileItem(
				EngineType.HYBRID,
				entry.filePath,
				[queryText],
				[],
				entry.subItems,
				null,
			);
			item.nativeSubItemsReady = true;
			item.snapshotGeneration = entry.snapshotGeneration;
			item.snapshotSource = entry.snapshotSource ?? "live";
			item.freshnessState = item.snapshotSource === "shadow" ? "stale_grace" : "fresh";
			item.freshnessReason =
				item.snapshotSource === "shadow" ? "embedding_updating" : "none";
			return item;
		});
}

function shouldAcceptDisplayCandidateForFileQuota(
	bySnapshot: ReadonlyMap<
		string,
		{
			subItems: readonly FileSubItem[];
		}
	>,
	snapshotKey: string,
	maxDisplayFiles: number,
): boolean {
	const existing = bySnapshot.get(snapshotKey);
	if (existing) {
		return existing.subItems.length < HYBRID_LEXICAL_LANE_MAX_SUBITEMS_PER_FILE;
	}
	return bySnapshot.size < maxDisplayFiles;
}

function computeHybridLexicalLaneFileAggregateScore(
	subItems: readonly FileSubItem[],
): number {
	if (subItems.length === 0) {
		return 0;
	}
	const primary = subItems[0]?.score ?? 0;
	const secondary = subItems
		.slice(1, 4)
		.reduce((sum, subItem, index) => {
			const weight = index === 0 ? 0.24 : index === 1 ? 0.12 : 0.06;
			return sum + (subItem.score ?? 0) * weight;
		}, 0);
	return primary + secondary + Math.min(6, Math.max(0, subItems.length - 1) * 1.5);
}
