import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBaseArtifacts } from "./build";
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
		const queryAnalysis = analyzeQuery(queryText, queryTerms);
		const unitFamilyMatches = lookupQueryUnitFamilies(this.residentBase, queryAnalysis);
		const candidateDocs = recallCandidateDocs(
			this.residentBase,
			queryAnalysis,
			unitFamilyMatches,
		);
		const rankedCandidates = candidateDocs
			.map((candidateRecall) =>
				buildPackingProfile(
					this.residentBase!,
					queryAnalysis,
					candidateRecall,
					unitFamilyMatches,
				),
			)
			.filter((candidate) => candidate.realizedCoverageCount > 0)
			.sort(comparePackingProfiles);
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