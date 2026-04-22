import { renderV3DirectSubitemCandidate } from "src/services/search/coverage-lexical-v3/direct-subitems/renderer";
import type {
	V3DirectSubitemAtom,
	V3DirectSubitemCandidate,
	V3DirectSubitemComponent,
} from "src/services/search/coverage-lexical-v3/direct-subitems/contracts";

function createAtom(
	overrides: Partial<V3DirectSubitemAtom> = {},
): V3DirectSubitemAtom {
	return {
		kind: overrides.kind ?? "realized_family_atom",
		evidenceKind: overrides.evidenceKind ?? "real_exact",
		queryUnitIndex: overrides.queryUnitIndex ?? 0,
		surfaceGroupIndex: overrides.surfaceGroupIndex ?? 0,
		blockId: overrides.blockId ?? 0,
		start: overrides.start ?? 0,
		end: overrides.end ?? 3,
		matchedText: overrides.matchedText ?? "abc",
		anchorTier: overrides.anchorTier ?? "real_lexical",
		highlightTier: overrides.highlightTier ?? "strong",
		bigramText: overrides.bigramText ?? null,
	};
}

function createComponent(
	atoms: readonly V3DirectSubitemAtom[],
): V3DirectSubitemComponent {
	return {
		scopeStart: 0,
		scopeEnd: 40,
		scopeTier: "body_window",
		blockIds: [...new Set(atoms.map((atom) => atom.blockId))],
		atoms,
	};
}

function createCandidate(
	overrides: Partial<V3DirectSubitemCandidate> = {},
): V3DirectSubitemCandidate {
	const atoms = overrides.atoms ?? [createAtom()];
	return {
		start: overrides.start ?? atoms[0]?.start ?? 0,
		end: overrides.end ?? atoms[atoms.length - 1]?.end ?? 3,
		anchorOffset: overrides.anchorOffset ?? atoms[0]?.start ?? 0,
		component: overrides.component ?? createComponent(atoms),
		atoms,
		displayAtoms: overrides.displayAtoms ?? atoms,
		hasAnchor: overrides.hasAnchor ?? true,
		anchorTier: overrides.anchorTier ?? "real_lexical",
		coveredRealPrimaryCount: overrides.coveredRealPrimaryCount ?? 1,
		confirmedSurfaceGroupCount: overrides.confirmedSurfaceGroupCount ?? 0,
		singletonHanCompletionTier: overrides.singletonHanCompletionTier ?? "none",
		matchedOpaqueBigramCount: overrides.matchedOpaqueBigramCount ?? 0,
		opaqueCoverageRatio: overrides.opaqueCoverageRatio ?? 0,
		preservesQueryOrder: overrides.preservesQueryOrder ?? true,
		windowWidth: overrides.windowWidth ?? 3,
		maxAdjacentGap: overrides.maxAdjacentGap ?? 0,
		totalGap: overrides.totalGap ?? 0,
	};
}

describe("coverage lexical v3 direct subitems renderer", () => {
	test("falls back to atoms when display atoms are empty", () => {
		const payload = renderV3DirectSubitemCandidate({
			snapshotText: "abc rest of snippet",
			candidate: createCandidate({
				atoms: [
					createAtom({
						start: 0,
						end: 3,
						matchedText: "abc",
					}),
				],
				displayAtoms: [],
			}),
		});

		expect(payload.highlightRanges).toEqual([{ start: 0, end: 3 }]);
		expect(payload.snippetText.slice(0, 3)).toBe("abc");
	});

	test("expands display context above and below the seed lines within budget", () => {
		const snapshotText = [
			"context line above",
			"alpha mention lives here",
			"beta mention lives here",
			"context line below",
			"second line below",
			"third line below should stay out",
		].join("\n");
		const alphaStart = snapshotText.indexOf("alpha");
		const betaStart = snapshotText.indexOf("beta");
		const payload = renderV3DirectSubitemCandidate({
			snapshotText,
			candidate: createCandidate({
				start: alphaStart,
				end: betaStart + "beta".length,
				anchorOffset: alphaStart,
				atoms: [
					createAtom({
						start: alphaStart,
						end: alphaStart + "alpha".length,
						queryUnitIndex: 0,
						surfaceGroupIndex: 0,
						matchedText: "alpha",
					}),
					createAtom({
						start: betaStart,
						end: betaStart + "beta".length,
						queryUnitIndex: 1,
						surfaceGroupIndex: 1,
						matchedText: "beta",
					}),
				],
			}),
			maxChars: 120,
		});

		expect(payload.text).toContain("context line above");
		expect(payload.text).toContain("context line below");
		expect(payload.text).not.toContain("third line below should stay out");
	});

	test("keeps multiple opaque bigrams from the same Han surface group visible", () => {
		const snapshotText = "这是一段赢宋风格的窄体字。";
		const winSongStart = snapshotText.indexOf("赢宋");
		const condensedStart = snapshotText.indexOf("窄体");
		const payload = renderV3DirectSubitemCandidate({
			snapshotText,
			candidate: createCandidate({
				start: winSongStart,
				end: condensedStart + "窄体".length,
				anchorOffset: winSongStart,
				atoms: [
					createAtom({
						kind: "opaque_bigram_atom",
						evidenceKind: "opaque_bigram",
						queryUnitIndex: null,
						surfaceGroupIndex: 0,
						start: winSongStart,
						end: winSongStart + "赢宋".length,
						matchedText: "赢宋",
						bigramText: "赢宋",
						anchorTier: "weak_opaque_bigram",
						highlightTier: "strong",
					}),
					createAtom({
						kind: "opaque_bigram_atom",
						evidenceKind: "opaque_bigram",
						queryUnitIndex: null,
						surfaceGroupIndex: 0,
						start: condensedStart,
						end: condensedStart + "窄体".length,
						matchedText: "窄体",
						bigramText: "窄体",
						anchorTier: "weak_opaque_bigram",
						highlightTier: "strong",
					}),
				],
			}),
		});

		const highlighted = payload.highlightRanges.map((range) =>
			payload.snippetText.slice(range.start, range.end),
		);
		expect(highlighted).toContain("赢宋");
		expect(highlighted).toContain("窄体");
	});
});


