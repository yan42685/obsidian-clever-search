import type { HybridLexicalLaneBlockCandidate } from "src/services/search/hybrid/lexical-lane/contracts";
import { buildHybridSharedSnippet } from "src/services/search/hybrid/shared-snippet/build-shared-snippet";
import { buildHybridSharedSnippetHeader } from "src/services/search/hybrid/shared-snippet/context-header";

function createCandidate(
	overrides: Partial<HybridLexicalLaneBlockCandidate> = {},
): HybridLexicalLaneBlockCandidate {
	return {
		filePath: "notes/incident-review.md",
		blockId: "block-1",
		startOffset: 0,
		endOffset: 12,
		startLine: 0,
		startCol: 0,
		endLine: 0,
		endCol: 12,
		text: "Incident body",
		headingChain: [],
		parentFileScore: 1,
		parentFileRank: 1,
		parentMetadataSignals: {
			basenameExact: false,
			basenamePrefix: false,
			basenameContainedInQuery: false,
			basenameTokenCoverageCount: 0,
			pathExact: false,
			pathPrefix: false,
			pathTokenCoverageCount: 0,
			pathAnchorCoverageCount: 0,
			folderHintCount: 0,
			templateFolderHit: false,
			archivePenaltyEligible: false,
			headingMetaHit: false,
			headingExactCount: 0,
			headingPrefixCount: 0,
			headingContainedInQueryCount: 0,
			headingTokenCoverageCount: 0,
			aliasHit: false,
			aliasExactCount: 0,
			aliasPrefixCount: 0,
			aliasContainedInQueryCount: 0,
			aliasTokenCoverageCount: 0,
		},
		localScore: 1,
		localSignals: {
			coverageCount: 1,
			exactCount: 1,
			prefixCount: 0,
			fuzzyCount: 0,
			queryTermCount: 1,
			missCount: 0,
			occurrenceCount: 1,
			occurrenceSpread: 0,
			distancePenaltyTotal: 0,
			distancePenaltyMax: 0,
			spanLength: 12,
			anchorOffset: 6,
		},
		termStats: [],
		matchOccurrences: [
			{
				termId: "incident",
				tier: "exact",
				start: 0,
				end: 8,
				distancePenalty: 0,
			},
		],
		...overrides,
	};
}

describe("hybrid shared snippet header", () => {
	test("keeps file and section when the combined header fits", () => {
		const snapshotText = ["# Operations", "## Incident Review", "alpha beta gamma"].join(
			"\n",
		);

		const header = buildHybridSharedSnippetHeader({
			filePath: "notes/incident-review.md",
			snapshotText,
			startLine: 2,
		});

		expect(header).toContain("File: incident-review");
		expect(header).toContain("Section: Operations > Incident Review");
	});

	test("keeps the nearest section suffix when the full breadcrumb would overflow", () => {
		const snapshotText = [
			"# Workspace Operations and Audit Trail",
			"## Incident Review Template Canonical Recovery Checklist",
			"### Followup Owner Verification and Escalation Routing",
			"alpha beta gamma",
		].join("\n");

		const header = buildHybridSharedSnippetHeader({
			filePath: "notes/incident-review.md",
			snapshotText,
			startLine: 3,
		});

		expect(header).toContain("File: incident-review");
		expect(header).toContain("Section:");
		expect(header).toContain("Followup");
		expect(header).not.toContain(
			"Workspace Operations and Audit Trail > Incident Review Template Canonical Recovery Checklist > Followup Owner Verification and Escalation Routing",
		);
	});
});

describe("buildHybridSharedSnippet", () => {
	test("bridge preview bypasses header generation", () => {
		const candidate = createCandidate({
			bridgePreviewText: "alias preview",
			bridgePreviewRanges: [{ start: 0, end: 5 }],
		});

		const payload = buildHybridSharedSnippet({
			snapshotText: "ignored",
			candidate,
			maxChars: 220,
		});

		expect(payload.headerText).toBe("");
		expect(payload.bodyText).toBe("alias preview");
		expect(payload.snippetText).toBe("alias preview");
		expect(payload.bodyHighlightRanges).toEqual([{ start: 0, end: 5 }]);
	});

	test("maps highlights relative to the shared snippet body", () => {
		const snapshotText = [
			"# Notes",
			"incident alpha happened yesterday",
			"more text here",
		].join("\n");
		const incidentStart = snapshotText.indexOf("incident");
		const alphaStart = snapshotText.indexOf("alpha");
		const endOffset = snapshotText.indexOf("yesterday") + "yesterday".length;
		const baseSignals = createCandidate().localSignals;
		const candidate = createCandidate({
			startOffset: incidentStart,
			endOffset,
			startLine: 1,
			endLine: 1,
			startCol: 0,
			endCol: endOffset - incidentStart,
			matchOccurrences: [
				{
					termId: "incident",
					tier: "exact",
					start: incidentStart,
					end: incidentStart + "incident".length,
					distancePenalty: 0,
				},
				{
					termId: "alpha",
					tier: "exact",
					start: alphaStart,
					end: alphaStart + "alpha".length,
					distancePenalty: 0,
				},
			],
			localSignals: {
				...baseSignals,
				anchorOffset: alphaStart,
			},
		});

		const payload = buildHybridSharedSnippet({
			snapshotText,
			candidate,
			maxChars: 220,
		});

		expect(payload.headerText).toBe("File: incident-review\nSection: Notes");
		expect(payload.bodyHighlightRanges).toHaveLength(2);
		expect(
			payload.bodyText.slice(
				payload.bodyHighlightRanges[0].start,
				payload.bodyHighlightRanges[0].end,
			),
		).toBe("incident");
		expect(
			payload.bodyText.slice(
				payload.bodyHighlightRanges[1].start,
				payload.bodyHighlightRanges[1].end,
			),
		).toBe("alpha");
		expect(payload.highlightRanges[0].start).toBeGreaterThan(
			payload.bodyHighlightRanges[0].start,
		);
	});
});
