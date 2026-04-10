import type {
	CoverageLexicalV2CoarseOptions,
	CoverageLexicalV2SourceCandidate,
	CoverageLexicalV2SourceKind,
} from "../coarse";
import type {
	CoverageLexicalV2BestWindowEvidence,
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
} from "../ranking";
import {
	runCoverageLexicalV2PrototypeSearch,
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
	options: CoverageLexicalV2CoarseOptions = {},
): CoverageLexicalV2PrototypeSearchResult {
	return runCoverageLexicalV2PrototypeSearch(
		queryText,
		queryTerms,
		adaptCoverageLexicalV2RuntimeSourceEntries(entries),
		options,
	);
}
