import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import { readResidentBodyFamilySupportSidecar } from "src/services/search/coverage-lexical-v3/layout/body-blocks";
import { buildResidentExactTapeSidecar } from "src/services/search/coverage-lexical-v3/layout/exact-tapes";
import {
	buildResidentHanWitnessSidecar,
	createEmptyResidentHanWitnessSidecar,
	setResidentHanWitnessSidecar,
} from "src/services/search/coverage-lexical-v3/layout/han-route";
import { analyzeQuery } from "src/services/search/coverage-lexical-v3/query";
import {
	getLiveDocHeadingHanWitnessStringIds,
	getLiveDocIdentityHanWitnessSourceMasks,
	getLiveDocIdentityHanWitnessStringIds,
	getLiveDocRouteHanWitnessSourceMasks,
	getLiveDocRouteHanWitnessStringIds,
	lookupQueryUnitFamilies,
	recallCandidateDocs,
} from "src/services/search/coverage-lexical-v3/recall";
import {
	buildPackingProfile,
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

	it("builds the same packing profile when hydrated from exact/body/han sidecars", () => {
		const document = createDocument({
			path: "notes/han-sidecar-evidence.md",
			basename: "han sidecar evidence",
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
		const hydratedProfile = buildPackingProfile(
			base,
			queryAnalysis,
			candidateRecall!,
			unitFamilyMatches,
			{
				hydratedEvidence: hydrateCandidateEvidence(base, candidateRecall!, {
					exactTapeSidecar: buildResidentExactTapeSidecar(base.exactTapes),
					bodyFamilySupportSidecar: readResidentBodyFamilySupportSidecar(
						base.bodyBlocks,
					),
					hanWitnessSidecar: buildResidentHanWitnessSidecar(base.hanRoute),
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
		const docHanEvidenceByLiveDocSlot = new Map([
			[
				liveDocSlot,
				{
					identityWitnessStringIds: getLiveDocIdentityHanWitnessStringIds(
						base,
						liveDocSlot,
					),
					identityWitnessSourceMasks: getLiveDocIdentityHanWitnessSourceMasks(
						base,
						liveDocSlot,
					),
					routeWitnessStringIds: getLiveDocRouteHanWitnessStringIds(
						base,
						liveDocSlot,
					),
					routeWitnessSourceMasks: getLiveDocRouteHanWitnessSourceMasks(
						base,
						liveDocSlot,
					),
					headingWitnessStringIds: getLiveDocHeadingHanWitnessStringIds(
						base,
						liveDocSlot,
					),
				},
			] as const,
		]);

		setResidentHanWitnessSidecar(base.hanRoute, createEmptyResidentHanWitnessSidecar());

		const hydratedProfile = buildPackingProfile(
			base,
			queryAnalysis,
			candidateRecall!,
			unitFamilyMatches,
			{
				hydratedEvidence: hydrateCandidateEvidence(base, candidateRecall!, {
					docHanEvidenceByLiveDocSlot,
				}),
			},
		);

		expect(hydratedProfile).toEqual(baselineProfile);
	});
});
