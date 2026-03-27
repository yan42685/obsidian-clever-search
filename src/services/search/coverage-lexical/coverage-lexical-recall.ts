import type { FileSearchRequest } from "../file-search-engine";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalCandidateState,
	CoverageLexicalFamily,
	CoverageLexicalMetadataField,
	CoverageLexicalPhraseSignature,
	CoverageLexicalPlan,
} from "./coverage-lexical-types";

type CoverageLexicalRecallIndex = {
	bodyPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataAliasPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataBasenamePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataFolderPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataHeadingPostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataPostings: ReadonlyMap<string, ReadonlySet<string>>;
	bodyPhrasePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataPhrasePostings: ReadonlyMap<string, ReadonlySet<string>>;
	metadataTagPostings: ReadonlyMap<string, ReadonlySet<string>>;
	sortedLexicon: readonly string[];
};

const MAX_PREFIX_EXPANSIONS = 48;
const MAX_FUZZY_EXPANSIONS = 24;

export function collectCoverageLexicalCandidateStates(
	index: CoverageLexicalRecallIndex,
	plan: CoverageLexicalPlan,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	request: FileSearchRequest,
): Map<string, CoverageLexicalCandidateState> {
	const candidates = new Map<string, CoverageLexicalCandidateState>();
	const familyMatchedPaths = new Map<number, Set<string>>();

	for (const family of plan.families) {
		if (family.role === "noise") {
			continue;
		}
		collectCandidatesForTerm(
			index,
			candidates,
			familyMatchedPaths,
			family.index,
			family.normalizedTerm,
			"exact",
		);
	}

	for (const signature of phraseSignatures) {
		if (!shouldUsePhraseRecall(signature, familyMatchedPaths, plan, request)) {
			continue;
		}
		collectCandidatesForPhraseSignature(
			index,
			candidates,
			familyMatchedPaths,
			signature,
		);
	}

	for (const family of [...plan.families].sort((left, right) => right.index - left.index)) {
		if (family.role === "noise") {
			continue;
		}
		const familyTarget = computeFamilyRecallTarget(family, plan, request);
		if (
			request.isPrefixMatch &&
			family.allowPrefix &&
			getFamilyMatchCount(familyMatchedPaths, family.index) < familyTarget
		) {
			for (const term of expandPrefixTerms(index.sortedLexicon, family.normalizedTerm)) {
				if (term === family.normalizedTerm) {
					continue;
				}
				collectCandidatesForTerm(
					index,
					candidates,
					familyMatchedPaths,
					family.index,
					term,
					"prefix",
				);
			}
		}
		if (
			request.isFuzzy &&
			family.allowFuzzy &&
			getFamilyMatchCount(familyMatchedPaths, family.index) < familyTarget
		) {
			for (const term of expandFuzzyTerms(index.sortedLexicon, family.normalizedTerm)) {
				collectCandidatesForTerm(
					index,
					candidates,
					familyMatchedPaths,
					family.index,
					term,
					"fuzzy",
				);
			}
		}
	}

	return candidates;
}

function shouldUsePhraseRecall(
	signature: CoverageLexicalPhraseSignature,
	familyMatchedPaths: ReadonlyMap<number, ReadonlySet<string>>,
	plan: CoverageLexicalPlan,
	request: FileSearchRequest,
): boolean {
	const shortage = signature.familyIndices.some((familyIndex) =>
		getFamilyMatchCount(familyMatchedPaths, familyIndex) <
			computeSignatureRecallTarget(plan, request),
	);
	return shortage || signature.familyIndices.length >= 3;
}

function computeSignatureRecallTarget(
	plan: CoverageLexicalPlan,
	request: FileSearchRequest,
): number {
	if (plan.route === "metadata-first") {
		return Math.max(2, Math.min(request.maxItemResults, 5));
	}
	return Math.max(2, Math.min(request.maxItemResults, 4));
}

function computeFamilyRecallTarget(
	family: CoverageLexicalFamily,
	plan: CoverageLexicalPlan,
	request: FileSearchRequest,
): number {
	const base =
		family.role === "anchor"
			? 4
			: family.strength === "core"
				? 5
				: 3;
	const routeBonus =
		plan.route === "metadata-first" && family.role === "anchor"
			? 2
			: plan.route === "body-with-anchor" && family.role === "body"
				? 1
				: 0;
	return Math.max(2, Math.min(request.maxItemResults, base + routeBonus));
}

function collectCandidatesForTerm(
	index: CoverageLexicalRecallIndex,
	candidates: Map<string, CoverageLexicalCandidateState>,
	familyMatchedPaths: Map<number, Set<string>>,
	familyIndex: number,
	term: string,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): void {
	const bodyMatches = index.bodyPostings.get(term);
	if (bodyMatches) {
		for (const path of bodyMatches) {
			const state = getOrCreateCandidateState(candidates, path);
			recordFamilyMatch(state.bodyMatches, familyIndex, kind);
			getOrCreateFamilyMatchedPaths(familyMatchedPaths, familyIndex).add(path);
		}
	}

	collectMetadataFieldCandidatesForTerm(
		index,
		candidates,
		familyMatchedPaths,
		familyIndex,
		term,
		kind,
	);
}

function collectCandidatesForPhraseSignature(
	index: CoverageLexicalRecallIndex,
	candidates: Map<string, CoverageLexicalCandidateState>,
	familyMatchedPaths: Map<number, Set<string>>,
	signature: CoverageLexicalPhraseSignature,
): void {
	for (const variant of signature.variants) {
		const bodyTokenMatches = index.bodyPostings.get(variant);
		if (bodyTokenMatches) {
			for (const path of bodyTokenMatches) {
				const state = getOrCreateCandidateState(candidates, path);
				state.phraseMatches.add(signature.index);
				for (const familyIndex of signature.familyIndices) {
					recordFamilyMatch(state.bodyMatches, familyIndex, "prefix");
					getOrCreateFamilyMatchedPaths(familyMatchedPaths, familyIndex).add(path);
				}
			}
		}

		const bodyMatches = index.bodyPhrasePostings.get(variant);
		if (bodyMatches) {
			for (const path of bodyMatches) {
				const state = getOrCreateCandidateState(candidates, path);
				state.phraseMatches.add(signature.index);
				for (const familyIndex of signature.familyIndices) {
					recordFamilyMatch(state.bodyMatches, familyIndex, "prefix");
					getOrCreateFamilyMatchedPaths(familyMatchedPaths, familyIndex).add(path);
				}
			}
		}

		const metadataTokenMatches = index.metadataPostings.get(variant);
		if (metadataTokenMatches) {
			for (const path of metadataTokenMatches) {
				const state = getOrCreateCandidateState(candidates, path);
				state.phraseMatches.add(signature.index);
				for (const familyIndex of signature.familyIndices) {
					recordFamilyMatch(state.metadataMatches, familyIndex, "prefix");
					getOrCreateFamilyMatchedPaths(familyMatchedPaths, familyIndex).add(path);
				}
			}
		}

		const metadataMatches = index.metadataPhrasePostings.get(variant);
		if (metadataMatches) {
			for (const path of metadataMatches) {
				const state = getOrCreateCandidateState(candidates, path);
				state.phraseMatches.add(signature.index);
				for (const familyIndex of signature.familyIndices) {
					recordFamilyMatch(state.metadataMatches, familyIndex, "prefix");
					getOrCreateFamilyMatchedPaths(familyMatchedPaths, familyIndex).add(path);
				}
			}
		}
	}
}

function getFamilyMatchCount(
	familyMatchedPaths: ReadonlyMap<number, ReadonlySet<string>>,
	familyIndex: number,
): number {
	return familyMatchedPaths.get(familyIndex)?.size ?? 0;
}

function getOrCreateFamilyMatchedPaths(
	familyMatchedPaths: Map<number, Set<string>>,
	familyIndex: number,
): Set<string> {
	let paths = familyMatchedPaths.get(familyIndex);
	if (!paths) {
		paths = new Set<string>();
		familyMatchedPaths.set(familyIndex, paths);
	}
	return paths;
}

function getOrCreateCandidateState(
	candidates: Map<string, CoverageLexicalCandidateState>,
	path: string,
): CoverageLexicalCandidateState {
	let state = candidates.get(path);
	if (!state) {
		state = {
			bodyMatches: new Map(),
			metadataMatches: new Map(),
			metadataFieldMatches: createEmptyMetadataFieldMatches(),
			phraseMatches: new Set(),
		};
		candidates.set(path, state);
	}
	return state;
}

function collectMetadataFieldCandidatesForTerm(
	index: CoverageLexicalRecallIndex,
	candidates: Map<string, CoverageLexicalCandidateState>,
	familyMatchedPaths: Map<number, Set<string>>,
	familyIndex: number,
	term: string,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): void {
	const fieldEntries: Array<
		[
			CoverageLexicalMetadataField,
			ReadonlyMap<string, ReadonlySet<string>>,
		]
	> = [
		["basename", index.metadataBasenamePostings],
		["aliases", index.metadataAliasPostings],
		["folder", index.metadataFolderPostings],
		["headings", index.metadataHeadingPostings],
		["tags", index.metadataTagPostings],
	];
	for (const [field, postings] of fieldEntries) {
		const matches = postings.get(term);
		if (!matches) {
			continue;
		}
		for (const path of matches) {
			const state = getOrCreateCandidateState(candidates, path);
			recordFamilyMatch(state.metadataMatches, familyIndex, kind);
			recordFamilyMatch(state.metadataFieldMatches[field], familyIndex, kind);
			getOrCreateFamilyMatchedPaths(familyMatchedPaths, familyIndex).add(path);
		}
	}

	const metadataMatches = index.metadataPostings.get(term);
	if (!metadataMatches) {
		return;
	}
	for (const path of metadataMatches) {
		const state = getOrCreateCandidateState(candidates, path);
		recordFamilyMatch(state.metadataMatches, familyIndex, kind);
		getOrCreateFamilyMatchedPaths(familyMatchedPaths, familyIndex).add(path);
	}
}

function recordFamilyMatch(
	matches: Map<number, CoverageFamilyMatchKind>,
	familyIndex: number,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): void {
	const previous = matches.get(familyIndex) ?? null;
	if (pickBetterMatchKind(previous, kind) === previous) {
		return;
	}
	matches.set(familyIndex, kind);
}

function pickBetterMatchKind(
	left: CoverageFamilyMatchKind,
	right: CoverageFamilyMatchKind,
): CoverageFamilyMatchKind {
	const rank = {
		exact: 3,
		prefix: 2,
		fuzzy: 1,
		null: 0,
	} as const;
	return rank[left ?? "null"] >= rank[right ?? "null"] ? left : right;
}

function createEmptyMetadataFieldMatches(): CoverageLexicalCandidateState["metadataFieldMatches"] {
	return {
		basename: new Map(),
		aliases: new Map(),
		folder: new Map(),
		headings: new Map(),
		tags: new Map(),
	};
}

function expandPrefixTerms(
	sortedLexicon: readonly string[],
	prefix: string,
): string[] {
	const out: string[] = [];
	let index = lowerBoundString(sortedLexicon, prefix);
	while (index < sortedLexicon.length) {
		const term = sortedLexicon[index];
		if (!term.startsWith(prefix)) {
			break;
		}
		out.push(term);
		if (out.length >= MAX_PREFIX_EXPANSIONS) {
			break;
		}
		index += 1;
	}
	return out;
}

function expandFuzzyTerms(
	sortedLexicon: readonly string[],
	queryTerm: string,
): string[] {
	const maxDistance = computeMaxFuzzyDistance(queryTerm);
	if (maxDistance <= 0) {
		return [];
	}

	const candidates: Array<{ term: string; distance: number }> = [];
	for (const term of sortedLexicon) {
		if (Math.abs(term.length - queryTerm.length) > maxDistance) {
			continue;
		}
		if (term[0] !== queryTerm[0]) {
			continue;
		}
		const distance = boundedLevenshtein(term, queryTerm, maxDistance);
		if (distance <= maxDistance) {
			candidates.push({ term, distance });
		}
	}

	candidates.sort((left, right) => {
		if (left.distance !== right.distance) {
			return left.distance - right.distance;
		}
		return left.term.localeCompare(right.term);
	});
	return candidates
		.slice(0, MAX_FUZZY_EXPANSIONS)
		.map((candidate) => candidate.term);
}

function lowerBoundString(values: readonly string[], target: string): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		if (values[mid].localeCompare(target) < 0) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function computeMaxFuzzyDistance(term: string): number {
	if (term.length >= 9) {
		return 2;
	}
	if (term.length >= 5) {
		return 1;
	}
	return 0;
}

function boundedLevenshtein(
	left: string,
	right: string,
	maxDistance: number,
): number {
	const leftLength = left.length;
	const rightLength = right.length;
	if (Math.abs(leftLength - rightLength) > maxDistance) {
		return maxDistance + 1;
	}

	const previous = new Array(rightLength + 1);
	const current = new Array(rightLength + 1);
	for (let column = 0; column <= rightLength; column++) {
		previous[column] = column;
	}

	for (let row = 1; row <= leftLength; row++) {
		current[0] = row;
		let rowMin = current[0];
		for (let column = 1; column <= rightLength; column++) {
			const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
			const value = Math.min(
				previous[column] + 1,
				current[column - 1] + 1,
				previous[column - 1] + substitutionCost,
			);
			current[column] = value;
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let column = 0; column <= rightLength; column++) {
			previous[column] = current[column];
		}
	}

	return previous[rightLength];
}
