import {
	compareContainerStrength,
	comparePackingProfiles,
} from "src/services/search/coverage-lexical-v3/ranking/comparator";
import type {
	BodyWindowContainer,
	EvidencePackingProfile,
	IdentityContainer,
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
		exactUnitCount: overrides.exactUnitCount ?? 0,
		prefixCompletionGainTotal: overrides.prefixCompletionGainTotal ?? 0,
		compoundPrefixCount: overrides.compoundPrefixCount ?? 0,
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
				activeContainerCount: 0,
			},
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
				activeContainerCount: 2,
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
				activeContainerCount: 3,
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
				activeContainerCount: 1,
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
				activeContainerCount: 1,
			},
		});

		expect(comparePackingProfiles(exactHeavy, prefixHeavy)).toBeLessThan(0);
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
