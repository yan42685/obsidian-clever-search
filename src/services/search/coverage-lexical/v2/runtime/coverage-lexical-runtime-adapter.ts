import type {
	MatchedFile,
} from "src/globals/search-types";
import type {
	CoverageLexicalV2SourceCandidate,
	CoverageLexicalV2SourceKind,
} from "../coarse";
import type {
	CoverageLexicalV2DisplayOptions,
} from "../display";
import type {
	CoverageLexicalV2BestWindowEvidence,
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
} from "../ranking";
import {
	runCoverageLexicalV2PrototypeSearch,
	type CoverageLexicalV2PrototypeSearchOptions,
	type CoverageLexicalV2PrototypeSearchResult,
} from "../coverage-lexical-v2-prototype-engine";

export type CoverageLexicalV2RuntimeSourceEntry = {
	docId: string | number;
	stableDeterministicKey?: string;
	path?: string;
	sourceKind: CoverageLexicalV2SourceKind;
	matchedPrimaryUnits?: CoverageLexicalV2MatchedPrimaryUnitEvidence[];
	bestWindow?: CoverageLexicalV2BestWindowEvidence | null;
};

export type CoverageLexicalV2RuntimePrototypeSearchOptions = CoverageLexicalV2PrototypeSearchOptions &
	CoverageLexicalV2DisplayOptions;

export type CoverageLexicalV2RuntimeSearchProjection = {
	prototype: CoverageLexicalV2PrototypeSearchResult;
	matchedFiles: MatchedFile[];
};

export function adaptCoverageLexicalV2RuntimeSourceEntries(
	entries: readonly CoverageLexicalV2RuntimeSourceEntry[],
): CoverageLexicalV2SourceCandidate[] {
	return entries.map((entry) => ({
		candidateId: String(entry.docId),
		stableDeterministicKey: entry.stableDeterministicKey ?? entry.path ?? String(entry.docId),
		sourceKind: entry.sourceKind,
		matchedPrimaryUnits: entry.matchedPrimaryUnits,
		bestWindow: entry.bestWindow ?? null,
	}));
}

export function runCoverageLexicalV2RuntimePrototypeSearch(
	queryText: string,
	queryTerms: readonly string[],
	entries: readonly CoverageLexicalV2RuntimeSourceEntry[],
	options: CoverageLexicalV2RuntimePrototypeSearchOptions = {},
): CoverageLexicalV2PrototypeSearchResult {
	return runCoverageLexicalV2PrototypeSearch(
		queryText,
		queryTerms,
		adaptCoverageLexicalV2RuntimeSourceEntries(entries),
		options,
	);
}

export function projectCoverageLexicalV2RuntimeMatchedFiles(
	queryText: string,
	queryTerms: readonly string[],
	entries: readonly CoverageLexicalV2RuntimeSourceEntry[],
	options: CoverageLexicalV2RuntimePrototypeSearchOptions = {},
): CoverageLexicalV2RuntimeSearchProjection {
	const prototype = runCoverageLexicalV2RuntimePrototypeSearch(queryText, queryTerms, entries, options);
	const entryByCandidateId = new Map<string, CoverageLexicalV2RuntimeSourceEntry>();
	for (const entry of entries) {
		const candidateId = String(entry.docId);
		if (!entryByCandidateId.has(candidateId)) {
			entryByCandidateId.set(candidateId, entry);
		}
	}
	const matchedFiles: MatchedFile[] = prototype.display.visibleCandidates
		.map((candidate) => {
			const entry = entryByCandidateId.get(candidate.evidence.candidateId);
			if (!entry?.path) {
				return null;
			}
			return {
				path: entry.path,
				queryTerms: [...queryTerms],
				matchedTerms: collectMatchedTerms(candidate.evidence.matchedPrimaryUnits),
			};
		})
		.filter((value): value is MatchedFile => value != null);
	return {
		prototype,
		matchedFiles,
	};
}

function collectMatchedTerms(
	units: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): string[] {
	return [...new Set(units.map((unit) => unit.normalizedText))];
}
