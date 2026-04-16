import {
	compareContainerStrength,
	comparePackingProfiles,
	comparePackingProfilesBeforeHanSurfaceCompletion,
} from "src/services/search/coverage-lexical-v3/ranking/comparator";
import type {
	BodyWindowContainer,
	EvidencePackingProfile,
	IdentityContainer,
	MetadataPackingSignature,
	RouteContainer,
} from "src/services/search/coverage-lexical-v3/ranking/types";

function createIdentityContainer(
	coveredUnitIndices: number[],
	exactUnitCount = coveredUnitIndices.length,
	compactness = coveredUnitIndices.length * 100 + 320,
): IdentityContainer {
	return {
		tier: "identity",
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		containerCompactness: compactness,
		exactUnitCount,
	};
}

function createRouteContainer(
	coveredUnitIndices: number[],
	exactUnitCount = coveredUnitIndices.length,
	compactness = coveredUnitIndices.length * 100 + 240,
): RouteContainer {
	return {
		tier: "route",
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		containerCompactness: compactness,
		exactUnitCount,
	};
}

function createBodyWindowContainer(
	coveredUnitIndices: number[],
	options: Partial<BodyWindowContainer> = {},
): BodyWindowContainer {
	return {
		tier: "bodyWindow",
		blockIds: options.blockIds ?? [0],
		boundaryCrossingCount: options.boundaryCrossingCount ?? 0,
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		containerCompactness:
			options.containerCompactness ?? coveredUnitIndices.length * 200 + 200,
		exactUnitCount: options.exactUnitCount ?? coveredUnitIndices.length,
		windowWidth: options.windowWidth ?? coveredUnitIndices.length,
		gapCount: options.gapCount ?? 0,
		density: options.density ?? 1,
		headingCorroboration: options.headingCorroboration ?? {
			coveredUnitIndices: [],
			unitCount: 0,
		},
	};
}

function createPackingProfile(
	overrides: Partial<EvidencePackingProfile> & Pick<EvidencePackingProfile, "path">,
): EvidencePackingProfile {
	const strongestContainer = overrides.strongestContainer ?? null;
	const secondStrongestContainer = overrides.secondStrongestContainer ?? null;
	return {
		docId: overrides.docId ?? 0,
		path: overrides.path,
		stableKey: overrides.stableKey ?? overrides.path,
		surfaceCoverageShapeKey: overrides.surfaceCoverageShapeKey ?? "lll",
		realizedCoverageCount: overrides.realizedCoverageCount ?? 0,
		coverageGate: overrides.coverageGate ?? {
			realizedCoverageCount: overrides.realizedCoverageCount ?? 0,
			fullySatisfiedSurfaceGroupCount: 0,
			startedSurfaceGroupCount: 0,
			crossScriptSatisfiedGroupCount: 0,
		},
		exactUnitCount: overrides.exactUnitCount ?? 0,
		completedHanSurfaceGroupCount: overrides.completedHanSurfaceGroupCount ?? 0,
		hanSurfaceCompletionTierScoreTotal: overrides.hanSurfaceCompletionTierScoreTotal ?? 0,
		strongestHanSurfaceCompletionTier:
			overrides.strongestHanSurfaceCompletionTier ?? "none",
		hanSurfaceCompletionGroups: overrides.hanSurfaceCompletionGroups ?? [],
		prefixCompletionGainTotal: overrides.prefixCompletionGainTotal ?? 0,
		compoundPrefixCount: overrides.compoundPrefixCount ?? 0,
		fuzzyUnitCount: overrides.fuzzyUnitCount ?? 0,
		fuzzyEditDistanceTotal: overrides.fuzzyEditDistanceTotal ?? 0,
		metadataPackingSignature:
			overrides.metadataPackingSignature ?? createMetadataPackingSignature(),
		realizedFamilies: overrides.realizedFamilies ?? [],
		identityContainer: overrides.identityContainer ?? null,
		routeContainer: overrides.routeContainer ?? null,
		bodyWindowContainer: overrides.bodyWindowContainer ?? null,
		strongestContainer,
		secondStrongestContainer,
		fragmentationPenalty:
			overrides.fragmentationPenalty ?? {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 0,
			},
	};
}

function createMetadataPackingSignature(
	overrides: Partial<MetadataPackingSignature> = {},
): MetadataPackingSignature {
	return {
		basenameUnitCount: overrides.basenameUnitCount ?? 0,
		aliasUnitCount: overrides.aliasUnitCount ?? 0,
		routeUnitCount: overrides.routeUnitCount ?? 0,
		sortedBuckets: overrides.sortedBuckets ?? [],
	};
}

describe("coverage lexical v3 comparator", () => {
	test("3 identity + 3 bodyWindow outranks 2 identity + 2 route + 2 residue", () => {
		const packed = createPackingProfile({
			path: "packed.md",
			realizedCoverageCount: 6,
			exactUnitCount: 6,
			identityContainer: createIdentityContainer([0, 1, 2]),
			bodyWindowContainer: createBodyWindowContainer([3, 4, 5], {
				containerCompactness: 960,
			}),
			strongestContainer: createIdentityContainer([0, 1, 2]),
			secondStrongestContainer: createBodyWindowContainer([3, 4, 5], {
				containerCompactness: 960,
			}),
			fragmentationPenalty: {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 2,
			},
		});
		const fragmented = createPackingProfile({
			path: "fragmented.md",
			realizedCoverageCount: 6,
			exactUnitCount: 6,
			identityContainer: createIdentityContainer([0, 1]),
			routeContainer: createRouteContainer([2, 3]),
			strongestContainer: createIdentityContainer([0, 1]),
			secondStrongestContainer: createRouteContainer([2, 3]),
			fragmentationPenalty: {
				bodyResidueUnitCount: 2,
				uncoveredByTopTwoCount: 2,
				explanatoryContainerCount: 3,
			},
		});

		expect(comparePackingProfiles(packed, fragmented)).toBeLessThan(0);
	});

	test("route outranks bodyWindow only when packing is close", () => {
		const route = createRouteContainer([0, 1, 2], 3, 560);
		const closeBody = createBodyWindowContainer([0, 1, 2], {
			containerCompactness: 640,
		});
		const strongBody = createBodyWindowContainer([0, 1, 2], {
			containerCompactness: 980,
		});

		expect(compareContainerStrength(route, closeBody)).toBeLessThan(0);
		expect(compareContainerStrength(strongBody, route)).toBeLessThan(0);
	});

	test("identity outranks bodyWindow when coverage is the same", () => {
		const identity = createIdentityContainer([0, 1], 2, 520);
		const strongBody = createBodyWindowContainer([0, 1], {
			containerCompactness: 980,
		});

		expect(compareContainerStrength(identity, strongBody)).toBeLessThan(0);
	});

	test("heading only strengthens bodyWindow and does not create an extra tier", () => {
		const withoutHeading = createPackingProfile({
			path: "without-heading.md",
			realizedCoverageCount: 3,
			exactUnitCount: 3,
			bodyWindowContainer: createBodyWindowContainer([0, 1, 2], {
				containerCompactness: 860,
				headingCorroboration: {
					coveredUnitIndices: [],
					unitCount: 0,
				},
			}),
			strongestContainer: createBodyWindowContainer([0, 1, 2], {
				containerCompactness: 860,
				headingCorroboration: {
					coveredUnitIndices: [],
					unitCount: 0,
				},
			}),
		});
		const withHeading = createPackingProfile({
			path: "with-heading.md",
			realizedCoverageCount: 3,
			exactUnitCount: 3,
			bodyWindowContainer: createBodyWindowContainer([0, 1, 2], {
				containerCompactness: 900,
				headingCorroboration: {
					coveredUnitIndices: [0, 1],
					unitCount: 2,
				},
			}),
			strongestContainer: createBodyWindowContainer([0, 1, 2], {
				containerCompactness: 900,
				headingCorroboration: {
					coveredUnitIndices: [0, 1],
					unitCount: 2,
				},
			}),
		});

		expect(comparePackingProfiles(withHeading, withoutHeading)).toBeLessThan(0);
		expect(withHeading.routeContainer).toBeNull();
		expect(withHeading.identityContainer).toBeNull();
	});

	test("coverage gate prefers fuller surface-group satisfaction before packing", () => {
		const fuller = createPackingProfile({
			path: "z-fuller.md",
			realizedCoverageCount: 2,
			coverageGate: {
				realizedCoverageCount: 2,
				fullySatisfiedSurfaceGroupCount: 2,
				startedSurfaceGroupCount: 2,
				crossScriptSatisfiedGroupCount: 1,
			},
			strongestContainer: createBodyWindowContainer([0, 1], {
				containerCompactness: 800,
			}),
		});
		const partial = createPackingProfile({
			path: "a-partial.md",
			realizedCoverageCount: 2,
			coverageGate: {
				realizedCoverageCount: 2,
				fullySatisfiedSurfaceGroupCount: 1,
				startedSurfaceGroupCount: 2,
				crossScriptSatisfiedGroupCount: 1,
			},
			strongestContainer: createIdentityContainer([0], 1, 620),
		});

		expect(comparePackingProfiles(fuller, partial)).toBeLessThan(0);
	});

	test("coverage gate uses started groups and cross-script satisfaction before packing", () => {
		const broaderStart = createPackingProfile({
			path: "z-broader-start.md",
			realizedCoverageCount: 2,
			coverageGate: {
				realizedCoverageCount: 2,
				fullySatisfiedSurfaceGroupCount: 1,
				startedSurfaceGroupCount: 2,
				crossScriptSatisfiedGroupCount: 1,
			},
		});
		const narrowerStart = createPackingProfile({
			path: "a-narrower-start.md",
			realizedCoverageCount: 2,
			coverageGate: {
				realizedCoverageCount: 2,
				fullySatisfiedSurfaceGroupCount: 1,
				startedSurfaceGroupCount: 1,
				crossScriptSatisfiedGroupCount: 1,
			},
		});
		const crossScript = createPackingProfile({
			path: "z-cross-script.md",
			realizedCoverageCount: 2,
			coverageGate: {
				realizedCoverageCount: 2,
				fullySatisfiedSurfaceGroupCount: 1,
				startedSurfaceGroupCount: 1,
				crossScriptSatisfiedGroupCount: 2,
			},
		});
		const singleScript = createPackingProfile({
			path: "a-single-script.md",
			realizedCoverageCount: 2,
			coverageGate: {
				realizedCoverageCount: 2,
				fullySatisfiedSurfaceGroupCount: 1,
				startedSurfaceGroupCount: 1,
				crossScriptSatisfiedGroupCount: 1,
			},
		});

		expect(comparePackingProfiles(broaderStart, narrowerStart)).toBeLessThan(0);
		expect(comparePackingProfiles(crossScript, singleScript)).toBeLessThan(0);
	});

	test("exact count is a late tie-break", () => {
		const prefixHeavy = createPackingProfile({
			path: "prefix.md",
			realizedCoverageCount: 3,
			exactUnitCount: 1,
			strongestContainer: createBodyWindowContainer([0, 1, 2], {
				containerCompactness: 920,
			}),
			fragmentationPenalty: {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 1,
			},
		});
		const exactHeavy = createPackingProfile({
			path: "exact.md",
			realizedCoverageCount: 3,
			exactUnitCount: 3,
			strongestContainer: createBodyWindowContainer([0, 1, 2], {
				containerCompactness: 920,
			}),
			fragmentationPenalty: {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 1,
			},
		});

		expect(comparePackingProfiles(exactHeavy, prefixHeavy)).toBeLessThan(0);
	});

	test("metadata packing prefers basename over alias after exact ties", () => {
		const basenameHeavy = createPackingProfile({
			path: "z-basename.md",
			realizedCoverageCount: 2,
			exactUnitCount: 2,
			strongestContainer: createIdentityContainer([0, 1]),
			metadataPackingSignature: createMetadataPackingSignature({
				basenameUnitCount: 2,
				sortedBuckets: [{ source: "basename", unitCount: 2 }],
			}),
		});
		const aliasHeavy = createPackingProfile({
			path: "a-alias.md",
			realizedCoverageCount: 2,
			exactUnitCount: 2,
			strongestContainer: createIdentityContainer([0, 1]),
			metadataPackingSignature: createMetadataPackingSignature({
				aliasUnitCount: 2,
				sortedBuckets: [{ source: "alias", unitCount: 2 }],
			}),
		});

		expect(comparePackingProfiles(basenameHeavy, aliasHeavy)).toBeLessThan(0);
	});

	test("metadata packing prefers alias over route after exact ties", () => {
		const aliasHeavy = createPackingProfile({
			path: "z-alias.md",
			realizedCoverageCount: 2,
			exactUnitCount: 2,
			strongestContainer: createIdentityContainer([0, 1]),
			metadataPackingSignature: createMetadataPackingSignature({
				aliasUnitCount: 2,
				sortedBuckets: [{ source: "alias", unitCount: 2 }],
			}),
		});
		const routeHeavy = createPackingProfile({
			path: "a-route.md",
			realizedCoverageCount: 2,
			exactUnitCount: 2,
			strongestContainer: createIdentityContainer([0, 1]),
			metadataPackingSignature: createMetadataPackingSignature({
				routeUnitCount: 2,
				sortedBuckets: [{ source: "route", unitCount: 2 }],
			}),
		});

		expect(comparePackingProfiles(aliasHeavy, routeHeavy)).toBeLessThan(0);
	});

	test("route packing does not distinguish tag from folder when counts tie", () => {
		const tagLikeRoute = createPackingProfile({
			path: "z-tag.md",
			realizedCoverageCount: 2,
			exactUnitCount: 2,
			strongestContainer: createRouteContainer([0, 1]),
			metadataPackingSignature: createMetadataPackingSignature({
				routeUnitCount: 2,
				sortedBuckets: [{ source: "route", unitCount: 2 }],
			}),
		});
		const folderLikeRoute = createPackingProfile({
			path: "a-folder.md",
			realizedCoverageCount: 2,
			exactUnitCount: 2,
			strongestContainer: createRouteContainer([0, 1]),
			metadataPackingSignature: createMetadataPackingSignature({
				routeUnitCount: 2,
				sortedBuckets: [{ source: "route", unitCount: 2 }],
			}),
		});

		expect(
			comparePackingProfilesBeforeHanSurfaceCompletion(tagLikeRoute, folderLikeRoute),
		).toBe(0);
	});

	test("metadata packing does not override exact count", () => {
		const strongerPacking = createPackingProfile({
			path: "z-packing.md",
			realizedCoverageCount: 2,
			exactUnitCount: 1,
			strongestContainer: createIdentityContainer([0, 1]),
			metadataPackingSignature: createMetadataPackingSignature({
				basenameUnitCount: 2,
				sortedBuckets: [{ source: "basename", unitCount: 2 }],
			}),
		});
		const strongerExact = createPackingProfile({
			path: "a-exact.md",
			realizedCoverageCount: 2,
			exactUnitCount: 2,
			strongestContainer: createIdentityContainer([0, 1]),
			metadataPackingSignature: createMetadataPackingSignature({
				routeUnitCount: 2,
				sortedBuckets: [{ source: "route", unitCount: 2 }],
			}),
		});

		expect(comparePackingProfiles(strongerExact, strongerPacking)).toBeLessThan(0);
	});

	test("mixed-source units do not outrank pure basename when best-source packing is equal", () => {
		const pureBasename = createPackingProfile({
			path: "a-basename.md",
			realizedCoverageCount: 1,
			exactUnitCount: 1,
			strongestContainer: createIdentityContainer([0]),
			metadataPackingSignature: createMetadataPackingSignature({
				basenameUnitCount: 1,
				sortedBuckets: [{ source: "basename", unitCount: 1 }],
			}),
		});
		const basenameWithAliasCorroboration = createPackingProfile({
			path: "z-mixed.md",
			realizedCoverageCount: 1,
			exactUnitCount: 1,
			strongestContainer: createIdentityContainer([0]),
			metadataPackingSignature: createMetadataPackingSignature({
				basenameUnitCount: 1,
				sortedBuckets: [{ source: "basename", unitCount: 1 }],
			}),
		});

		expect(
			comparePackingProfilesBeforeHanSurfaceCompletion(
				pureBasename,
				basenameWithAliasCorroboration,
			),
		).toBe(0);
	});

	test("redundant route corroboration does not outrank a cleaner explanation before exact tie-breaks", () => {
		const packed = createPackingProfile({
			path: "a-packed.md",
			realizedCoverageCount: 2,
			exactUnitCount: 2,
			identityContainer: createIdentityContainer([0, 1]),
			bodyWindowContainer: createBodyWindowContainer([0, 1], {
				containerCompactness: 840,
			}),
			strongestContainer: createIdentityContainer([0, 1]),
			secondStrongestContainer: createBodyWindowContainer([0, 1], {
				containerCompactness: 840,
			}),
			fragmentationPenalty: {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 2,
			},
		});
		const corroborated = createPackingProfile({
			path: "z-corroborated.md",
			realizedCoverageCount: 2,
			exactUnitCount: 3,
			identityContainer: createIdentityContainer([0, 1]),
			routeContainer: createRouteContainer([1]),
			bodyWindowContainer: createBodyWindowContainer([0, 1], {
				containerCompactness: 840,
			}),
			strongestContainer: createIdentityContainer([0, 1]),
			secondStrongestContainer: createBodyWindowContainer([0, 1], {
				containerCompactness: 840,
			}),
			fragmentationPenalty: {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 2,
			},
		});

		expect(comparePackingProfiles(corroborated, packed)).toBeLessThan(0);
	});

	test("smaller prefix completion gain wins before path fallback", () => {
		const tighterPrefix = createPackingProfile({
			path: "z-preference.md",
			realizedCoverageCount: 1,
			exactUnitCount: 0,
			prefixCompletionGainTotal: 1,
			strongestContainer: createBodyWindowContainer([0], {
				containerCompactness: 260,
			}),
		});
		const looserPrefix = createPackingProfile({
			path: "a-prefer.md",
			realizedCoverageCount: 1,
			exactUnitCount: 0,
			prefixCompletionGainTotal: 5,
			strongestContainer: createBodyWindowContainer([0], {
				containerCompactness: 260,
			}),
		});

		expect(comparePackingProfiles(tighterPrefix, looserPrefix)).toBeLessThan(0);
	});

	test("non-compound prefix wins when completion gain ties", () => {
		const plainPrefix = createPackingProfile({
			path: "z-plain.md",
			realizedCoverageCount: 1,
			exactUnitCount: 0,
			prefixCompletionGainTotal: 2,
			compoundPrefixCount: 0,
			strongestContainer: createBodyWindowContainer([0], {
				containerCompactness: 260,
			}),
		});
		const compoundPrefix = createPackingProfile({
			path: "a-compound.md",
			realizedCoverageCount: 1,
			exactUnitCount: 0,
			prefixCompletionGainTotal: 2,
			compoundPrefixCount: 1,
			strongestContainer: createBodyWindowContainer([0], {
				containerCompactness: 260,
			}),
		});

		expect(comparePackingProfiles(plainPrefix, compoundPrefix)).toBeLessThan(0);
	});

	test("fewer fuzzy realized units wins after prefix tie-breaks", () => {
		const cleaner = createPackingProfile({
			path: "z-cleaner.md",
			realizedCoverageCount: 2,
			fuzzyUnitCount: 0,
			fuzzyEditDistanceTotal: 0,
			strongestContainer: createBodyWindowContainer([0, 1], {
				containerCompactness: 320,
			}),
		});
		const fuzzier = createPackingProfile({
			path: "a-fuzzier.md",
			realizedCoverageCount: 2,
			fuzzyUnitCount: 1,
			fuzzyEditDistanceTotal: 1,
			strongestContainer: createBodyWindowContainer([0, 1], {
				containerCompactness: 320,
			}),
		});

		expect(comparePackingProfiles(cleaner, fuzzier)).toBeLessThan(0);
	});

	test("completed Han surface witness wins as a very late tie-break", () => {
		const completed = createPackingProfile({
			path: "z-completed.md",
			realizedCoverageCount: 1,
			exactUnitCount: 1,
			completedHanSurfaceGroupCount: 1,
			hanSurfaceCompletionTierScoreTotal: 2,
			strongestHanSurfaceCompletionTier: "body_window",
			strongestContainer: createBodyWindowContainer([0], {
				containerCompactness: 260,
			}),
		});
		const partial = createPackingProfile({
			path: "a-partial.md",
			realizedCoverageCount: 1,
			exactUnitCount: 1,
			strongestContainer: createBodyWindowContainer([0], {
				containerCompactness: 260,
			}),
		});

		expect(comparePackingProfiles(completed, partial)).toBeLessThan(0);
	});

	test("surfaceCoverageShape does not participate in same-band packing comparison", () => {
		const left = createPackingProfile({
			path: "a.md",
			surfaceCoverageShapeKey: "llh",
			realizedCoverageCount: 3,
			exactUnitCount: 2,
			strongestContainer: createIdentityContainer([0, 1, 2]),
		});
		const right = createPackingProfile({
			path: "b.md",
			surfaceCoverageShapeKey: "hhh",
			realizedCoverageCount: 3,
			exactUnitCount: 2,
			strongestContainer: createIdentityContainer([0, 1, 2]),
		});

		expect(comparePackingProfiles(left, right)).toBeLessThan(0);
		expect(comparePackingProfiles(right, left)).toBeGreaterThan(0);
	});
});
