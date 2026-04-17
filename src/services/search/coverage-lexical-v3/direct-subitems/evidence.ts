import type { ResidentBase } from "../layout/types";
import {
	HAN_BODY_LOCALITY_MAX_ADJACENT_GAP,
	type HanRescueAssessment,
} from "../han-rescue";
import type { V3QueryAnalysis, V3QuerySurfaceGroup, V3QueryUnit } from "../query/analysis";
import {
	createV3BodyBlockChunkRanges,
	V3_BODY_BLOCK_MAX_TOKENS,
	V3_BODY_BLOCK_TARGET_TOKENS,
} from "../query/text";
import type { V3CandidateDocRecall, V3ResolvedHanSurfaceGroup } from "../recall";
import { resolveCandidateHanSurfaceGroups } from "../recall/han-surface-groups";
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

const DIRECT_SUBITEM_HAN_GAP_WEIGHT = 0.65;
const DIRECT_SUBITEM_OTHER_GAP_WEIGHT = 0.25;
const HAN_CHAR_PATTERN = /\p{Script=Han}/u;

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
	queryAnalysis: V3QueryAnalysis;
	candidate: EvidencePackingProfile;
	candidateRecall: V3CandidateDocRecall;
	scope: LocalScope;
	unitByIndex: ReadonlyMap<number, V3QueryUnit>;
	surfaceGroupByIndex: ReadonlyMap<number, V3QuerySurfaceGroup>;
	resolvedHanSurfaceGroupByIndex: ReadonlyMap<number, V3ResolvedHanSurfaceGroup>;
	hanRescueAssessmentByGroupIndex: ReadonlyMap<number, HanRescueAssessment>;
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
	const rawBlocks = splitRawBodyBlocks(
		params.snapshotText,
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
	const candidates = scopes.flatMap((scope) =>
		buildCandidatesForScope({
			snapshotText: params.snapshotText,
			queryAnalysis: params.queryAnalysis,
			candidate: params.candidate,
			candidateRecall: params.candidateRecall,
			scope,
			unitByIndex,
			surfaceGroupByIndex,
			resolvedHanSurfaceGroupByIndex,
			hanRescueAssessmentByGroupIndex,
		}),
	);
	return candidates.sort(compareV3DirectSubitemCandidates);
}

function buildCandidatesForScope(
	context: BuildScopeContext,
): V3DirectSubitemCandidate[] {
	const baseOccurrences = collectBaseOccurrencesForScope(context);
	if (baseOccurrences.length === 0) {
		return [];
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
					context.candidateRecall.docId,
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
	return dedupeAtoms([...realOccurrences, ...opaqueOccurrences]).sort(compareAtoms);
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
			context.snapshotText,
			baseAtoms[index - 1].end,
			baseAtoms[index].start,
		);
		totalGap += gap;
		maxAdjacentGap = Math.max(maxAdjacentGap, gap);
	}
	if (maxAdjacentGap > HAN_BODY_LOCALITY_MAX_ADJACENT_GAP) {
		return null;
	}
	const confirmedSurfaceAtoms = buildConfirmedSurfaceAtoms(
		context.snapshotText,
		context.scope,
		baseAtoms,
		context.surfaceGroupByIndex,
	);
	const atoms = dedupeAtoms([...baseAtoms, ...confirmedSurfaceAtoms]).sort(compareAtoms);
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
				.filter((atom) => atom.kind === "opaque_bigram_atom")
				.map((atom) => `${atom.surfaceGroupIndex ?? -1}:${atom.bigramText ?? atom.matchedText}`),
		),
	];
	const touchedOpaqueSurfaceGroupIndices = uniqueSortedNumbers(
		baseAtoms
			.filter((atom) => atom.kind === "opaque_bigram_atom")
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
						atom.kind === "opaque_bigram_atom") &&
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
				.filter((atom) => atom.kind === "opaque_bigram_atom")
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
	snapshotText: string,
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
	const ranges = createV3BodyBlockChunkRanges(
		snapshotText,
		V3_BODY_BLOCK_TARGET_TOKENS,
		V3_BODY_BLOCK_MAX_TOKENS,
	);
	const blocks: RawBlock[] = [];
	for (const [ordinal, blockId] of [...blockIdByOrdinal.entries()].sort(
		(left, right) => left[0] - right[0],
	)) {
		const range = ranges[ordinal];
		if (range == null) {
			continue;
		}
		pushBlock(snapshotText, range.startOffset, range.endOffset, ordinal, blockId, blocks);
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
				candidateRecall.docId,
				seedBlockId,
				getBodyBlocksForDoc(candidateRecall.docId, residentBase),
			)) {
				blockIds.add(blockId);
			}
		}
	}
	return blockIds;
}

function getBodyBlocksForDoc(
	docId: number,
	residentBase: ResidentBase,
): RawBlock[] {
	const start = residentBase.docTable.bodyBlockStartByDocId[docId] ?? 0;
	const count = residentBase.docTable.bodyBlockCountByDocId[docId] ?? 0;
	const blocks: RawBlock[] = [];
	for (let offset = 0; offset < count; offset += 1) {
		const blockId = start + offset;
		blocks.push({
			blockId,
			ordinal: residentBase.bodyBlocks.blockOrdinalByBlockId[blockId] ?? blockId,
			start: 0,
			end: 0,
			text: "",
		});
	}
	return blocks;
}

function collectSameDocSeedNeighborhoodBlockIds(
	_docId: number,
	seedBlockId: number,
	availableBlocks: readonly Pick<RawBlock, "blockId">[],
): number[] {
	const availableBlockIds = new Set(availableBlocks.map((block) => block.blockId));
	const out: number[] = [];
	for (const candidateBlockId of [seedBlockId - 1, seedBlockId, seedBlockId + 1]) {
		if (candidateBlockId < 0 || !availableBlockIds.has(candidateBlockId)) {
			continue;
		}
		out.push(candidateBlockId);
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
			return 4;
		case "opaque_bigram":
			return 3;
		case "weak_opaque_bigram":
			return 2;
		case "real_lexical":
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

function computeWeightedGap(
	snapshotText: string,
	start: number,
	end: number,
): number {
	if (end <= start) {
		return 0;
	}
	let total = 0;
	for (const char of snapshotText.slice(start, end)) {
		total += HAN_CHAR_PATTERN.test(char)
			? DIRECT_SUBITEM_HAN_GAP_WEIGHT
			: DIRECT_SUBITEM_OTHER_GAP_WEIGHT;
	}
	return total;
}

function uniqueSortedNumbers(
	values: readonly number[],
): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}
