import type { ResidentBase } from "../layout/types";
import type { HanRescueAssessment } from "../han-rescue";
import { BODY_LOCALITY_MAX_ADJACENT_GAP } from "../body-locality/constants";
import type { V3QueryAnalysis, V3QuerySurfaceGroup, V3QueryUnit } from "../query/analysis";
import {
	normalizeText,
	splitBodyBlocksWithDocumentTokenizer,
} from "../query/text";
import { getLiveDocBodyBlockIds, type V3CandidateDocRecall, type V3ResolvedHanSurfaceGroup } from "../recall";
import { resolveCandidateHanSurfaceGroups } from "../recall/han-surface-groups";
import type { SingletonHanTarget } from "../singleton-han";
import {
	buildWeightedGapIndex,
	computeWeightedAdjacentBoundaryGap,
	computeWeightedBoundaryGap,
	computeWeightedGap,
	type WeightedGapIndex,
} from "../weighted-gap";
import type { EvidencePackingProfile } from "../ranking";
import {
	collectOpaqueBigramOccurrencesInText,
	collectRealizedFamilyOccurrencesInText,
	resolveConfirmedSurfaceSpans,
	type PrimitiveTextOccurrence,
} from "../primitive-evidence";
import { compareV3DirectSubitemCandidates } from "./ranker";
import type {
	V3DirectSubitemAnchorTier,
	V3DirectSubitemAtom,
	V3DirectSubitemCandidate,
	V3DirectSubitemComponent,
	V3DirectSubitemHighlightTier,
	V3DirectSubitemResidualScopeTier,
} from "./contracts";
import type { V3DirectSubitemPreparedText } from "./contracts";

const COMBINING_MARK_REGEX = /\p{M}/u;

export function normalizeV3DirectSubitemSnapshotText(snapshotText: string): string {
	return normalizeText(snapshotText).replace(/\r\n?/gu, "\n");
}

export function prepareV3DirectSubitemSnapshotText(
	snapshotText: string,
): V3DirectSubitemPreparedText {
	const normalized = normalizeDirectSubitemTextWithOffsetMap(snapshotText);
	const normalizedText = normalized.text;
	const blocks = splitBodyBlocksWithDocumentTokenizer(normalizedText);
	let offset = 0;
	const rawBlocks: V3DirectSubitemPreparedText["rawBlocks"] = blocks.map((block, index) => {
		const start = normalizedText.indexOf(block.normalizedText, offset);
		const blockStart = start >= 0 ? start : offset;
		const blockEnd = blockStart + block.normalizedText.length;
		offset = blockEnd;
		return {
			blockId: index,
			ordinal: block.ordinal,
			start: blockStart,
			end: blockEnd,
			text: block.normalizedText,
		};
	});
	return {
		text: normalizedText,
		normalizedOffsetToOriginalOffset: normalized.normalizedOffsetToOriginalOffset,
		rawBlocks,
	};
}

function normalizeDirectSubitemTextWithOffsetMap(
	text: string,
): Pick<V3DirectSubitemPreparedText, "text" | "normalizedOffsetToOriginalOffset"> {
	let normalizedText = "";
	const normalizedOffsetToOriginalOffset: number[] = [];
	for (let offset = 0; offset < text.length;) {
		const rawChar = text[offset] ?? "";
		if (rawChar === "\r") {
			const nextOffset = text[offset + 1] === "\n" ? offset + 2 : offset + 1;
			normalizedOffsetToOriginalOffset[normalizedText.length] = offset;
			normalizedText += "\n";
			normalizedOffsetToOriginalOffset[normalizedText.length] = nextOffset;
			offset = nextOffset;
			continue;
		}
		const nextOffset = findNormalizationClusterEnd(text, offset);
		const normalizedChar = normalizeText(text.slice(offset, nextOffset));
		for (let index = 0; index < normalizedChar.length; index += 1) {
			normalizedOffsetToOriginalOffset[normalizedText.length + index] = offset;
		}
		normalizedText += normalizedChar;
		normalizedOffsetToOriginalOffset[normalizedText.length] = nextOffset;
		offset = nextOffset;
	}
	normalizedOffsetToOriginalOffset[normalizedText.length] = text.length;
	return {
		text: normalizedText,
		normalizedOffsetToOriginalOffset,
	};
}

function findNormalizationClusterEnd(text: string, offset: number): number {
	let end = nextCodePointOffset(text, offset);
	while (end < text.length) {
		const nextEnd = nextCodePointOffset(text, end);
		const char = text.slice(end, nextEnd);
		if (!COMBINING_MARK_REGEX.test(char)) {
			break;
		}
		end = nextEnd;
	}
	return end;
}

function nextCodePointOffset(text: string, offset: number): number {
	const codePoint = text.codePointAt(offset);
	if (codePoint == null) {
		return offset + 1;
	}
	return offset + String.fromCodePoint(codePoint).length;
}

const DIRECT_SUBITEM_SINGLETON_HAN_TIER_SCORE = {
	none: 0,
	tight: 1,
} as const;

type RawBlock = Readonly<{
	blockId: number;
	ordinal: number;
	start: number;
	end: number;
	text: string;
}>;

type LocalScope = Readonly<{
	scopeStart: number;
	scopeEnd: number;
	scopeTier: V3DirectSubitemResidualScopeTier;
	blocks: readonly RawBlock[];
}>;

type BuildScopeContext = Readonly<{
	snapshotText: string;
	snapshotGapIndex: WeightedGapIndex;
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	candidateRecall: V3CandidateDocRecall;
	scope: LocalScope;
	unitByIndex: ReadonlyMap<number, V3QueryUnit>;
	surfaceGroupByIndex: ReadonlyMap<number, V3QuerySurfaceGroup>;
	resolvedHanSurfaceGroupByIndex: ReadonlyMap<number, V3ResolvedHanSurfaceGroup>;
	hanRescueAssessmentByGroupIndex: ReadonlyMap<number, HanRescueAssessment>;
	singletonHanTargets: readonly SingletonHanTarget[];
	blockById: ReadonlyMap<number, RawBlock>;
	blockGapIndexById: ReadonlyMap<number, WeightedGapIndex>;
}>;

type ExplanationSearchState = {
	representativeByKey: Map<string, V3DirectSubitemAtom>;
};

export function buildV3DirectSubitemCandidates(params: {
	snapshotText: string;
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	candidateRecall: V3CandidateDocRecall;
	residentBase: ResidentBase;
	candidateRangeMode?: "resident_locality" | "whole_document";
}): V3DirectSubitemCandidate[] {
	if (params.snapshotText.trim().length === 0) {
		return [];
	}
	const preparedText = prepareV3DirectSubitemSnapshotText(params.snapshotText);
	const rawBlocks = splitRawBodyBlocks(
		preparedText,
		params.candidate,
		params.candidateRecall,
		params.residentBase,
	);
	if (rawBlocks.length === 0) {
		return [];
	}
	const scopes = buildLocalScopes(rawBlocks, params.candidate);
	if (scopes.length === 0) {
		return [];
	}
	const unitByIndex = new Map<number, V3QueryUnit>(
		params.queryAnalysis.primaryUnits.map((unit) => [unit.index, unit]),
	);
	const surfaceGroupByIndex = new Map<number, V3QuerySurfaceGroup>(
		params.queryAnalysis.surfaceGroups.map((group) => [group.index, group]),
	);
	const resolvedHanSurfaceGroupByIndex = new Map<number, V3ResolvedHanSurfaceGroup>(
		resolveCandidateHanSurfaceGroups(
			params.queryAnalysis,
			params.candidate.realizedFamilies,
		).map((group) => [group.surfaceGroupIndex, group]),
	);
	const providedAssessments = params.candidate.hanRescueAssessments;
	const fallbackOpaqueAssessments = providedAssessments.length > 0
		? []
		: params.candidate.realizedFamilies
				.filter(
					(family) =>
						family.matchKind === "opaque_exact" &&
						family.querySurfaceGroupIndex != null,
				)
				.map<HanRescueAssessment>((family) => ({
					surfaceGroupIndex: family.querySurfaceGroupIndex ?? -1,
					context: family.inBestBodyWindow || family.inBodyResidue ? "body" : "metadata",
					rescueMode:
						resolvedHanSurfaceGroupByIndex.get(family.querySurfaceGroupIndex ?? -1)
							?.rescueMode === "residual_only"
							? "residual_only"
							: "whole_group_when_real_miss",
					strength: "strong",
					matchedBigramCount: 1,
					matchedRealAnchorCount: 0,
					coversStartAnchor: false,
					coversEndAnchor: false,
					coversEndpoints: false,
					preservesSurfaceOrder: true,
					rankingScore: 1,
					approxMaxAdjacentGap: null,
					approxHeadTailSpan: null,
					blockIds: [],
					witnessKind: family.inBestBodyWindow || family.inBodyResidue ? "body" : null,
				}));
	const hanRescueAssessmentByGroupIndex = new Map<number, HanRescueAssessment>(
		[...providedAssessments, ...fallbackOpaqueAssessments].map((assessment) => [
			assessment.surfaceGroupIndex,
			assessment,
		]),
	);
	const singletonHanTargets = deriveSingletonHanTargetsFromCandidate(
		params.queryAnalysis,
		params.candidate,
	);
	const snapshotGapIndex = buildWeightedGapIndex(preparedText.text);
	const candidates = scopes.flatMap((scope) => {
		const blockById = new Map<number, RawBlock>(
			scope.blocks.map((block) => [block.blockId, block]),
		);
		const blockGapIndexById = new Map<number, WeightedGapIndex>(
			scope.blocks.map((block) => [block.blockId, buildWeightedGapIndex(block.text)]),
		);
		return buildCandidatesForScope({
			snapshotText: preparedText.text,
			snapshotGapIndex,
			queryAnalysis: params.queryAnalysis,
			candidate: params.candidate,
			candidateRecall: params.candidateRecall,
			scope,
			unitByIndex,
			surfaceGroupByIndex,
			resolvedHanSurfaceGroupByIndex,
			hanRescueAssessmentByGroupIndex,
			singletonHanTargets,
			blockById,
			blockGapIndexById,
		});
	});
	return candidates.sort(compareV3DirectSubitemCandidates);
}

function buildCandidatesForScope(
	context: BuildScopeContext,
): V3DirectSubitemCandidate[] {
	const baseOccurrences = collectBaseOccurrencesForScope(context);
	if (baseOccurrences.length === 0) {
		return buildSingletonOnlyCandidates(context);
	}
	const candidatesByKey = new Map<string, V3DirectSubitemCandidate>();
	for (let startIndex = 0; startIndex < baseOccurrences.length; startIndex += 1) {
		const state: ExplanationSearchState = {
			representativeByKey: new Map<string, V3DirectSubitemAtom>(),
		};
		for (let endIndex = startIndex; endIndex < baseOccurrences.length; endIndex += 1) {
			const occurrence = baseOccurrences[endIndex];
			if (!applyOccurrenceToState(state, occurrence)) {
				continue;
			}
			const candidate = buildCandidateFromState(context, state);
			if (candidate == null) {
				continue;
			}
			const key = buildCanonicalSnapshotKey(candidate, context.scope.blocks);
			const existing = candidatesByKey.get(key);
			if (
				existing == null ||
				compareV3DirectSubitemCandidates(candidate, existing) < 0
			) {
				candidatesByKey.set(key, candidate);
			}
		}
	}
	const candidates = filterDominatedCandidates(
		[...candidatesByKey.values()].sort(compareV3DirectSubitemCandidates),
	);
	if (
		candidates.length === 0 &&
		context.candidate.strongestContainer?.tier === "bodyWindow"
	) {
		const fallbackCandidate = buildCandidateFromState(
			context,
			{
				representativeByKey: new Map(
					baseOccurrences.map((occurrence) => [buildOccurrenceKey(occurrence), occurrence]),
				),
			},
		);
		if (fallbackCandidate != null) {
			candidates.push(fallbackCandidate);
		}
	}
	return candidates.sort(compareV3DirectSubitemCandidates);
}

function collectBaseOccurrencesForScope(
	context: BuildScopeContext,
): V3DirectSubitemAtom[] {
	const realOccurrences = collectRealizedFamilyOccurrencesInText({
		text: context.snapshotText.slice(context.scope.scopeStart, context.scope.scopeEnd),
		queryAnalysis: context.queryAnalysis,
		realizedFamilies: context.candidate.realizedFamilies.filter(
			(family) =>
				family.inBestBodyWindow ||
				family.inBodyResidue ||
				context.candidate.strongestContainer?.tier === "bodyWindow",
		),
	}).flatMap((occurrence) => {
		const start = context.scope.scopeStart + occurrence.start;
		const end = context.scope.scopeStart + occurrence.end;
		const block = findBlockForRange(context.scope.blocks, start, end);
		if (block == null) {
			return [];
		}
		const highlightTier: V3DirectSubitemHighlightTier =
			occurrence.matchKind === "fuzzy" ? "weak" : "strong";
		return [
			{
				kind: "realized_family_atom",
				evidenceKind:
					occurrence.matchKind === "fuzzy" ? "fuzzy" : "real_exact",
				queryUnitIndex: occurrence.queryUnitIndex,
				surfaceGroupIndex: occurrence.surfaceGroupIndex,
				blockId: block.blockId,
				start,
				end,
				matchedText: occurrence.matchedText,
				anchorTier: "real_lexical",
				highlightTier,
				bigramText: null,
			} satisfies V3DirectSubitemAtom,
		];
	});

	const scopeBlockIds = new Set(context.scope.blocks.map((block) => block.blockId));
	const opaqueOccurrences = context.candidateRecall.hanSurfaceGroupRecalls.flatMap(
		(groupRecall) => {
			const surfaceGroup = context.surfaceGroupByIndex.get(groupRecall.surfaceGroupIndex);
			const resolvedHanSurfaceGroup = context.resolvedHanSurfaceGroupByIndex.get(
				groupRecall.surfaceGroupIndex,
			);
			const assessment =
				context.hanRescueAssessmentByGroupIndex.get(groupRecall.surfaceGroupIndex) ??
				(resolvedHanSurfaceGroup == null
					? null
					: ({
							surfaceGroupIndex: groupRecall.surfaceGroupIndex,
							context: "body",
							rescueMode:
								resolvedHanSurfaceGroup.rescueMode === "residual_only"
									? "residual_only"
									: "whole_group_when_real_miss",
							strength: "strong",
							matchedBigramCount: resolvedHanSurfaceGroup.rescueBigrams.length,
							matchedRealAnchorCount: 0,
							coversStartAnchor: false,
							coversEndAnchor: false,
							coversEndpoints: false,
							preservesSurfaceOrder: true,
							rankingScore: 1,
							approxMaxAdjacentGap: null,
							approxHeadTailSpan: null,
							blockIds: [],
							witnessKind: "body",
						} satisfies HanRescueAssessment));
			if (
				surfaceGroup == null ||
				resolvedHanSurfaceGroup == null ||
				resolvedHanSurfaceGroup.rescueBigrams.length === 0 ||
				assessment == null ||
				assessment.strength === "none"
			) {
				return [];
			}
			const allowedBlockIds = new Set<number>();
			for (const seedBlockId of groupRecall.bodySeedBlockIds) {
				for (const blockId of collectSameDocSeedNeighborhoodBlockIds(
					seedBlockId,
					context.scope.blocks,
				)) {
					if (scopeBlockIds.has(blockId)) {
						allowedBlockIds.add(blockId);
					}
				}
			}
			if (allowedBlockIds.size === 0) {
				return [];
			}
			return context.scope.blocks.flatMap((block) => {
				if (!allowedBlockIds.has(block.blockId)) {
					return [];
				}
				return collectOpaqueBigramOccurrencesInText({
					text: block.text,
					surfaceGroupIndex: surfaceGroup.index,
					rescueBigrams: resolvedHanSurfaceGroup.rescueBigrams,
				}).map<V3DirectSubitemAtom>((occurrence) => ({
					kind: "opaque_bigram_atom",
					evidenceKind: "opaque_bigram",
					queryUnitIndex: null,
					surfaceGroupIndex: occurrence.surfaceGroupIndex,
					blockId: block.blockId,
					start: block.start + occurrence.start,
					end: block.start + occurrence.end,
					matchedText: occurrence.matchedText,
					anchorTier:
						assessment.strength === "strong"
							? "opaque_bigram"
							: "weak_opaque_bigram",
					// Keep weak rescue weaker for anchor/ranking semantics, but render the
					// actual matched bigram with the same visual emphasis as strong bigram rescue.
					highlightTier: "strong",
					bigramText: occurrence.bigramText,
				}));
			});
		},
	);
	const matchedBigramOccurrences = collectMatchedBigramOccurrencesForScope(context);
	return dedupeAtoms([
		...realOccurrences,
		...opaqueOccurrences,
		...matchedBigramOccurrences,
	]).sort(compareAtoms);
}

function deriveSingletonHanTargetsFromCandidate(
	queryAnalysis: V3QueryAnalysis,
	candidate: EvidencePackingProfile,
): readonly SingletonHanTarget[] {
	const singletonHanCompletion = candidate.singletonHanCompletion;
	if (
		singletonHanCompletion != null &&
		singletonHanCompletion.matched &&
		singletonHanCompletion.singletonHanChar != null
	) {
		return [
			{
				char: singletonHanCompletion.singletonHanChar,
				singletonHanCharIndex: singletonHanCompletion.singletonHanCharIndex,
				surfaceGroupIndex: singletonHanCompletion.singletonHanSurfaceGroupIndex,
				kind:
					singletonHanCompletion.singletonHanCharIndex == null
						? "query_singleton"
						: "residual_singleton",
			},
		];
	}
	if (
		queryAnalysis.querySingletonHanRecallEligible &&
		queryAnalysis.querySingletonHanChar != null
	) {
		return [
			{
				char: queryAnalysis.querySingletonHanChar,
				singletonHanCharIndex: null,
				surfaceGroupIndex: null,
				kind: "query_singleton",
			},
		];
	}
	return [];
}

function collectMatchedBigramOccurrencesForScope(
	context: BuildScopeContext,
): V3DirectSubitemAtom[] {
	if (
		!context.candidate.singletonHanCompletion.matched ||
		context.candidate.singletonHanCompletion.bestAnchorKind !== "bigram" ||
		context.singletonHanTargets.length === 0
	) {
		return [];
	}
	const hanSurfaceGroups = context.queryAnalysis.surfaceGroups.filter(
		(group) => group.kind === "han" && group.hanBigramTexts.length > 0,
	);
	if (hanSurfaceGroups.length === 0) {
		return [];
	}
	const singletonChars = context.singletonHanTargets.map((target) => target.char);
	return context.scope.blocks.flatMap((block) => {
		const hasNearbySingleton = singletonChars.some((char) => {
			if (collectTextOffsets(block.text, char).length > 0) {
				return true;
			}
			return context.scope.blocks.some(
				(candidateBlock) =>
					Math.abs(candidateBlock.ordinal - block.ordinal) === 1 &&
					collectTextOffsets(candidateBlock.text, char).length > 0,
			);
		});
		if (!hasNearbySingleton) {
			return [];
		}
		const out: V3DirectSubitemAtom[] = [];
		for (const surfaceGroup of hanSurfaceGroups) {
			for (const occurrence of collectOpaqueBigramOccurrencesInText({
				text: block.text,
				surfaceGroupIndex: surfaceGroup.index,
				rescueBigrams: surfaceGroup.hanBigramTexts,
			})) {
				out.push({
					kind: "matched_bigram_atom",
					evidenceKind: "matched_bigram",
					queryUnitIndex: null,
					surfaceGroupIndex: occurrence.surfaceGroupIndex,
					blockId: block.blockId,
					start: block.start + occurrence.start,
					end: block.start + occurrence.end,
					matchedText: occurrence.matchedText,
					anchorTier: "matched_bigram",
					highlightTier: "strong",
					bigramText: occurrence.bigramText,
				});
			}
		}
		return out;
	});
}

function applyOccurrenceToState(
	state: ExplanationSearchState,
	occurrence: V3DirectSubitemAtom,
): boolean {
	const key = buildOccurrenceKey(occurrence);
	if (state.representativeByKey.has(key)) {
		return false;
	}
	state.representativeByKey.set(key, occurrence);
	return true;
}

function buildOccurrenceKey(
	occurrence: V3DirectSubitemAtom,
): string {
	if (occurrence.kind === "realized_family_atom") {
		return `real:${occurrence.queryUnitIndex ?? -1}`;
	}
	if (occurrence.kind === "singleton_han_atom") {
		return `singleton:${occurrence.surfaceGroupIndex ?? -1}:${occurrence.blockId}:${occurrence.matchedText}`;
	}
	if (occurrence.kind === "matched_bigram_atom") {
		return `matched:${occurrence.surfaceGroupIndex ?? -1}:${occurrence.bigramText ?? occurrence.matchedText}:${occurrence.blockId}`;
	}
	if (occurrence.kind === "opaque_bigram_atom") {
		return `opaque:${occurrence.surfaceGroupIndex ?? -1}:${occurrence.bigramText ?? occurrence.matchedText}`;
	}
	return `surface:${occurrence.surfaceGroupIndex ?? -1}`;
}

function buildCandidateFromState(
	context: BuildScopeContext,
	state: ExplanationSearchState,
): V3DirectSubitemCandidate | null {
	const baseAtoms = [...state.representativeByKey.values()].sort(compareAtoms);
	if (baseAtoms.length === 0) {
		return null;
	}
	let totalGap = 0;
	let maxAdjacentGap = 0;
	for (let index = 1; index < baseAtoms.length; index += 1) {
		const gap = computeWeightedGap(
			context.snapshotGapIndex,
			baseAtoms[index - 1].end,
			baseAtoms[index].start,
		);
		totalGap += gap;
		maxAdjacentGap = Math.max(maxAdjacentGap, gap);
	}
	if (maxAdjacentGap > BODY_LOCALITY_MAX_ADJACENT_GAP) {
		return null;
	}
	const confirmedSurfaceAtoms = buildConfirmedSurfaceAtoms(
		context.snapshotText,
		context.scope,
		baseAtoms,
		context.surfaceGroupByIndex,
	);
	const singletonHanAtoms = collectSingletonHanAtomsForScope(context, baseAtoms);
	const atoms = dedupeAtoms([
		...baseAtoms,
		...confirmedSurfaceAtoms,
		...singletonHanAtoms,
	]).sort(compareAtoms);
	if (atoms.length === 0) {
		return null;
	}
	const displayAtoms = resolveDisplayAtoms(atoms);
	const realAtoms = baseAtoms.filter((atom) => atom.kind === "realized_family_atom");
	const confirmedSurfaceGroupIndices = uniqueSortedNumbers(
		atoms
			.filter((atom) => atom.kind === "confirmed_surface_atom")
			.map((atom) => atom.surfaceGroupIndex)
			.filter((value): value is number => value != null),
	);
	const opaqueBigramKeys = [
		...new Set(
			baseAtoms
				.filter(
					(atom) =>
						atom.kind === "opaque_bigram_atom" || atom.kind === "matched_bigram_atom",
				)
				.map((atom) => `${atom.surfaceGroupIndex ?? -1}:${atom.bigramText ?? atom.matchedText}`),
		),
	];
	const touchedOpaqueSurfaceGroupIndices = uniqueSortedNumbers(
		baseAtoms
			.filter(
				(atom) =>
					atom.kind === "opaque_bigram_atom" || atom.kind === "matched_bigram_atom",
			)
			.map((atom) => atom.surfaceGroupIndex)
			.filter((value): value is number => value != null),
	);
	const totalOpaqueBigramCount = touchedOpaqueSurfaceGroupIndices.reduce(
		(total, groupIndex) =>
			total +
			(context.resolvedHanSurfaceGroupByIndex.get(groupIndex)?.rescueBigrams.length ?? 0),
		0,
	);
	return {
		start: atoms[0].start,
		end: atoms[atoms.length - 1].end,
		anchorOffset: resolveCandidateAnchorOffset(atoms),
		component: {
			scopeStart: context.scope.scopeStart,
			scopeEnd: context.scope.scopeEnd,
			scopeTier: context.scope.scopeTier,
			blockIds: context.scope.blocks.map((block) => block.blockId),
			atoms,
		},
		atoms,
		displayAtoms,
		hasAnchor: true,
		anchorTier: resolveCandidateAnchorTier(atoms),
		coveredRealPrimaryCount: uniqueSortedNumbers(
			realAtoms
				.map((atom) => atom.queryUnitIndex)
				.filter((value): value is number => value != null),
		).length,
		confirmedSurfaceGroupCount: confirmedSurfaceGroupIndices.length,
		singletonHanCompletionTier: resolveSingletonHanCompletionTierForScope(
			context,
			baseAtoms,
			singletonHanAtoms,
		),
		matchedOpaqueBigramCount: opaqueBigramKeys.length,
		opaqueCoverageRatio:
			totalOpaqueBigramCount > 0
				? opaqueBigramKeys.length / totalOpaqueBigramCount
				: 0,
		preservesQueryOrder: preservesQueryOrder(realAtoms),
		windowWidth: Math.max(1, atoms[atoms.length - 1].end - atoms[0].start),
		maxAdjacentGap,
		totalGap,
	};
}

function buildConfirmedSurfaceAtoms(
	snapshotText: string,
	scope: LocalScope,
	baseAtoms: readonly V3DirectSubitemAtom[],
	surfaceGroupByIndex: ReadonlyMap<number, V3QuerySurfaceGroup>,
): V3DirectSubitemAtom[] {
	const touchedSurfaceGroupIndices = uniqueSortedNumbers(
		baseAtoms
				.filter(
					(atom) =>
						(atom.kind === "realized_family_atom" ||
							atom.kind === "opaque_bigram_atom" ||
							atom.kind === "matched_bigram_atom") &&
						atom.surfaceGroupIndex != null,
				)
				.map((atom) => atom.surfaceGroupIndex)
			.filter((value): value is number => value != null),
	);
	if (touchedSurfaceGroupIndices.length === 0) {
		return [];
	}
	const scopeText = snapshotText.slice(scope.scopeStart, scope.scopeEnd);
	const confirmedAtoms: V3DirectSubitemAtom[] = [];
	for (const surfaceGroupIndex of touchedSurfaceGroupIndices) {
		const surfaceGroup = surfaceGroupByIndex.get(surfaceGroupIndex);
		if (surfaceGroup == null) {
			continue;
		}
		const supportingRanges: PrimitiveTextOccurrence[] = baseAtoms
			.filter((atom) => atom.surfaceGroupIndex === surfaceGroupIndex)
			.map((atom) => ({
				start: atom.start - scope.scopeStart,
				end: atom.end - scope.scopeStart,
				matchedText: atom.matchedText,
			}));
		const confirmedSpan = resolveConfirmedSurfaceSpans({
			text: scopeText,
			surfaceGroup,
			supportingRanges,
		})[0];
		if (confirmedSpan == null) {
			continue;
		}
		const start = scope.scopeStart + confirmedSpan.start;
		const end = scope.scopeStart + confirmedSpan.end;
		const block = findBlockForRange(scope.blocks, start, end);
		if (block == null) {
			continue;
		}
		confirmedAtoms.push({
			kind: "confirmed_surface_atom",
			evidenceKind: "confirmed_surface",
			queryUnitIndex: null,
			surfaceGroupIndex,
			blockId: block.blockId,
			start,
			end,
			matchedText: confirmedSpan.surfaceText,
			anchorTier: "confirmed_surface",
			highlightTier: "strong",
			bigramText: null,
		});
	}
	return confirmedAtoms;
}

function buildSingletonOnlyCandidates(
	context: BuildScopeContext,
): V3DirectSubitemCandidate[] {
	const singletonHanAtoms = collectSingletonHanAtomsForScope(context, []);
	if (singletonHanAtoms.length === 0) {
		return [];
	}
	const candidates: V3DirectSubitemCandidate[] = [];
	for (const block of context.scope.blocks) {
		const blockAtoms = singletonHanAtoms.filter((atom) => atom.blockId === block.blockId);
		if (blockAtoms.length === 0) {
			continue;
		}
		const atoms = dedupeAtoms(blockAtoms).sort(compareAtoms);
		const start = atoms[0]?.start ?? block.start;
		const end = atoms[atoms.length - 1]?.end ?? block.end;
		candidates.push({
			start,
			end,
			anchorOffset: start,
			component: {
				scopeStart: block.start,
				scopeEnd: block.end,
				scopeTier: context.scope.scopeTier,
				blockIds: [block.blockId],
				atoms,
			},
			atoms,
			displayAtoms: atoms,
			hasAnchor: true,
			anchorTier: resolveCandidateAnchorTier(atoms),
			coveredRealPrimaryCount: 0,
			confirmedSurfaceGroupCount: 0,
			singletonHanCompletionTier: resolveSingletonHanCompletionTierForScope(
				context,
				[],
				atoms,
			),
			matchedOpaqueBigramCount: 0,
			opaqueCoverageRatio: 0,
			preservesQueryOrder: true,
			windowWidth: Math.max(1, end - start),
			maxAdjacentGap: 0,
			totalGap: 0,
		});
	}
	return candidates.sort(compareV3DirectSubitemCandidates);
}

function collectSingletonHanAtomsForScope(
	context: BuildScopeContext,
	baseAtoms: readonly V3DirectSubitemAtom[],
): V3DirectSubitemAtom[] {
	if (context.singletonHanTargets.length === 0) {
		return [];
	}
	const shortlistedBodyBlockIds = new Set(context.candidateRecall.shortlistedBodyBlockIds);
	const atoms: V3DirectSubitemAtom[] = [];
	for (const target of context.singletonHanTargets) {
		for (const block of context.scope.blocks) {
			const charOffsets = collectTextOffsets(block.text, target.char);
			if (charOffsets.length === 0) {
				continue;
			}
			if (baseAtoms.length === 0) {
				if (target.kind !== "query_singleton") {
					continue;
				}
				if (!shortlistedBodyBlockIds.has(block.blockId)) {
					continue;
				}
				const earliestOffset = charOffsets[0];
				if (earliestOffset == null) {
					continue;
				}
				atoms.push({
					kind: "singleton_han_atom",
					evidenceKind: "singleton_han",
					queryUnitIndex: null,
					surfaceGroupIndex: target.surfaceGroupIndex,
					blockId: block.blockId,
					start: block.start + earliestOffset,
					end: block.start + earliestOffset + target.char.length,
					matchedText: target.char,
					anchorTier: "singleton_han",
					highlightTier: "strong",
					bigramText: null,
				});
				continue;
			}
			let bestOffset: number | null = null;
			let bestGap = Number.POSITIVE_INFINITY;
			for (const charOffset of charOffsets) {
				const start = block.start + charOffset;
				const end = start + target.char.length;
				if (
					baseAtoms.some(
						(anchor) =>
							anchor.blockId === block.blockId &&
							Math.min(anchor.end, end) > Math.max(anchor.start, start),
					)
				) {
					continue;
				}
				for (const anchor of baseAtoms) {
					const gap = computeScopeAtomBoundaryGap(
						context,
						{ blockId: block.blockId, start, end },
						anchor,
					);
					if (gap == null) {
						continue;
					}
					if (gap < bestGap || (gap === bestGap && (bestOffset == null || charOffset < bestOffset))) {
						bestGap = gap;
						bestOffset = charOffset;
					}
				}
			}
			if (
				bestOffset == null ||
				bestGap > BODY_LOCALITY_MAX_ADJACENT_GAP
			) {
				continue;
			}
			atoms.push({
				kind: "singleton_han_atom",
				evidenceKind: "singleton_han",
				queryUnitIndex: null,
				surfaceGroupIndex: target.surfaceGroupIndex,
				blockId: block.blockId,
				start: block.start + bestOffset,
				end: block.start + bestOffset + target.char.length,
				matchedText: target.char,
				anchorTier: "singleton_han",
				highlightTier: "strong",
				bigramText: null,
			});
		}
	}
	return dedupeAtoms(atoms).sort(compareAtoms);
}

function resolveSingletonHanCompletionTierForScope(
	context: BuildScopeContext,
	baseAtoms: readonly V3DirectSubitemAtom[],
	singletonHanAtoms: readonly V3DirectSubitemAtom[],
): "none" | "tight" {
	if (singletonHanAtoms.length === 0) {
		return "none";
	}
	if (baseAtoms.length === 0) {
		return "tight";
	}
	let bestGap = Number.POSITIVE_INFINITY;
	for (const singletonAtom of singletonHanAtoms) {
		for (const anchor of baseAtoms) {
			const gap = computeScopeAtomBoundaryGap(context, singletonAtom, anchor);
			if (gap == null) {
				continue;
			}
			bestGap = Math.min(bestGap, gap);
		}
	}
	if (!Number.isFinite(bestGap)) {
		return "none";
	}
	return bestGap <= BODY_LOCALITY_MAX_ADJACENT_GAP ? "tight" : "none";
}

function computeScopeAtomBoundaryGap(
	context: BuildScopeContext,
	left: Pick<V3DirectSubitemAtom, "blockId" | "start" | "end">,
	right: Pick<V3DirectSubitemAtom, "blockId" | "start" | "end">,
): number | null {
	const leftBlock = context.blockById.get(left.blockId);
	const rightBlock = context.blockById.get(right.blockId);
	const leftGapIndex = context.blockGapIndexById.get(left.blockId);
	const rightGapIndex = context.blockGapIndexById.get(right.blockId);
	if (
		leftBlock == null ||
		rightBlock == null ||
		leftGapIndex == null ||
		rightGapIndex == null
	) {
		return null;
	}
	const leftStart = left.start - leftBlock.start;
	const leftEnd = left.end - leftBlock.start;
	const rightStart = right.start - rightBlock.start;
	const rightEnd = right.end - rightBlock.start;
	if (left.blockId === right.blockId) {
		return computeWeightedBoundaryGap(
			leftGapIndex,
			leftStart,
			leftEnd,
			rightStart,
			rightEnd,
		);
	}
	if (Math.abs(leftBlock.ordinal - rightBlock.ordinal) !== 1) {
		return null;
	}
	if (leftBlock.ordinal < rightBlock.ordinal) {
		return computeWeightedAdjacentBoundaryGap(
			leftGapIndex,
			leftStart,
			leftEnd,
			rightGapIndex,
			rightStart,
			rightEnd,
		);
	}
	return computeWeightedAdjacentBoundaryGap(
		rightGapIndex,
		rightStart,
		rightEnd,
		leftGapIndex,
		leftStart,
		leftEnd,
	);
}

function buildCanonicalSnapshotKey(
	candidate: V3DirectSubitemCandidate,
	scopeBlocks: readonly RawBlock[],
): string {
	const realUnitIndices = uniqueSortedNumbers(
		candidate.atoms
			.filter((atom) => atom.kind === "realized_family_atom")
			.map((atom) => atom.queryUnitIndex)
			.filter((value): value is number => value != null),
	).join(",");
	const opaqueBigramKeys = [
		...new Set(
			candidate.atoms
				.filter(
					(atom) =>
						atom.kind === "opaque_bigram_atom" || atom.kind === "matched_bigram_atom",
				)
				.map((atom) => `${atom.surfaceGroupIndex ?? -1}:${atom.bigramText ?? atom.matchedText}`),
		),
	]
		.sort()
		.join(",");
	const confirmedSurfaceGroups = uniqueSortedNumbers(
		candidate.atoms
			.filter((atom) => atom.kind === "confirmed_surface_atom")
			.map((atom) => atom.surfaceGroupIndex)
			.filter((value): value is number => value != null),
	).join(",");
	return [
		realUnitIndices,
		opaqueBigramKeys,
		confirmedSurfaceGroups,
		candidate.anchorTier,
		candidate.preservesQueryOrder ? "ordered" : "unordered",
		scopeBlocks.map((block) => block.blockId).join(","),
	].join("|");
}

function filterDominatedCandidates(
	candidates: readonly V3DirectSubitemCandidate[],
): V3DirectSubitemCandidate[] {
	return candidates.filter(
		(candidate, candidateIndex) =>
			!candidates.some(
				(contender, contenderIndex) =>
					candidateIndex !== contenderIndex &&
					isDominatedCandidate(candidate, contender),
			),
	);
}

function isDominatedCandidate(
	candidate: V3DirectSubitemCandidate,
	contender: V3DirectSubitemCandidate,
): boolean {
	if (
		candidate.component.scopeStart !== contender.component.scopeStart ||
		candidate.component.scopeEnd !== contender.component.scopeEnd
	) {
		return false;
	}
	if (compareV3DirectSubitemCandidates(contender, candidate) >= 0) {
		return false;
	}
	const contenderAtomKeys = new Set(
		contender.atoms.map((atom) =>
			[
				atom.kind,
				atom.queryUnitIndex ?? -1,
				atom.surfaceGroupIndex ?? -1,
				atom.bigramText ?? atom.matchedText,
			].join(":"),
		),
	);
	return candidate.atoms.every((atom) =>
		contenderAtomKeys.has(
			[
				atom.kind,
				atom.queryUnitIndex ?? -1,
				atom.surfaceGroupIndex ?? -1,
				atom.bigramText ?? atom.matchedText,
			].join(":"),
		),
	);
}

function resolveDisplayAtoms(
	atoms: readonly V3DirectSubitemAtom[],
): V3DirectSubitemAtom[] {
	const confirmedSurfaceGroups = new Set<number>(
		atoms
			.filter((atom) => atom.kind === "confirmed_surface_atom")
			.map((atom) => atom.surfaceGroupIndex)
			.filter((value): value is number => value != null),
	);
	return atoms.filter((atom) => {
		if (atom.kind !== "realized_family_atom" || atom.surfaceGroupIndex == null) {
			return true;
		}
		return !confirmedSurfaceGroups.has(atom.surfaceGroupIndex);
	});
}

function buildLocalScopes(
	rawBlocks: readonly RawBlock[],
	candidate: EvidencePackingProfile,
): LocalScope[] {
	if (rawBlocks.length === 0) {
		return [];
	}
	const bestBodyWindowBlockIds = new Set(candidate.bodyWindowContainer?.blockIds ?? []);
	const scopes: LocalScope[] = [];
	let scopeStartIndex = 0;
	for (let index = 1; index < rawBlocks.length; index += 1) {
		if (rawBlocks[index].ordinal === rawBlocks[index - 1].ordinal + 1) {
			continue;
		}
		scopes.push(
			createScope(rawBlocks.slice(scopeStartIndex, index), bestBodyWindowBlockIds),
		);
		scopeStartIndex = index;
	}
	scopes.push(createScope(rawBlocks.slice(scopeStartIndex), bestBodyWindowBlockIds));
	return scopes;
}

function createScope(
	blocks: readonly RawBlock[],
	bestBodyWindowBlockIds: ReadonlySet<number>,
): LocalScope {
	return {
		scopeStart: blocks[0].start,
		scopeEnd: blocks[blocks.length - 1].end,
		scopeTier: blocks.every((block) => bestBodyWindowBlockIds.has(block.blockId))
			? "body_window"
			: "body_residue",
		blocks,
	};
}

function splitRawBodyBlocks(
	preparedText: V3DirectSubitemPreparedText,
	candidate: EvidencePackingProfile,
	candidateRecall: V3CandidateDocRecall,
	residentBase: ResidentBase,
): RawBlock[] {
	const localBlockIds = collectLocalBlockIds(candidate, candidateRecall, residentBase);
	if (localBlockIds.size === 0) {
		return [];
	}
	const blockIdByOrdinal = new Map<number, number>();
	for (const blockId of localBlockIds) {
		const ordinal = residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId;
		if (!blockIdByOrdinal.has(ordinal)) {
			blockIdByOrdinal.set(ordinal, blockId);
		}
	}
	const blocks: RawBlock[] = [];
	for (const [ordinal, blockId] of [...blockIdByOrdinal.entries()].sort(
		(left, right) => left[0] - right[0],
	)) {
		const range = preparedText.rawBlocks.find((block) => block.ordinal === ordinal);
		if (range == null) {
			continue;
		}
		pushBlock(preparedText.text, range.start, range.end, ordinal, blockId, blocks);
	}
	return blocks;
}

function collectLocalBlockIds(
	candidate: EvidencePackingProfile,
	candidateRecall: V3CandidateDocRecall,
	residentBase: ResidentBase,
): Set<number> {
	const blockIds = new Set<number>([
		...(candidate.bodyWindowContainer?.blockIds ?? []),
		...candidateRecall.shortlistedBodyBlockIds,
	]);
	for (const groupRecall of candidateRecall.hanSurfaceGroupRecalls) {
		for (const seedBlockId of groupRecall.bodySeedBlockIds) {
			blockIds.add(seedBlockId);
			for (const blockId of collectSameDocSeedNeighborhoodBlockIds(
				seedBlockId,
				getBodyBlocksForLiveDocSlot(candidateRecall.liveDocSlot, residentBase),
			)) {
				blockIds.add(blockId);
			}
		}
	}
	return blockIds;
}

function getBodyBlocksForLiveDocSlot(
	liveDocSlot: number,
	residentBase: ResidentBase,
): RawBlock[] {
	return getLiveDocBodyBlockIds(residentBase, liveDocSlot).map((blockId) => ({
		blockId,
		ordinal: residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId,
		start: 0,
		end: 0,
		text: "",
	}));
}

function collectSameDocSeedNeighborhoodBlockIds(
	seedBlockId: number,
	availableBlocks: readonly Pick<RawBlock, "blockId">[],
): number[] {
	const seedIndex = availableBlocks.findIndex((block) => block.blockId === seedBlockId);
	if (seedIndex < 0) {
		return [];
	}
	const out: number[] = [];
	for (const candidateIndex of [seedIndex - 1, seedIndex, seedIndex + 1]) {
		const candidateBlock = availableBlocks[candidateIndex];
		if (candidateBlock == null) {
			continue;
		}
		out.push(candidateBlock.blockId);
	}
	return out;
}

function pushBlock(
	snapshotText: string,
	rangeStart: number,
	rangeEnd: number,
	ordinal: number,
	blockId: number,
	blocks: RawBlock[],
): void {
	const rawText = snapshotText.slice(rangeStart, rangeEnd);
	const leadingTrim = rawText.search(/\S/u);
	if (leadingTrim < 0) {
		return;
	}
	const trailingTrim = rawText.length - rawText.trimEnd().length;
	const start = rangeStart + leadingTrim;
	const end = rangeEnd - trailingTrim;
	blocks.push({
		blockId,
		ordinal,
		start,
		end,
		text: snapshotText.slice(start, end),
	});
}

function findBlockForRange(
	blocks: readonly RawBlock[],
	start: number,
	end: number,
): RawBlock | null {
	return blocks.find((block) => start >= block.start && end <= block.end) ?? null;
}

function dedupeAtoms(
	atoms: readonly V3DirectSubitemAtom[],
): V3DirectSubitemAtom[] {
	const deduped = new Map<string, V3DirectSubitemAtom>();
	for (const atom of atoms) {
		const key = [
			atom.kind,
			atom.queryUnitIndex ?? -1,
			atom.surfaceGroupIndex ?? -1,
			atom.blockId,
			atom.start,
			atom.end,
			atom.matchedText,
		].join(":");
		const existing = deduped.get(key);
		if (
			existing == null ||
			getAnchorTierScore(atom.anchorTier) > getAnchorTierScore(existing.anchorTier)
		) {
			deduped.set(key, atom);
		}
	}
	return [...deduped.values()].sort(compareAtoms);
}

function compareAtoms(
	left: V3DirectSubitemAtom,
	right: V3DirectSubitemAtom,
): number {
	if (left.start !== right.start) {
		return left.start - right.start;
	}
	if (left.end !== right.end) {
		return left.end - right.end;
	}
	if (left.kind !== right.kind) {
		return left.kind.localeCompare(right.kind);
	}
	if ((left.queryUnitIndex ?? -1) !== (right.queryUnitIndex ?? -1)) {
		return (left.queryUnitIndex ?? -1) - (right.queryUnitIndex ?? -1);
	}
	if ((left.surfaceGroupIndex ?? -1) !== (right.surfaceGroupIndex ?? -1)) {
		return (left.surfaceGroupIndex ?? -1) - (right.surfaceGroupIndex ?? -1);
	}
	return left.matchedText.localeCompare(right.matchedText);
}

function resolveCandidateAnchorOffset(
	atoms: readonly V3DirectSubitemAtom[],
): number {
	return [...atoms].sort(
		(left, right) =>
			getAnchorTierScore(right.anchorTier) - getAnchorTierScore(left.anchorTier) ||
			left.start - right.start ||
			left.end - right.end,
	)[0]?.start ?? atoms[0]?.start ?? 0;
}

function resolveCandidateAnchorTier(
	atoms: readonly V3DirectSubitemAtom[],
): V3DirectSubitemAnchorTier {
	let strongestTier: V3DirectSubitemAnchorTier = "none";
	for (const atom of atoms) {
		if (getAnchorTierScore(atom.anchorTier) > getAnchorTierScore(strongestTier)) {
			strongestTier = atom.anchorTier;
		}
	}
	return strongestTier;
}

function getAnchorTierScore(
	tier: V3DirectSubitemAnchorTier,
): number {
	switch (tier) {
		case "confirmed_surface":
			return 5;
		case "opaque_bigram":
			return 4;
		case "matched_bigram":
			return 3;
		case "weak_opaque_bigram":
			return 3;
		case "real_lexical":
			return 2;
		case "singleton_han":
			return 1;
		default:
			return 0;
	}
}

function preservesQueryOrder(
	atoms: readonly V3DirectSubitemAtom[],
): boolean {
	for (let index = 1; index < atoms.length; index += 1) {
		if ((atoms[index - 1].queryUnitIndex ?? -1) > (atoms[index].queryUnitIndex ?? -1)) {
			return false;
		}
	}
	return true;
}

function uniqueSortedNumbers(
	values: readonly number[],
): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function collectTextOffsets(text: string, target: string): number[] {
	const offsets: number[] = [];
	let searchStart = 0;
	while (searchStart <= text.length - target.length) {
		const matchIndex = text.indexOf(target, searchStart);
		if (matchIndex < 0) {
			break;
		}
		offsets.push(matchIndex);
		searchStart = matchIndex + 1;
	}
	return offsets;
}
