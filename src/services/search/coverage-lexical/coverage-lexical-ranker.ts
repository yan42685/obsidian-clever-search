import type { MatchedFile } from "src/globals/search-types";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalFamily,
	CoverageLexicalFamilySignal,
	CoverageLexicalPlan,
} from "./coverage-lexical-types";

export function rankCoverageLexicalResults(
	results: readonly MatchedFile[],
	plan: CoverageLexicalPlan,
): MatchedFile[] {
	if (results.length <= 1) {
		return [...results];
	}
	return [...results].sort((left, right) => {
		const signalDecision = compareCoverageLexicalSignals(
			buildCoverageLexicalSignal(left, plan),
			buildCoverageLexicalSignal(right, plan),
			plan,
		);
		if (signalDecision !== 0) {
			return signalDecision;
		}
		return (
			(right.score ?? 0) - (left.score ?? 0) ||
			left.path.localeCompare(right.path)
		);
	});
}

function buildCoverageLexicalSignal(
	result: MatchedFile,
	plan: CoverageLexicalPlan,
): CoverageLexicalFamilySignal {
	const matchedTerms = result.matchedTerms.map((term) => term.toLowerCase());
	let coverageCount = 0;
	let exactWeight = 0;
	let prefixWeight = 0;
	let fuzzyWeight = 0;
	let tailWeight = 0;
	let metadataWeight = 0;

	for (const family of plan.families) {
		if (!family.isCore) {
			continue;
		}
		const matchKind = resolveFamilyMatchKind(family, matchedTerms);
		if (!matchKind) {
			continue;
		}
		const familyWeight = computeFamilyTailWeight(family.index);
		coverageCount += 1;
		tailWeight += familyWeight;
		if (family.isMetadataCapable) {
			metadataWeight += familyWeight;
		}
		if (matchKind === "exact") {
			exactWeight += familyWeight;
		} else if (matchKind === "prefix") {
			prefixWeight += familyWeight;
		} else {
			fuzzyWeight += familyWeight;
		}
	}

	return {
		coverageCount,
		exactWeight,
		prefixWeight,
		fuzzyWeight,
		tailWeight,
		metadataWeight,
	};
}

function resolveFamilyMatchKind(
	family: CoverageLexicalFamily,
	matchedTerms: readonly string[],
): CoverageFamilyMatchKind {
	if (matchedTerms.includes(family.normalizedTerm)) {
		return "exact";
	}
	if (
		family.normalizedTerm.length >= 3 &&
		matchedTerms.some((term) => term.startsWith(family.normalizedTerm))
	) {
		return "prefix";
	}
	const maxDistance =
		family.normalizedTerm.length >= 8
			? 2
			: family.normalizedTerm.length >= 5
				? 1
				: 0;
	if (
		maxDistance > 0 &&
		matchedTerms.some(
			(term) =>
				Math.abs(term.length - family.normalizedTerm.length) <= maxDistance &&
				boundedLevenshtein(term, family.normalizedTerm, maxDistance) <=
					maxDistance,
		)
	) {
		return "fuzzy";
	}
	return null;
}

function compareCoverageLexicalSignals(
	left: CoverageLexicalFamilySignal,
	right: CoverageLexicalFamilySignal,
	plan: CoverageLexicalPlan,
): number {
	return (
		compareDescendingMetric(left.coverageCount, right.coverageCount) ||
		compareDescendingMetric(left.exactWeight, right.exactWeight) ||
		compareDescendingMetric(left.prefixWeight, right.prefixWeight) ||
		compareDescendingMetric(left.fuzzyWeight, right.fuzzyWeight) ||
		(plan.route !== "body-first"
			? compareDescendingMetric(left.metadataWeight, right.metadataWeight)
			: 0) ||
		compareDescendingMetric(left.tailWeight, right.tailWeight)
	);
}

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}

function compareDescendingMetric(left: number, right: number): number {
	return right - left;
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
	if (a === b) {
		return 0;
	}
	if (Math.abs(a.length - b.length) > maxDistance) {
		return maxDistance + 1;
	}

	const prev = new Array<number>(b.length + 1);
	const curr = new Array<number>(b.length + 1);
	for (let index = 0; index <= b.length; index++) {
		prev[index] = index;
	}

	for (let row = 1; row <= a.length; row++) {
		curr[0] = row;
		let rowMin = curr[0];
		for (let column = 1; column <= b.length; column++) {
			const cost = a[row - 1] === b[column - 1] ? 0 : 1;
			curr[column] = Math.min(
				prev[column] + 1,
				curr[column - 1] + 1,
				prev[column - 1] + cost,
			);
			rowMin = Math.min(rowMin, curr[column]);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let index = 0; index <= b.length; index++) {
			prev[index] = curr[index];
		}
	}

	return prev[b.length];
}
