import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBaseArtifacts } from "./build";
import {
	logCoverageLexicalV3Debug,
	nowDebugMs,
	shouldLogCoverageLexicalV3Debug,
} from "./debug";
import type {
	ResidentBase,
	ResidentBaseMetrics,
	ResidentBaseSummary,
} from "./layout/types";
import { describeResidentBase } from "./metrics";
import { analyzeQuery } from "./query";
import type { V3DocumentTokenizer } from "./query";
import {
	recallCandidateDocs,
	lookupQueryUnitFamilies,
	type V3QueryUnitFamilyMatches,
	type V3RecallState,
} from "./recall";
import {
	buildPackingProfile,
	comparePackingProfiles,
	type EvidencePackingProfile,
} from "./ranking";

export type CoverageLexicalV3SearchResult = Readonly<{
	recallState: V3RecallState;
	rankedCandidates: readonly EvidencePackingProfile[];
}>;

export class CoverageLexicalV3Engine {
	private residentBase: ResidentBase | null = null;

	buildResidentBase(
		documents: readonly IndexedDocument[],
		tokenizeDocumentText?: V3DocumentTokenizer,
	): ResidentBase {
		const artifacts = buildResidentBaseArtifacts(documents, tokenizeDocumentText);
		this.residentBase = artifacts.base;
		return artifacts.base;
	}

	loadResidentBase(residentBase: ResidentBase): void {
		this.residentBase = residentBase;
	}

	getResidentBase(): ResidentBase | null {
		return this.residentBase;
	}

	getResidentBaseMetrics(): ResidentBaseMetrics | null {
		return this.residentBase?.metrics ?? null;
	}

	describeResidentBase(): ResidentBaseSummary | null {
		if (this.residentBase == null) {
			return null;
		}
		return describeResidentBase(this.residentBase);
	}

	search(
		queryText: string,
		queryTerms: readonly string[] = [],
	): CoverageLexicalV3SearchResult {
		if (this.residentBase == null) {
			throw new Error("CoverageLexicalV3Engine.search requires a resident base");
		}
		const shouldLogDebug = shouldLogCoverageLexicalV3Debug(queryText);
		const startedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const analyzeStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const queryAnalysis = analyzeQuery(queryText, queryTerms);
		const analyzeMs = shouldLogDebug ? nowDebugMs() - analyzeStartedAtMs : 0;
		const familyLookupStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const unitFamilyMatches = lookupQueryUnitFamilies(this.residentBase, queryAnalysis);
		const familyLookupMs = shouldLogDebug ? nowDebugMs() - familyLookupStartedAtMs : 0;
		const recallStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const candidateDocs = recallCandidateDocs(
			this.residentBase,
			queryAnalysis,
			unitFamilyMatches,
		);
		const recallMs = shouldLogDebug ? nowDebugMs() - recallStartedAtMs : 0;
		const packingStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const rankedCandidatesBeforeSort = candidateDocs
			.map((candidateRecall) =>
				buildPackingProfile(
					this.residentBase!,
					queryAnalysis,
					candidateRecall,
					unitFamilyMatches,
				),
			)
			.filter((candidate) => candidate.realizedCoverageCount > 0);
		const packingMs = shouldLogDebug ? nowDebugMs() - packingStartedAtMs : 0;
		const sortStartedAtMs = shouldLogDebug ? nowDebugMs() : 0;
		const rankedCandidates = rankedCandidatesBeforeSort.sort(comparePackingProfiles);
		const sortMs = shouldLogDebug ? nowDebugMs() - sortStartedAtMs : 0;
		if (shouldLogDebug) {
			logCoverageLexicalV3Debug("engine.search", {
				queryText,
				queryTermCount: queryTerms.length,
				primaryUnitCount: queryAnalysis.primaryUnits.length,
				hanBackstopGroupCount: queryAnalysis.hanBackstopGroups.length,
				candidateDocCount: candidateDocs.length,
				rankedCandidateCount: rankedCandidates.length,
				totalShortlistedBodyBlockCount: candidateDocs.reduce(
					(sum, candidateRecall) =>
						sum + candidateRecall.shortlistedBodyBlockIds.length,
					0,
				),
				maxShortlistedBodyBlockCount: candidateDocs.reduce(
					(max, candidateRecall) =>
						Math.max(max, candidateRecall.shortlistedBodyBlockIds.length),
					0,
				),
				unitFamilyMatchTotals: summarizeUnitFamilyMatches(unitFamilyMatches),
				phaseMs: {
					analyze: roundDebugMs(analyzeMs),
					familyLookup: roundDebugMs(familyLookupMs),
					recall: roundDebugMs(recallMs),
					packing: roundDebugMs(packingMs),
					sort: roundDebugMs(sortMs),
					total: roundDebugMs(nowDebugMs() - startedAtMs),
				},
			});
		}
		return {
			recallState: {
				queryAnalysis,
				unitFamilyMatches,
				candidateDocs,
			},
			rankedCandidates,
		};
	}
}

function summarizeUnitFamilyMatches(
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
): Readonly<{
	totalMatchCount: number;
	exactMatchCount: number;
	prefixMatchCount: number;
	fuzzyMatchCount: number;
	topUnitsByMatchCount: ReadonlyArray<{
		unitText: string;
		total: number;
		exact: number;
		prefix: number;
		fuzzy: number;
	}>;
}> {
	const unitSummaries = unitFamilyMatches
		.map((unitMatches) => {
			const exact = unitMatches.matches.filter((match) => match.matchKind === "exact").length;
			const prefix = unitMatches.matches.filter(
				(match) => match.matchKind === "prefix",
			).length;
			const fuzzy = unitMatches.matches.filter((match) => match.matchKind === "fuzzy").length;
			return {
				unitText: unitMatches.queryUnitText,
				total: unitMatches.matches.length,
				exact,
				prefix,
				fuzzy,
			};
		})
		.filter((unitSummary) => unitSummary.total > 0);
	const topUnitsByMatchCount = [...unitSummaries]
		.sort((left, right) => {
			return (
				right.total - left.total ||
				right.prefix - left.prefix ||
				left.unitText.localeCompare(right.unitText)
			);
		})
		.slice(0, 8);
	return {
		totalMatchCount: unitSummaries.reduce((sum, unitSummary) => sum + unitSummary.total, 0),
		exactMatchCount: unitSummaries.reduce((sum, unitSummary) => sum + unitSummary.exact, 0),
		prefixMatchCount: unitSummaries.reduce((sum, unitSummary) => sum + unitSummary.prefix, 0),
		fuzzyMatchCount: unitSummaries.reduce((sum, unitSummary) => sum + unitSummary.fuzzy, 0),
		topUnitsByMatchCount,
	};
}

function roundDebugMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}
