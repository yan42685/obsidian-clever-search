import type { IndexedDocument } from "src/globals/search-types";
import {
	buildResidentBase,
	buildStableWitnessMatchKey,
	DEFAULT_RESIDENT_SHARD_GENERATION,
	DEFAULT_RESIDENT_SHARD_ID,
} from "src/services/search/coverage-lexical-v3/build";
import { analyzeQuery } from "src/services/search/coverage-lexical-v3/query";
import {
	getBodyBlockExactFamilyIds,
	getBodyBlockExactTokenPositions,
	getBodyBlockFamilySupportEntries,
	getBodyBlockHanWitnessOccurrences,
	getBodyBlockHanWitnessTexts,
	getLiveDocHeadingHanWitnessStringIds,
	getLiveDocHeadingHanWitnessTexts,
	getLiveDocIdentityHanWitnessSourceMasks,
	getLiveDocIdentityHanWitnessStringIds,
	getLiveDocIdentityHanWitnessTexts,
	getLiveDocRouteHanWitnessSourceMasks,
	getLiveDocRouteHanWitnessStringIds,
	getLiveDocRouteHanWitnessTexts,
	lookupQueryUnitFamilies,
	recallCandidateDocs,
} from "src/services/search/coverage-lexical-v3/recall";
import {
	buildPackingProfile,
	buildCandidateHydrationKey,
	hydrateCandidateEvidence,
} from "src/services/search/coverage-lexical-v3/ranking";

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
		generation: overrides.generation ?? 1,
	};
}

describe("coverage lexical v3 evidence hydration", () => {
	it("builds the same packing profile with prehydrated candidate evidence", () => {
		const document = createDocument({
			path: "notes/hydrated-evidence.md",
			basename: "hydrated evidence",
			folder: "notes",
			content: "alpha beta gamma\n\ngamma alpha beta witness",
		});
		const base = buildResidentBase([document]);
		const queryAnalysis = analyzeQuery("alpha beta gamma");
		const unitFamilyMatches = lookupQueryUnitFamilies(base, queryAnalysis);
		const candidateRecall = recallCandidateDocs(
			base,
			queryAnalysis,
			unitFamilyMatches,
		)[0];
		expect(candidateRecall).toBeDefined();

		const baselineProfile = buildPackingProfile(
			base,
			queryAnalysis,
			candidateRecall!,
			unitFamilyMatches,
		);
		const hydratedProfile = buildPackingProfile(
			base,
			queryAnalysis,
			candidateRecall!,
			unitFamilyMatches,
			{
				hydratedEvidence: hydrateCandidateEvidence(base, candidateRecall!),
			},
		);

		expect(hydratedProfile).toEqual(baselineProfile);
	});

	it("builds the same packing profile when hydrated from canonical cold evidence shapes", () => {
		const document = createDocument({
				path: "notes/han-cold-evidence.md",
				basename: "han cold evidence",
			folder: "notes",
			content: "缓存恢复步骤\n\n缓存恢复检查 alpha beta",
		});
		const base = buildResidentBase([document]);
		const queryAnalysis = analyzeQuery("缓存恢复");
		const unitFamilyMatches = lookupQueryUnitFamilies(base, queryAnalysis);
		const candidateRecall = recallCandidateDocs(
			base,
			queryAnalysis,
			unitFamilyMatches,
		)[0];
		expect(candidateRecall).toBeDefined();

		const baselineProfile = buildPackingProfile(
			base,
			queryAnalysis,
			candidateRecall!,
			unitFamilyMatches,
		);
		const blockId = candidateRecall!.shortlistedBodyBlockIds[0] ?? 0;
		const bodyEvidenceByBlockId = new Map([
			[
				blockId,
				{
					exactShardLocalFamilySlots: getBodyBlockExactFamilyIds(base, blockId),
					exactTokenPositions: getBodyBlockExactTokenPositions(base, blockId),
					supportEntriesByShardLocalFamilySlot: getBodyBlockFamilySupportEntries(
						base,
						blockId,
					).map((entry) => ({
						shardLocalFamilySlot: entry.familyId,
						supportMask: entry.supportMask,
					})),
				},
			] as const,
		]);
		const bodyHanEvidenceByBlockId = new Map([
			[
				blockId,
				{
					bodyWitnessMatchKeys: getBodyBlockHanWitnessOccurrences(base, blockId).map(
						(occurrence) => buildStableWitnessMatchKey(
							getBodyBlockHanWitnessTexts(base, blockId).find(
								(text, index) =>
									(getBodyBlockHanWitnessOccurrences(base, blockId)[index]?.stringId ??
										-1) === occurrence.stringId,
							) ?? "",
						),
					),
					bodyWitnessTexts: getBodyBlockHanWitnessTexts(base, blockId),
					bodyWitnessStartOffsets: getBodyBlockHanWitnessOccurrences(
						base,
						blockId,
					).map((occurrence) => occurrence.start),
				},
			] as const,
		]);
		const liveDocSlot = candidateRecall!.liveDocSlot;
		const docHanEvidenceByCandidateKey = new Map([
			[
				buildCandidateHydrationKey(candidateRecall!),
				{
					identityWitnessMatchKeys: getLiveDocIdentityHanWitnessTexts(
						base,
						liveDocSlot,
					).map(buildStableWitnessMatchKey),
					identityWitnessTexts: getLiveDocIdentityHanWitnessTexts(
						base,
						liveDocSlot,
					),
					identityWitnessSourceMasks: getLiveDocIdentityHanWitnessSourceMasks(
						base,
						liveDocSlot,
					),
					routeWitnessMatchKeys: getLiveDocRouteHanWitnessTexts(
						base,
						liveDocSlot,
					).map(buildStableWitnessMatchKey),
					routeWitnessTexts: getLiveDocRouteHanWitnessTexts(base, liveDocSlot),
					routeWitnessSourceMasks: getLiveDocRouteHanWitnessSourceMasks(
						base,
						liveDocSlot,
					),
					headingWitnessMatchKeys: getLiveDocHeadingHanWitnessTexts(
						base,
						liveDocSlot,
					).map(buildStableWitnessMatchKey),
					headingWitnessTexts: getLiveDocHeadingHanWitnessTexts(
						base,
						liveDocSlot,
					),
				},
			] as const,
		]);
		const hydratedProfile = buildPackingProfile(
			base,
			queryAnalysis,
			candidateRecall!,
			unitFamilyMatches,
			{
				hydratedEvidence: hydrateCandidateEvidence(base, candidateRecall!, {
					bodyEvidenceByBlockId,
					docHanEvidenceByCandidateKey,
					bodyHanEvidenceByBlockId,
				}),
			},
		);

		expect(hydratedProfile).toEqual(baselineProfile);
	});

	it("uses prehydrated doc Han evidence even when resident Han witnesses are cleared", () => {
		const document = createDocument({
			path: "notes/doc-han-evidence.md",
			basename: "doc han evidence",
			folder: "notes",
			content: "缂撳瓨鎭㈠姝ラ\n\nalpha beta",
		});
		const base = buildResidentBase([document]);
		const queryAnalysis = analyzeQuery("缂撳瓨鎭㈠");
		const unitFamilyMatches = lookupQueryUnitFamilies(base, queryAnalysis);
		const candidateRecall = recallCandidateDocs(
			base,
			queryAnalysis,
			unitFamilyMatches,
		)[0];
		expect(candidateRecall).toBeDefined();

		const baselineProfile = buildPackingProfile(
			base,
			queryAnalysis,
			candidateRecall!,
			unitFamilyMatches,
		);
		const liveDocSlot = candidateRecall!.liveDocSlot;
		const docHanEvidenceByCandidateKey = new Map([
			[
				buildCandidateHydrationKey({
					shardId: DEFAULT_RESIDENT_SHARD_ID,
					shardGeneration: DEFAULT_RESIDENT_SHARD_GENERATION,
					liveDocSlot,
				}),
				{
					identityWitnessMatchKeys: getLiveDocIdentityHanWitnessTexts(
						base,
						liveDocSlot,
					).map(buildStableWitnessMatchKey),
					identityWitnessTexts: getLiveDocIdentityHanWitnessTexts(base, liveDocSlot),
					identityWitnessSourceMasks: getLiveDocIdentityHanWitnessSourceMasks(
						base,
						liveDocSlot,
					),
					routeWitnessMatchKeys: getLiveDocRouteHanWitnessTexts(
						base,
						liveDocSlot,
					).map(buildStableWitnessMatchKey),
					routeWitnessTexts: getLiveDocRouteHanWitnessTexts(base, liveDocSlot),
					routeWitnessSourceMasks: getLiveDocRouteHanWitnessSourceMasks(
						base,
						liveDocSlot,
					),
					headingWitnessMatchKeys: getLiveDocHeadingHanWitnessTexts(
						base,
						liveDocSlot,
					).map(buildStableWitnessMatchKey),
					headingWitnessTexts: getLiveDocHeadingHanWitnessTexts(base, liveDocSlot),
				},
			] as const,
		]);

		const mutableHanRoute = base.hanRoute as {
			identityWitnessStartByDocId: Uint8Array;
			identityWitnessStartByLiveDocSlot: Uint8Array;
			identityWitnessTextIds: Uint8Array;
			identityWitnessSourceMaskByDocEntry: Uint8Array;
			routeWitnessStartByDocId: Uint8Array;
			routeWitnessStartByLiveDocSlot: Uint8Array;
			routeWitnessTextIds: Uint8Array;
			routeWitnessSourceMaskByDocEntry: Uint8Array;
			headingWitnessStartByDocId: Uint8Array;
			headingWitnessStartByLiveDocSlot: Uint8Array;
			headingWitnessTextIds: Uint8Array;
		};
		mutableHanRoute.identityWitnessStartByDocId = new Uint8Array();
		mutableHanRoute.identityWitnessStartByLiveDocSlot = new Uint8Array();
		mutableHanRoute.identityWitnessTextIds = new Uint8Array();
		mutableHanRoute.identityWitnessSourceMaskByDocEntry = new Uint8Array();
		mutableHanRoute.routeWitnessStartByDocId = new Uint8Array();
		mutableHanRoute.routeWitnessStartByLiveDocSlot = new Uint8Array();
		mutableHanRoute.routeWitnessTextIds = new Uint8Array();
		mutableHanRoute.routeWitnessSourceMaskByDocEntry = new Uint8Array();
		mutableHanRoute.headingWitnessStartByDocId = new Uint8Array();
		mutableHanRoute.headingWitnessStartByLiveDocSlot = new Uint8Array();
		mutableHanRoute.headingWitnessTextIds = new Uint8Array();

		const hydratedProfile = buildPackingProfile(
			base,
			queryAnalysis,
			candidateRecall!,
			unitFamilyMatches,
			{
				hydratedEvidence: hydrateCandidateEvidence(base, candidateRecall!, {
					docHanEvidenceByCandidateKey,
				}),
			},
		);

		expect(hydratedProfile).toEqual(baselineProfile);
	});
});
