import type {
	MatchedFile,
} from "src/globals/search-types";
import {
	applyCoverageLexicalV2DisplayPolicy,
} from "../display";
import type {
	CoverageLexicalV2QueryAnalysis,
	CoverageLexicalV2QueryUnit,
} from "../query-units";
import {
	buildCoverageLexicalV2RankingCandidate,
	compareCoverageLexicalV2RankingCandidates,
	selectCoverageLexicalV2TopTieBand,
	type CoverageLexicalV2MatchField,
	type CoverageLexicalV2MatchQualityKind,
	type CoverageLexicalV2MatchedPrimaryUnitEvidence,
	type CoverageLexicalV2RankingEvidence,
	type CoverageLexicalV2RankingRunCandidate,
} from "../ranking";
import type {
	CoverageLexicalV2RuntimeDocumentRecord,
	CoverageLexicalV2RuntimePostingField,
	CoverageLexicalV2RuntimeStorageReader,
} from "./coverage-lexical-runtime-types";
import {
	buildCoverageLexicalV2RuntimeBestWindowForDocument,
	buildCoverageLexicalV2RuntimeMatchedPrimaryUnits,
	type CoverageLexicalV2RuntimeDocumentLexicalState,
	type CoverageLexicalV2RuntimeFieldTerms,
	type CoverageLexicalV2RuntimePrimaryUnitDefinition,
} from "./coverage-lexical-runtime-evidence";
import {
	compareCoverageLexicalV2MatchQuality,
	getCoverageLexicalV2RuntimeMatchQuality,
	isCoverageLexicalV2LatinRuntimeTerm,
	normalizeCoverageLexicalV2RuntimeTerm,
	type CoverageLexicalV2RuntimeMatchOptions,
} from "./coverage-lexical-runtime-match";

type CoverageLexicalV2CascadeCandidateFieldTermSets = {
	basenameTerms: Set<string>;
	aliasTerms: Set<string>;
	headingsTerms: Set<string>;
	folderTerms: Set<string>;
	tagTerms: Set<string>;
	bodyTerms: Set<string>;
};

type CoverageLexicalV2CascadeCandidateExactQueryTerms = {
	basenameExactQueryTerms: Set<string>;
	aliasExactQueryTerms: Set<string>;
	headingsExactQueryTerms: Set<string>;
	bodyExactQueryTerms: Set<string>;
};

type CoverageLexicalV2CascadeCandidateSourceFlags = {
	hasExact: boolean;
	hasPrefix: boolean;
	hasFuzzy: boolean;
	hasFallback: boolean;
	hasMetadata: boolean;
	hasBody: boolean;
	hasBodyExact: boolean;
};

type CoverageLexicalV2CascadeHydrationStatus =
	| "not_requested"
	| "prefetched";

export type CoverageLexicalV2CascadeCandidateState = {
	docId: number;
	path: string;
	stableDeterministicKey: string;
	record: CoverageLexicalV2RuntimeDocumentRecord;
	fieldTerms: CoverageLexicalV2CascadeCandidateFieldTermSets;
	exactQueryTerms: CoverageLexicalV2CascadeCandidateExactQueryTerms;
	exactPrimaryMask: Set<number>;
	prefixPrimaryMask: Set<number>;
	fuzzyPrimaryMask: Set<number>;
	matchedGroupMask: Set<number>;
	matchedLatinGroupMask: Set<number>;
	matchedHanGroupMask: Set<number>;
	bestFieldByPrimaryUnit: Map<number, CoverageLexicalV2MatchField>;
	corroboratedFieldMaskByPrimaryUnit: Map<number, Set<CoverageLexicalV2MatchField>>;
	sourceFlags: CoverageLexicalV2CascadeCandidateSourceFlags;
	needsVerification: boolean;
	hydrationStatus: CoverageLexicalV2CascadeHydrationStatus;
	potentialPrimaryCoverageCount: number;
	fuzzySalvageCoverageCount: number;
	matchedFieldsByPrimaryUnit: Map<number, Set<CoverageLexicalV2MatchField>>;
	bestQualityByPrimaryUnit: Map<number, CoverageLexicalV2MatchQualityKind>;
};

export type CoverageLexicalV2RuntimeCascadePolicy = {
	frontierTarget: number;
	returnTarget: number;
	verificationTarget: number;
	prefixTermCapPerUnit: number;
	prefixDocCapPerQuery: number;
	fuzzyTermCapPerUnit: number;
	fuzzyDocCapPerQuery: number;
	fallbackUnitCapPerHanGroup: number;
	fallbackDocCapPerQuery: number;
};

export type CoverageLexicalV2RuntimeCascadeRequest = {
	queryText: string;
	queryTerms: readonly string[];
	queryAnalysis: CoverageLexicalV2QueryAnalysis;
	maxItemResults: number;
	storageReader: CoverageLexicalV2RuntimeStorageReader;
	matchOptions: CoverageLexicalV2RuntimeMatchOptions;
};

export type CoverageLexicalV2RuntimeCascadeResult = {
	matchedFiles: MatchedFile[];
	candidateStates: CoverageLexicalV2CascadeCandidateState[];
	activeFrontierCandidateIds: string[];
	deferredCandidateIds: string[];
	verificationCandidateIds: string[];
	rankedCandidateIds: string[];
	topTieBandCandidateIds: string[];
	usedFuzzySalvage: boolean;
	policy: CoverageLexicalV2RuntimeCascadePolicy;
};

export type CoverageLexicalV2RuntimeCascadeFrontierPlan = {
	activeFrontier: CoverageLexicalV2CascadeCandidateState[];
	deferredBuckets: CoverageLexicalV2CascadeCandidateState[][];
	usedFuzzySalvage: boolean;
};

const FIELD_PRIORITY: Record<CoverageLexicalV2MatchField, number> = {
	basename: 0,
	aliases: 1,
	headings: 2,
	folder: 3,
	tag: 4,
	body: 5,
};

const SOURCE_FIELDS: readonly CoverageLexicalV2RuntimePostingField[] = [
	"basename",
	"aliases",
	"headings",
	"folder",
	"tag",
	"body",
];

export function resolveCoverageLexicalV2RuntimeCascadePolicy(
	maxItemResults: number,
): CoverageLexicalV2RuntimeCascadePolicy {
	const safeMaxItemResults = Math.max(0, maxItemResults);
	const frontierTarget = Math.min(96, Math.max(24, safeMaxItemResults * 3));
	return {
		frontierTarget,
		returnTarget: safeMaxItemResults + 4,
		verificationTarget: Math.min(16, Math.max(6, safeMaxItemResults + 2)),
		prefixTermCapPerUnit: 32,
		prefixDocCapPerQuery: frontierTarget * 8,
		fuzzyTermCapPerUnit: 16,
		fuzzyDocCapPerQuery: frontierTarget * 4,
		fallbackUnitCapPerHanGroup: 8,
		fallbackDocCapPerQuery: frontierTarget * 2,
	};
}

export async function searchCoverageLexicalV2RuntimeCascade(
	request: CoverageLexicalV2RuntimeCascadeRequest,
): Promise<CoverageLexicalV2RuntimeCascadeResult> {
	const policy = resolveCoverageLexicalV2RuntimeCascadePolicy(request.maxItemResults);
	const runtimePrimaryUnits = request.queryAnalysis.primaryUnits.map(
		(primaryUnit) => toCoverageLexicalV2RuntimePrimaryUnitDefinition(primaryUnit),
	);
	const candidateStates = sourceCoverageLexicalV2CascadeCandidates(
		request.queryAnalysis,
		runtimePrimaryUnits,
		request.storageReader,
		request.matchOptions,
		policy,
	);
	if (candidateStates.length === 0) {
		return {
			matchedFiles: [],
			candidateStates,
			activeFrontierCandidateIds: [],
			deferredCandidateIds: [],
			verificationCandidateIds: [],
			rankedCandidateIds: [],
			topTieBandCandidateIds: [],
			usedFuzzySalvage: false,
			policy,
		};
	}

	const frontierPlan = planCoverageLexicalV2RuntimeCascadeLayer1Frontier(
		candidateStates,
		request.matchOptions.includeFuzzy === true,
		policy,
	);
	const candidateStateById = new Map<string, CoverageLexicalV2CascadeCandidateState>(
		candidateStates.map((candidateState) => [String(candidateState.docId), candidateState]),
	);
	const cheapEvidenceByCandidateId = new Map<string, CoverageLexicalV2RankingEvidence>();
	const activeFrontier = [...frontierPlan.activeFrontier];
	const deferredBuckets = [...frontierPlan.deferredBuckets];

	while (activeFrontier.length > 0) {
		await populateCoverageLexicalV2CascadeEvidence(
			cheapEvidenceByCandidateId,
			activeFrontier,
			request.queryAnalysis,
			runtimePrimaryUnits,
			request.storageReader,
			request.matchOptions,
			false,
		);
		const cheapRanking = rankCoverageLexicalV2CascadeEvidence(
			request.queryAnalysis,
			activeFrontier,
			cheapEvidenceByCandidateId,
		);
		if (cheapRanking.length >= policy.returnTarget || deferredBuckets.length === 0) {
			break;
		}
		const nextBucket = deferredBuckets.shift();
		if (!nextBucket || nextBucket.length === 0) {
			break;
		}
		activeFrontier.push(...nextBucket);
	}

	const cheapRanking = rankCoverageLexicalV2CascadeEvidence(
		request.queryAnalysis,
		activeFrontier,
		cheapEvidenceByCandidateId,
	);
	const verificationCandidateIds = cheapRanking
		.slice(0, policy.verificationTarget)
		.map((candidate) => candidate.evidence.candidateId);
	const verificationStates = verificationCandidateIds
		.map((candidateId) => candidateStateById.get(candidateId) ?? null)
		.filter((candidateState): candidateState is CoverageLexicalV2CascadeCandidateState =>
			candidateState != null && candidateState.needsVerification,
		);
	await hydrateCoverageLexicalV2CascadeVerificationStates(
		verificationStates,
		request.storageReader,
	);
	await populateCoverageLexicalV2CascadeEvidence(
		cheapEvidenceByCandidateId,
		verificationStates,
		request.queryAnalysis,
		runtimePrimaryUnits,
		request.storageReader,
		request.matchOptions,
		true,
	);

	const finalRanking = rankCoverageLexicalV2CascadeEvidence(
		request.queryAnalysis,
		activeFrontier,
		cheapEvidenceByCandidateId,
	);
	const display = applyCoverageLexicalV2DisplayPolicy(finalRanking, {
		maxDisplayCandidates: request.maxItemResults,
	});
	const topTieBand = selectCoverageLexicalV2TopTieBand(
		finalRanking.map((candidate) => candidate.rankingCandidate),
	);
	return {
		matchedFiles: display.visibleCandidates
			.map((candidate) => {
				const candidateState = candidateStateById.get(candidate.evidence.candidateId);
				if (!candidateState) {
					return null;
				}
				return {
					path: candidateState.path,
					queryTerms: [...request.queryTerms],
					matchedTerms: collectCoverageLexicalV2CascadeMatchedTerms(
						candidate.evidence.matchedPrimaryUnits,
					),
				};
			})
			.filter((candidate): candidate is MatchedFile => candidate != null),
		candidateStates,
		activeFrontierCandidateIds: activeFrontier.map((candidateState) => String(candidateState.docId)),
		deferredCandidateIds: deferredBuckets.flat().map((candidateState) => String(candidateState.docId)),
		verificationCandidateIds,
		rankedCandidateIds: finalRanking.map((candidate) => candidate.evidence.candidateId),
		topTieBandCandidateIds: topTieBand.map((candidate) => candidate.candidateId),
		usedFuzzySalvage: frontierPlan.usedFuzzySalvage,
		policy,
	};
}

export function planCoverageLexicalV2RuntimeCascadeLayer1Frontier(
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	includeFuzzy: boolean,
	policy: CoverageLexicalV2RuntimeCascadePolicy,
): CoverageLexicalV2RuntimeCascadeFrontierPlan {
	const maxPotentialPrimaryCoverageCount = candidateStates.reduce(
		(maxCoverage, candidateState) =>
			Math.max(maxCoverage, candidateState.potentialPrimaryCoverageCount),
		0,
	);
	const usedFuzzySalvage = includeFuzzy && maxPotentialPrimaryCoverageCount === 0;
	const eligibleCandidates = candidateStates
		.filter((candidateState) =>
			usedFuzzySalvage
				? candidateState.fuzzySalvageCoverageCount > 0
				: candidateState.potentialPrimaryCoverageCount > 0,
		)
		.sort((left, right) => {
			const leftLayer1Score = usedFuzzySalvage
				? left.fuzzySalvageCoverageCount
				: left.potentialPrimaryCoverageCount;
			const rightLayer1Score = usedFuzzySalvage
				? right.fuzzySalvageCoverageCount
				: right.potentialPrimaryCoverageCount;
			if (leftLayer1Score !== rightLayer1Score) {
				return rightLayer1Score - leftLayer1Score;
			}
			return left.stableDeterministicKey.localeCompare(right.stableDeterministicKey);
		});
	const activeFrontier: CoverageLexicalV2CascadeCandidateState[] = [];
	const deferredBuckets: CoverageLexicalV2CascadeCandidateState[][] = [];
	let index = 0;
	while (index < eligibleCandidates.length) {
		const layer1Score = usedFuzzySalvage
			? eligibleCandidates[index].fuzzySalvageCoverageCount
			: eligibleCandidates[index].potentialPrimaryCoverageCount;
		const bucket: CoverageLexicalV2CascadeCandidateState[] = [];
		while (index < eligibleCandidates.length) {
			const candidateState = eligibleCandidates[index];
			const candidateScore = usedFuzzySalvage
				? candidateState.fuzzySalvageCoverageCount
				: candidateState.potentialPrimaryCoverageCount;
			if (candidateScore !== layer1Score) {
				break;
			}
			bucket.push(candidateState);
			index += 1;
		}
		if (activeFrontier.length < policy.frontierTarget) {
			activeFrontier.push(...bucket);
			continue;
		}
		deferredBuckets.push(bucket);
	}
	return {
		activeFrontier,
		deferredBuckets,
		usedFuzzySalvage,
	};
}

function sourceCoverageLexicalV2CascadeCandidates(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	runtimePrimaryUnits: readonly CoverageLexicalV2RuntimePrimaryUnitDefinition[],
	reader: CoverageLexicalV2RuntimeStorageReader,
	matchOptions: CoverageLexicalV2RuntimeMatchOptions,
	policy: CoverageLexicalV2RuntimeCascadePolicy,
): CoverageLexicalV2CascadeCandidateState[] {
	const candidateStateByDocId = new Map<number, CoverageLexicalV2CascadeCandidateState>();
	const sortedLexicon = reader.getSortedLexicon();
	const prefixDocIds = new Set<number>();
	const fuzzyDocIds = new Set<number>();
	const fallbackDocIds = new Set<number>();

	runtimePrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		collectCoverageLexicalV2CascadeExactMatches(
			candidateStateByDocId,
			primaryUnit,
			primaryUnitIndex,
			reader,
		);
	});

	runtimePrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		if (!matchOptions.includePrefix || !isCoverageLexicalV2LatinRuntimeTerm(primaryUnit.normalizedText)) {
			return;
		}
		const prefixTerms = collectCoverageLexicalV2CascadePrefixTerms(
			primaryUnit.normalizedText,
			sortedLexicon,
			matchOptions,
			policy.prefixTermCapPerUnit,
		);
		for (const prefixTerm of prefixTerms) {
			collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				prefixTerm,
				primaryUnit,
				primaryUnitIndex,
				"prefix",
				reader,
				prefixDocIds,
				policy.prefixDocCapPerQuery,
			);
		}
	});

	const exactAndPrefixCandidateCount = countCoverageLexicalV2CascadePotentialCandidates(candidateStateByDocId);
	if (exactAndPrefixCandidateCount < policy.returnTarget) {
		collectCoverageLexicalV2CascadeFallbackMatches(
			candidateStateByDocId,
			queryAnalysis,
			reader,
			fallbackDocIds,
			policy.fallbackUnitCapPerHanGroup,
			policy.fallbackDocCapPerQuery,
		);
	}

	runtimePrimaryUnits.forEach((primaryUnit, primaryUnitIndex) => {
		if (!matchOptions.includeFuzzy || !isCoverageLexicalV2LatinRuntimeTerm(primaryUnit.normalizedText)) {
			return;
		}
		const fuzzyTerms = collectCoverageLexicalV2CascadeFuzzyTerms(
			primaryUnit.normalizedText,
			sortedLexicon,
			matchOptions,
			policy.fuzzyTermCapPerUnit,
		);
		for (const fuzzyTerm of fuzzyTerms) {
			collectCoverageLexicalV2CascadeExpandedMatches(
				candidateStateByDocId,
				fuzzyTerm,
				primaryUnit,
				primaryUnitIndex,
				"fuzzy",
				reader,
				fuzzyDocIds,
				policy.fuzzyDocCapPerQuery,
			);
		}
	});

	return [...candidateStateByDocId.values()]
		.map((candidateState) => finalizeCoverageLexicalV2CascadeCandidateState(candidateState))
		.sort((left, right) =>
			left.stableDeterministicKey.localeCompare(right.stableDeterministicKey),
		);
}

async function populateCoverageLexicalV2CascadeEvidence(
	target: Map<string, CoverageLexicalV2RankingEvidence>,
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	runtimePrimaryUnits: readonly CoverageLexicalV2RuntimePrimaryUnitDefinition[],
	reader: CoverageLexicalV2RuntimeStorageReader,
	matchOptions: CoverageLexicalV2RuntimeMatchOptions,
	includeBodyTokenSequences: boolean,
): Promise<void> {
	for (const candidateState of candidateStates) {
		const candidateId = String(candidateState.docId);
		if (!includeBodyTokenSequences && target.has(candidateId)) {
			continue;
		}
		const documentState = buildCoverageLexicalV2CascadeRuntimeDocumentState(
			candidateState,
			reader,
			includeBodyTokenSequences,
		);
		const matchedPrimaryUnits = buildCoverageLexicalV2RuntimeMatchedPrimaryUnits(
			runtimePrimaryUnits,
			documentState.fieldTerms,
			matchOptions,
		);
		if (matchedPrimaryUnits.length === 0) {
			continue;
		}
		target.set(candidateId, {
			candidateId,
			stableDeterministicKey: candidateState.stableDeterministicKey,
			matchedPrimaryUnits,
			bestWindow: buildCoverageLexicalV2RuntimeBestWindowForDocument(
				matchedPrimaryUnits,
				documentState,
			),
		});
	}
}

function rankCoverageLexicalV2CascadeEvidence(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	candidateStates: readonly CoverageLexicalV2CascadeCandidateState[],
	evidenceByCandidateId: ReadonlyMap<string, CoverageLexicalV2RankingEvidence>,
): CoverageLexicalV2RankingRunCandidate[] {
	return candidateStates
		.map<CoverageLexicalV2RankingRunCandidate | null>((candidateState) => {
			const evidence = evidenceByCandidateId.get(String(candidateState.docId));
			if (!evidence) {
				return null;
			}
			return {
				evidence,
				rankingCandidate: buildCoverageLexicalV2RankingCandidate(queryAnalysis, evidence),
			};
		})
		.filter((candidate): candidate is CoverageLexicalV2RankingRunCandidate => candidate != null)
		.sort((left, right) =>
			compareCoverageLexicalV2RankingCandidates(
				left.rankingCandidate,
				right.rankingCandidate,
			),
		);
}

async function hydrateCoverageLexicalV2CascadeVerificationStates(
	verificationStates: readonly CoverageLexicalV2CascadeCandidateState[],
	reader: CoverageLexicalV2RuntimeStorageReader,
): Promise<void> {
	const docIds = verificationStates
		.filter((candidateState) => candidateState.hydrationStatus !== "prefetched")
		.map((candidateState) => candidateState.docId);
	if (docIds.length === 0) {
		return;
	}
	await reader.prefetchBodyTokenSequences(docIds);
	for (const candidateState of verificationStates) {
		candidateState.hydrationStatus = "prefetched";
	}
}

function finalizeCoverageLexicalV2CascadeCandidateState(
	candidateState: CoverageLexicalV2CascadeCandidateState,
): CoverageLexicalV2CascadeCandidateState {
	for (const [primaryUnitIndex, matchedFields] of candidateState.matchedFieldsByPrimaryUnit.entries()) {
		const sortedFields = [...matchedFields].sort(
			(left, right) => FIELD_PRIORITY[left] - FIELD_PRIORITY[right],
		);
		if (sortedFields.length === 0) {
			continue;
		}
		candidateState.bestFieldByPrimaryUnit.set(primaryUnitIndex, sortedFields[0]);
		candidateState.corroboratedFieldMaskByPrimaryUnit.set(
			primaryUnitIndex,
			new Set(sortedFields.slice(1)),
		);
	}
	candidateState.potentialPrimaryCoverageCount = countCoverageLexicalV2CascadeMaskUnion(
		candidateState.exactPrimaryMask,
		candidateState.prefixPrimaryMask,
	);
	candidateState.fuzzySalvageCoverageCount = [...candidateState.fuzzyPrimaryMask]
		.filter((primaryUnitIndex) =>
			!candidateState.exactPrimaryMask.has(primaryUnitIndex) &&
			!candidateState.prefixPrimaryMask.has(primaryUnitIndex),
		)
		.length;
	return candidateState;
}

function buildCoverageLexicalV2CascadeRuntimeDocumentState(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	reader: CoverageLexicalV2RuntimeStorageReader,
	includeBodyTokenSequences: boolean,
): CoverageLexicalV2RuntimeDocumentLexicalState {
	return {
		docId: candidateState.docId,
		path: candidateState.path,
		stableDeterministicKey: candidateState.stableDeterministicKey,
		fieldTerms: toCoverageLexicalV2RuntimeFieldTerms(candidateState.fieldTerms),
		basenameTokenSequence: candidateState.exactQueryTerms.basenameExactQueryTerms.size > 0
			? tokenizeCoverageLexicalV2CascadeRuntimeText(reader, candidateState.record.basenameText)
			: undefined,
		aliasTokenSequence: candidateState.exactQueryTerms.aliasExactQueryTerms.size > 0
			? tokenizeCoverageLexicalV2CascadeRuntimeText(reader, candidateState.record.aliasesText)
			: undefined,
		headingsTokenSequence: candidateState.exactQueryTerms.headingsExactQueryTerms.size > 0
			? tokenizeCoverageLexicalV2CascadeRuntimeText(reader, candidateState.record.headingsText)
			: undefined,
		bodyTokenSequence:
			includeBodyTokenSequences &&
			candidateState.exactQueryTerms.bodyExactQueryTerms.size > 0
				? [...(reader.getBodyTokenSequence(candidateState.docId) ?? [])]
				: undefined,
	};
}

function collectCoverageLexicalV2CascadeExactMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	primaryUnit: CoverageLexicalV2RuntimePrimaryUnitDefinition,
	primaryUnitIndex: number,
	reader: CoverageLexicalV2RuntimeStorageReader,
): void {
	for (const field of SOURCE_FIELDS) {
		const postings = reader.getPostingMatches(field, primaryUnit.normalizedText);
		collectCoverageLexicalV2CascadePostingMatches(
			target,
			postings,
			reader,
			field,
			primaryUnit.normalizedText,
			primaryUnit,
			primaryUnitIndex,
			"exact",
			true,
		);
	}
}

function collectCoverageLexicalV2CascadeExpandedMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	candidateTerm: string,
	primaryUnit: CoverageLexicalV2RuntimePrimaryUnitDefinition,
	primaryUnitIndex: number,
	quality: "prefix" | "fuzzy",
	reader: CoverageLexicalV2RuntimeStorageReader,
	sourceDocIds: Set<number>,
	docCap: number,
): void {
	for (const field of SOURCE_FIELDS) {
		const postings = reader.getPostingMatches(field, candidateTerm);
		collectCoverageLexicalV2CascadePostingMatches(
			target,
			postings,
			reader,
			field,
			candidateTerm,
			primaryUnit,
			primaryUnitIndex,
			quality,
			false,
			sourceDocIds,
			docCap,
		);
	}
}

function collectCoverageLexicalV2CascadeFallbackMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	reader: CoverageLexicalV2RuntimeStorageReader,
	fallbackDocIds: Set<number>,
	fallbackUnitCapPerHanGroup: number,
	fallbackDocCapPerQuery: number,
): void {
	const fallbackUnitsByGroup = new Map<number, string[]>();
	for (const fallbackUnit of queryAnalysis.fallbackUnits) {
		if (fallbackUnit.surfaceKind !== "han" && fallbackUnit.surfaceKind !== "mixed") {
			continue;
		}
		const groupTerms = fallbackUnitsByGroup.get(fallbackUnit.surfaceGroupIndex) ?? [];
		if (groupTerms.includes(fallbackUnit.normalizedText)) {
			continue;
		}
		if (groupTerms.length >= fallbackUnitCapPerHanGroup) {
			continue;
		}
		groupTerms.push(fallbackUnit.normalizedText);
		fallbackUnitsByGroup.set(fallbackUnit.surfaceGroupIndex, groupTerms);
	}
	for (const groupTerms of fallbackUnitsByGroup.values()) {
		for (const fallbackTerm of groupTerms) {
			for (const field of SOURCE_FIELDS) {
				const postings = reader.getPostingMatches(field, fallbackTerm);
				if (!postings) {
					continue;
				}
				for (const docId of postings) {
					const candidateState = getOrCreateCoverageLexicalV2CascadeCandidateState(
						target,
						Number(docId),
						reader,
						fallbackDocIds,
						fallbackDocCapPerQuery,
					);
					if (!candidateState) {
						continue;
					}
					updateCoverageLexicalV2CascadeFallbackEvidence(
						candidateState,
						field,
						fallbackTerm,
					);
				}
			}
		}
	}
}

function collectCoverageLexicalV2CascadePostingMatches(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	postings: readonly number[] | Uint32Array | undefined,
	reader: CoverageLexicalV2RuntimeStorageReader,
	field: CoverageLexicalV2RuntimePostingField,
	matchedTerm: string,
	primaryUnit: CoverageLexicalV2RuntimePrimaryUnitDefinition,
	primaryUnitIndex: number,
	quality: CoverageLexicalV2MatchQualityKind,
	isExactQueryMatch: boolean,
	sourceDocIds?: Set<number>,
	docCap?: number,
): void {
	if (!postings) {
		return;
	}
	for (const docIdValue of postings) {
		const docId = Number(docIdValue);
		const candidateState = getOrCreateCoverageLexicalV2CascadeCandidateState(
			target,
			docId,
			reader,
			sourceDocIds,
			docCap,
		);
		if (!candidateState) {
			continue;
		}
		updateCoverageLexicalV2CascadePrimaryEvidence(
			candidateState,
			field,
			matchedTerm,
			primaryUnit,
			primaryUnitIndex,
			quality,
			isExactQueryMatch,
		);
	}
}

function updateCoverageLexicalV2CascadePrimaryEvidence(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	field: CoverageLexicalV2RuntimePostingField,
	matchedTerm: string,
	primaryUnit: CoverageLexicalV2RuntimePrimaryUnitDefinition,
	primaryUnitIndex: number,
	quality: CoverageLexicalV2MatchQualityKind,
	isExactQueryMatch: boolean,
): void {
	addCoverageLexicalV2CascadeFieldTerm(candidateState.fieldTerms, field, matchedTerm);
	if (isExactQueryMatch) {
		addCoverageLexicalV2CascadeExactQueryTerm(
			candidateState.exactQueryTerms,
			field,
			primaryUnit.normalizedText,
		);
	}
	switch (quality) {
		case "exact":
			candidateState.exactPrimaryMask.add(primaryUnitIndex);
			candidateState.sourceFlags.hasExact = true;
			break;
		case "prefix":
			candidateState.prefixPrimaryMask.add(primaryUnitIndex);
			candidateState.sourceFlags.hasPrefix = true;
			break;
		case "fuzzy":
			candidateState.fuzzyPrimaryMask.add(primaryUnitIndex);
			candidateState.sourceFlags.hasFuzzy = true;
			break;
	}
	candidateState.matchedGroupMask.add(primaryUnit.surfaceGroupIndex);
	if (primaryUnit.surfaceKind === "latin" || primaryUnit.surfaceKind === "mixed") {
		candidateState.matchedLatinGroupMask.add(primaryUnit.surfaceGroupIndex);
	}
	if (primaryUnit.surfaceKind === "han" || primaryUnit.surfaceKind === "mixed") {
		candidateState.matchedHanGroupMask.add(primaryUnit.surfaceGroupIndex);
	}
	const matchedFields = candidateState.matchedFieldsByPrimaryUnit.get(primaryUnitIndex) ?? new Set<CoverageLexicalV2MatchField>();
	matchedFields.add(field);
	candidateState.matchedFieldsByPrimaryUnit.set(primaryUnitIndex, matchedFields);
	const currentBestQuality = candidateState.bestQualityByPrimaryUnit.get(primaryUnitIndex);
	if (
		currentBestQuality == null ||
		compareCoverageLexicalV2MatchQuality(quality, currentBestQuality) < 0
	) {
		candidateState.bestQualityByPrimaryUnit.set(primaryUnitIndex, quality);
	}
	if (field === "body") {
		candidateState.sourceFlags.hasBody = true;
		if (isExactQueryMatch) {
			candidateState.sourceFlags.hasBodyExact = true;
			candidateState.needsVerification = true;
		}
	} else {
		candidateState.sourceFlags.hasMetadata = true;
	}
}

function updateCoverageLexicalV2CascadeFallbackEvidence(
	candidateState: CoverageLexicalV2CascadeCandidateState,
	field: CoverageLexicalV2RuntimePostingField,
	matchedTerm: string,
): void {
	addCoverageLexicalV2CascadeFieldTerm(candidateState.fieldTerms, field, matchedTerm);
	candidateState.sourceFlags.hasFallback = true;
	if (field === "body") {
		candidateState.sourceFlags.hasBody = true;
		return;
	}
	candidateState.sourceFlags.hasMetadata = true;
}

function getOrCreateCoverageLexicalV2CascadeCandidateState(
	target: Map<number, CoverageLexicalV2CascadeCandidateState>,
	docId: number,
	reader: CoverageLexicalV2RuntimeStorageReader,
	sourceDocIds?: Set<number>,
	docCap?: number,
): CoverageLexicalV2CascadeCandidateState | null {
	const existing = target.get(docId);
	if (existing) {
		return existing;
	}
	if (sourceDocIds && docCap != null && sourceDocIds.size >= docCap) {
		return null;
	}
	const record = reader.getDocumentRecord(docId);
	if (!record) {
		return null;
	}
	if (sourceDocIds) {
		sourceDocIds.add(docId);
	}
	const created: CoverageLexicalV2CascadeCandidateState = {
		docId,
		path: record.path,
		stableDeterministicKey: record.stableDeterministicKey ?? record.path,
		record,
		fieldTerms: createCoverageLexicalV2CascadeCandidateFieldTermSets(),
		exactQueryTerms: createCoverageLexicalV2CascadeCandidateExactQueryTerms(),
		exactPrimaryMask: new Set<number>(),
		prefixPrimaryMask: new Set<number>(),
		fuzzyPrimaryMask: new Set<number>(),
		matchedGroupMask: new Set<number>(),
		matchedLatinGroupMask: new Set<number>(),
		matchedHanGroupMask: new Set<number>(),
		bestFieldByPrimaryUnit: new Map<number, CoverageLexicalV2MatchField>(),
		corroboratedFieldMaskByPrimaryUnit: new Map<number, Set<CoverageLexicalV2MatchField>>(),
		sourceFlags: {
			hasExact: false,
			hasPrefix: false,
			hasFuzzy: false,
			hasFallback: false,
			hasMetadata: false,
			hasBody: false,
			hasBodyExact: false,
		},
		needsVerification: false,
		hydrationStatus: "not_requested",
		potentialPrimaryCoverageCount: 0,
		fuzzySalvageCoverageCount: 0,
		matchedFieldsByPrimaryUnit: new Map<number, Set<CoverageLexicalV2MatchField>>(),
		bestQualityByPrimaryUnit: new Map<number, CoverageLexicalV2MatchQualityKind>(),
	};
	target.set(docId, created);
	return created;
}

function collectCoverageLexicalV2CascadePrefixTerms(
	queryTerm: string,
	sortedLexicon: readonly string[],
	matchOptions: CoverageLexicalV2RuntimeMatchOptions,
	termCap: number,
): string[] {
	if (termCap <= 0) {
		return [];
	}
	const expansions: string[] = [];
	let termIndex = lowerBoundCoverageLexicalV2CascadeString(sortedLexicon, queryTerm);
	while (termIndex < sortedLexicon.length && expansions.length < termCap) {
		const candidateTerm = sortedLexicon[termIndex];
		if (!candidateTerm.startsWith(queryTerm)) {
			break;
		}
		if (
			candidateTerm !== queryTerm &&
			getCoverageLexicalV2RuntimeMatchQuality(queryTerm, candidateTerm, matchOptions) === "prefix"
		) {
			expansions.push(candidateTerm);
		}
		termIndex += 1;
	}
	return expansions;
}

function collectCoverageLexicalV2CascadeFuzzyTerms(
	queryTerm: string,
	sortedLexicon: readonly string[],
	matchOptions: CoverageLexicalV2RuntimeMatchOptions,
	termCap: number,
): string[] {
	if (termCap <= 0) {
		return [];
	}
	const expansions: string[] = [];
	for (const candidateTerm of sortedLexicon) {
		if (expansions.length >= termCap) {
			break;
		}
		if (candidateTerm === queryTerm) {
			continue;
		}
		if (
			getCoverageLexicalV2RuntimeMatchQuality(queryTerm, candidateTerm, matchOptions) === "fuzzy"
		) {
			expansions.push(candidateTerm);
		}
	}
	return expansions;
}

function countCoverageLexicalV2CascadePotentialCandidates(
	candidateStateByDocId: ReadonlyMap<number, CoverageLexicalV2CascadeCandidateState>,
): number {
	let count = 0;
	for (const candidateState of candidateStateByDocId.values()) {
		if (
			candidateState.exactPrimaryMask.size > 0 ||
			candidateState.prefixPrimaryMask.size > 0
		) {
			count += 1;
		}
	}
	return count;
}

function addCoverageLexicalV2CascadeFieldTerm(
	fieldTerms: CoverageLexicalV2CascadeCandidateFieldTermSets,
	field: CoverageLexicalV2RuntimePostingField,
	term: string,
): void {
	switch (field) {
		case "basename":
			fieldTerms.basenameTerms.add(term);
			return;
		case "aliases":
			fieldTerms.aliasTerms.add(term);
			return;
		case "headings":
			fieldTerms.headingsTerms.add(term);
			return;
		case "folder":
			fieldTerms.folderTerms.add(term);
			return;
		case "tag":
			fieldTerms.tagTerms.add(term);
			return;
		case "body":
			fieldTerms.bodyTerms.add(term);
			return;
	}
}

function addCoverageLexicalV2CascadeExactQueryTerm(
	exactQueryTerms: CoverageLexicalV2CascadeCandidateExactQueryTerms,
	field: CoverageLexicalV2RuntimePostingField,
	term: string,
): void {
	switch (field) {
		case "basename":
			exactQueryTerms.basenameExactQueryTerms.add(term);
			return;
		case "aliases":
			exactQueryTerms.aliasExactQueryTerms.add(term);
			return;
		case "headings":
			exactQueryTerms.headingsExactQueryTerms.add(term);
			return;
		case "body":
			exactQueryTerms.bodyExactQueryTerms.add(term);
			return;
		case "folder":
		case "tag":
			return;
	}
}

function createCoverageLexicalV2CascadeCandidateFieldTermSets():
CoverageLexicalV2CascadeCandidateFieldTermSets {
	return {
		basenameTerms: new Set<string>(),
		aliasTerms: new Set<string>(),
		headingsTerms: new Set<string>(),
		folderTerms: new Set<string>(),
		tagTerms: new Set<string>(),
		bodyTerms: new Set<string>(),
	};
}

function createCoverageLexicalV2CascadeCandidateExactQueryTerms():
CoverageLexicalV2CascadeCandidateExactQueryTerms {
	return {
		basenameExactQueryTerms: new Set<string>(),
		aliasExactQueryTerms: new Set<string>(),
		headingsExactQueryTerms: new Set<string>(),
		bodyExactQueryTerms: new Set<string>(),
	};
}

function toCoverageLexicalV2RuntimeFieldTerms(
	fieldTerms: CoverageLexicalV2CascadeCandidateFieldTermSets,
): CoverageLexicalV2RuntimeFieldTerms {
	return {
		basenameTerms: fieldTerms.basenameTerms.size > 0 ? [...fieldTerms.basenameTerms] : undefined,
		aliasTerms: fieldTerms.aliasTerms.size > 0 ? [...fieldTerms.aliasTerms] : undefined,
		headingsTerms: fieldTerms.headingsTerms.size > 0 ? [...fieldTerms.headingsTerms] : undefined,
		folderTerms: fieldTerms.folderTerms.size > 0 ? [...fieldTerms.folderTerms] : undefined,
		tagTerms: fieldTerms.tagTerms.size > 0 ? [...fieldTerms.tagTerms] : undefined,
		bodyTerms: fieldTerms.bodyTerms.size > 0 ? [...fieldTerms.bodyTerms] : undefined,
	};
}

function tokenizeCoverageLexicalV2CascadeRuntimeText(
	reader: CoverageLexicalV2RuntimeStorageReader,
	text: string,
): readonly string[] | undefined {
	const tokenSequence = reader.tokenizeText(text);
	return tokenSequence.length > 0 ? [...tokenSequence] : undefined;
}

function toCoverageLexicalV2RuntimePrimaryUnitDefinition(
	primaryUnit: CoverageLexicalV2QueryUnit,
): CoverageLexicalV2RuntimePrimaryUnitDefinition {
	return {
		normalizedText: normalizeCoverageLexicalV2RuntimeTerm(primaryUnit.normalizedText),
		surfaceGroupIndex: primaryUnit.surfaceGroupIndex,
		surfaceKind: toCoverageLexicalV2RuntimeSurfaceKind(primaryUnit),
	};
}

function toCoverageLexicalV2RuntimeSurfaceKind(
	primaryUnit: CoverageLexicalV2QueryUnit,
): CoverageLexicalV2RuntimePrimaryUnitDefinition["surfaceKind"] {
	switch (primaryUnit.surfaceKind) {
		case "han":
			return "han";
		case "mixed":
			return "mixed";
		case "latin":
		case "other":
			return "latin";
	}
}

function collectCoverageLexicalV2CascadeMatchedTerms(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): string[] {
	return [...new Set(matchedPrimaryUnits.map((matchedPrimaryUnit) => matchedPrimaryUnit.normalizedText))];
}

function countCoverageLexicalV2CascadeMaskUnion(
	left: ReadonlySet<number>,
	right: ReadonlySet<number>,
): number {
	const values = new Set<number>(left);
	for (const value of right) {
		values.add(value);
	}
	return values.size;
}

function lowerBoundCoverageLexicalV2CascadeString(
	values: readonly string[],
	target: string,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (compareCoverageLexicalV2CascadeStrings(values[middle], target) < 0) {
			low = middle + 1;
			continue;
		}
		high = middle;
	}
	return low;
}

function compareCoverageLexicalV2CascadeStrings(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
