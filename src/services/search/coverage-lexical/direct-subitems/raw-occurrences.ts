import type {
	DirectSubitemsOccurrence,
	DirectSubitemsQueryTerm,
} from "./contracts";

const SNAPSHOT_RUN_REGEX =
	/[a-z0-9]+(?:[-_./:+#@][a-z0-9]+)*/giu;

export function collectDirectSubitemsExactOccurrences(
	snapshotText: string,
	queryTerms: readonly DirectSubitemsQueryTerm[],
): DirectSubitemsOccurrence[] {
	const lowerSnapshot = snapshotText.toLowerCase();
	const occurrences: DirectSubitemsOccurrence[] = [];
	for (const term of queryTerms) {
		const needle = term.normalizedText;
		if (!needle) {
			continue;
		}
		const haystack =
			term.kind === "non_han_run" ? lowerSnapshot : snapshotText;
		let fromIndex = 0;
		while (fromIndex < haystack.length) {
			const foundAt = haystack.indexOf(needle, fromIndex);
			if (foundAt < 0) {
				break;
			}
			occurrences.push({
				termId: term.termId,
				tier: "exact",
				start: foundAt,
				end: foundAt + needle.length,
				distancePenalty: 0,
			});
			fromIndex = foundAt + Math.max(1, needle.length);
		}
	}
	return occurrences.sort(compareOccurrences);
}

export function collectDirectSubitemsSupportOccurrences(
	snapshotText: string,
	queryTerms: readonly DirectSubitemsQueryTerm[],
): DirectSubitemsOccurrence[] {
	const supportOccurrences: DirectSubitemsOccurrence[] = [];
	const snapshotRuns = collectSnapshotRuns(snapshotText);
	for (const term of queryTerms) {
		if (term.kind !== "non_han_run") {
			continue;
		}
		for (const run of snapshotRuns) {
			if (run.normalizedText === term.normalizedText) {
				continue;
			}
			if (
				run.normalizedText.startsWith(term.normalizedText) ||
				term.normalizedText.startsWith(run.normalizedText)
			) {
				supportOccurrences.push({
					termId: term.termId,
					tier: "prefix",
					start: run.start,
					end: run.end,
					distancePenalty: Math.abs(run.normalizedText.length - term.normalizedText.length),
				});
				continue;
			}
			const maxDistance = computeMaxFuzzyDistance(term.normalizedText);
			if (
				maxDistance <= 0 ||
				run.normalizedText[0] !== term.normalizedText[0]
			) {
				continue;
			}
			const distance = boundedLevenshtein(
				run.normalizedText,
				term.normalizedText,
				maxDistance,
			);
			if (distance > maxDistance) {
				continue;
			}
			supportOccurrences.push({
				termId: term.termId,
				tier: "fuzzy",
				start: run.start,
				end: run.end,
				distancePenalty: distance,
			});
		}
	}
	return dedupeSupportOccurrences(supportOccurrences).sort(compareOccurrences);
}

export function compareOccurrences(
	left: DirectSubitemsOccurrence,
	right: DirectSubitemsOccurrence,
): number {
	if (left.start !== right.start) {
		return left.start - right.start;
	}
	if (left.end !== right.end) {
		return left.end - right.end;
	}
	return left.termId.localeCompare(right.termId);
}

function collectSnapshotRuns(snapshotText: string): Array<{
	text: string;
	normalizedText: string;
	start: number;
	end: number;
}> {
	const runs: Array<{
		text: string;
		normalizedText: string;
		start: number;
		end: number;
	}> = [];
	for (const match of snapshotText.matchAll(SNAPSHOT_RUN_REGEX)) {
		const text = match[0];
		const start = match.index ?? 0;
		runs.push({
			text,
			normalizedText: text.toLowerCase(),
			start,
			end: start + text.length,
		});
	}
	return runs;
}

function dedupeSupportOccurrences(
	occurrences: readonly DirectSubitemsOccurrence[],
): DirectSubitemsOccurrence[] {
	const bestByKey = new Map<string, DirectSubitemsOccurrence>();
	for (const occurrence of occurrences) {
		const key = `${occurrence.termId}:${occurrence.start}:${occurrence.end}`;
		const existing = bestByKey.get(key);
		if (!existing || compareTier(existing.tier, occurrence.tier) > 0) {
			bestByKey.set(key, occurrence);
			continue;
		}
		if (
			existing.tier === occurrence.tier &&
			occurrence.distancePenalty < existing.distancePenalty
		) {
			bestByKey.set(key, occurrence);
		}
	}
	return [...bestByKey.values()];
}

function compareTier(
	left: DirectSubitemsOccurrence["tier"],
	right: DirectSubitemsOccurrence["tier"],
): number {
	const rank = {
		exact: 0,
		prefix: 1,
		fuzzy: 2,
	} as const;
	return rank[left] - rank[right];
}

function computeMaxFuzzyDistance(term: string): number {
	if (term.length <= 4) {
		return 0;
	}
	return Math.min(2, Math.max(1, Math.round(term.length * 0.2)));
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
	if (a === b) {
		return 0;
	}
	if (Math.abs(a.length - b.length) > maxDistance) {
		return maxDistance + 1;
	}
	const previous = new Array<number>(b.length + 1);
	const current = new Array<number>(b.length + 1);
	for (let index = 0; index <= b.length; index++) {
		previous[index] = index;
	}
	for (let row = 1; row <= a.length; row++) {
		current[0] = row;
		let rowMin = current[0];
		for (let column = 1; column <= b.length; column++) {
			const cost = a[row - 1] === b[column - 1] ? 0 : 1;
			current[column] = Math.min(
				previous[column] + 1,
				current[column - 1] + 1,
				previous[column - 1] + cost,
			);
			rowMin = Math.min(rowMin, current[column]);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let index = 0; index <= b.length; index++) {
			previous[index] = current[index];
		}
	}
	return previous[b.length];
}
