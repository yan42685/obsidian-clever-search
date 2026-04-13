import {
	buildCoverageLexicalV2CandidateCascadeBestWindowForDocument,
	buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits,
	type CoverageLexicalV2CandidateCascadeDocumentLexicalState,
	type CoverageLexicalV2CandidateCascadePrefixHint,
	type CoverageLexicalV2CandidateCascadePrimaryUnitDefinition,
} from "src/services/search/coverage-lexical-v2/candidate-cascade";

describe("coverage lexical v2 candidate evidence helpers", () => {
	test("builds matched primary units from query-aware field evidence", () => {
		const primaryUnits: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[] = [
			{
				normalizedText: "ai",
				surfaceGroupIndex: 0,
				surfaceKind: "latin",
			},
			{
				normalizedText: "??",
				surfaceGroupIndex: 1,
				surfaceKind: "han",
			},
		];

		const matchedPrimaryUnits = buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits(
			primaryUnits,
			{
				docId: "doc-1",
				path: "notes/ai-shengkao.md",
				record: {
					path: "notes/ai-shengkao.md",
					stableDeterministicKey: "notes/ai-shengkao.md",
					basenameText: "ai",
					aliasesText: "",
					headingsText: "",
					folderText: "notes",
					tagsText: "",
				},
				fieldTerms: {
					basenameTerms: ["ai"],
					bodyTerms: ["ai", "??"],
				},
			},
			{
				includePrefix: true,
				includeFuzzy: true,
				fuzzyProportion: 0.2,
			},
		);

		expect(matchedPrimaryUnits).toEqual([
			{
				normalizedText: "ai",
				surfaceGroupIndex: 0,
				surfaceKind: "latin",
				strongestField: "basename",
				corroboratedFields: ["body"],
				matchQuality: "exact",
			},
			{
				normalizedText: "??",
				surfaceGroupIndex: 1,
				surfaceKind: "han",
				strongestField: "body",
				corroboratedFields: [],
				matchQuality: "exact",
			},
		]);
	});

	test("builds metadata prefix witness from basename and prefers natural completion", () => {
		const primaryUnits: CoverageLexicalV2CandidateCascadePrimaryUnitDefinition[] = [
			{
				normalizedText: "pas",
				surfaceGroupIndex: 0,
				surfaceKind: "latin",
			},
		];
		const prefixHints = new Map<number, CoverageLexicalV2CandidateCascadePrefixHint>([
			[0, {
				field: "basename",
				matchedTerm: "password",
				fieldDocCount: 2,
			}],
		]);

		const matchedPrimaryUnits = buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits(
			primaryUnits,
			{
				docId: "doc-1",
				path: "notes/password.md",
				record: {
					path: "notes/password.md",
					stableDeterministicKey: "notes/password.md",
					basenameText: "password",
					aliasesText: "",
					headingsText: "",
					folderText: "vault/passwords",
					tagsText: "",
				},
				fieldTerms: {
					basenameTerms: ["password"],
					folderTerms: ["password-v2"],
				},
			},
			{ includePrefix: true },
			prefixHints,
		);

		expect(matchedPrimaryUnits[0]?.prefixWitnessLite).toEqual({
			field: "basename",
			surfaceText: "password",
			cleanBoundary: true,
			compoundPenalty: false,
			surfaceCompletionGain: 5,
			fieldDocCount: 2,
		});
	});

	test("falls back to matchedTerm when metadata raw text does not expose a better surface token", () => {
		const matchedPrimaryUnits = buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits(
			[
				{
					normalizedText: "sec",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
				},
			],
			{
				docId: "doc-2",
				path: "notes/security.md",
				record: {
					path: "notes/security.md",
					stableDeterministicKey: "notes/security.md",
					basenameText: "###",
					aliasesText: "",
					headingsText: "",
					folderText: "",
					tagsText: "",
				},
				fieldTerms: {
					basenameTerms: ["security"],
				},
			},
			{ includePrefix: true },
			new Map([[0, { field: "basename", matchedTerm: "security", fieldDocCount: 4 }]]),
		);

		expect(matchedPrimaryUnits[0]?.prefixWitnessLite).toEqual({
			field: "basename",
			surfaceText: "security",
			cleanBoundary: true,
			compoundPenalty: false,
			surfaceCompletionGain: 5,
			fieldDocCount: 4,
		});
	});

	test("does not build prefix witnesses for body-only prefix evidence", () => {
		const matchedPrimaryUnits = buildCoverageLexicalV2CandidateCascadeMatchedPrimaryUnits(
			[
				{
					normalizedText: "pas",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
				},
			],
			{
				docId: "doc-3",
				path: "notes/body-only.md",
				record: {
					path: "notes/body-only.md",
					stableDeterministicKey: "notes/body-only.md",
					basenameText: "misc",
					aliasesText: "",
					headingsText: "",
					folderText: "",
					tagsText: "",
				},
				fieldTerms: {
					bodyTerms: ["password"],
				},
			},
			{ includePrefix: true },
			new Map([[0, { field: "body", matchedTerm: "password", fieldDocCount: 10 }]]),
		);

		expect(matchedPrimaryUnits).toEqual([
			{
				normalizedText: "pas",
				surfaceGroupIndex: 0,
				surfaceKind: "latin",
				strongestField: "body",
				corroboratedFields: [],
				matchQuality: "prefix",
			},
		]);
	});

	test("derives best window only from exact local evidence", () => {
		const document: CoverageLexicalV2CandidateCascadeDocumentLexicalState = {
			docId: "doc-1",
			path: "notes/ai-shengkao.md",
			record: {
				path: "notes/ai-shengkao.md",
				stableDeterministicKey: "notes/ai-shengkao.md",
				basenameText: "ai ??",
				aliasesText: "",
				headingsText: "",
				folderText: "notes",
				tagsText: "",
			},
			fieldTerms: {
				basenameTerms: ["ai", "??"],
			},
			basenameTokenSequence: ["ai", "??"],
		};

		const bestWindow = buildCoverageLexicalV2CandidateCascadeBestWindowForDocument(
			[
				{
					normalizedText: "ai",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "basename",
					matchQuality: "exact",
				},
				{
					normalizedText: "??",
					surfaceGroupIndex: 1,
					surfaceKind: "han",
					strongestField: "basename",
					matchQuality: "exact",
				},
			],
			document,
		);

		expect(bestWindow).toEqual({
			field: "basename",
			matchedUnitKeys: ["0:ai", "1:??"],
			contiguousSurfaceGroupCount: 2,
			windowWidth: 2,
			averageDistance: 1,
			preservesSurfaceOrder: true,
		});
	});

	test("lets contiguous Han token spans beat split spans inside the same field", () => {
		const document: CoverageLexicalV2CandidateCascadeDocumentLexicalState = {
			docId: "doc-han",
			path: "notes/system-proxy.md",
			record: {
				path: "notes/system-proxy.md",
				stableDeterministicKey: "notes/system-proxy.md",
				basenameText: "",
				aliasesText: "",
				headingsText: "",
				folderText: "",
				tagsText: "",
			},
			fieldTerms: {
				bodyTerms: ["系统", "代理", "系统代理"],
			},
			bodyTokenSequence: ["系统", "代理", "系统代理"],
		};

		const bestWindow = buildCoverageLexicalV2CandidateCascadeBestWindowForDocument(
			[
				{
					normalizedText: "系统代理",
					surfaceGroupIndex: 0,
					surfaceKind: "han",
					strongestField: "body",
					matchQuality: "exact",
				},
			],
			document,
		);

		expect(bestWindow).toEqual({
			field: "body",
			matchedUnitKeys: ["0:系统代理"],
			contiguousSurfaceGroupCount: 1,
			windowWidth: 1,
			averageDistance: 0,
			preservesSurfaceOrder: true,
		});
	});

	test("allows prefix witnesses to participate in local token proximity", () => {
		const document: CoverageLexicalV2CandidateCascadeDocumentLexicalState = {
			docId: "doc-prefix",
			path: "notes/cache-reset.md",
			record: {
				path: "notes/cache-reset.md",
				stableDeterministicKey: "notes/cache-reset.md",
				basenameText: "",
				aliasesText: "",
				headingsText: "",
				folderText: "",
				tagsText: "",
			},
			fieldTerms: {
				bodyTerms: ["cache", "cached-reset"],
			},
			bodyTokenSequence: ["cache", "cached-reset"],
		};

		const bestWindow = buildCoverageLexicalV2CandidateCascadeBestWindowForDocument(
			[
				{
					normalizedText: "cache",
					surfaceGroupIndex: 0,
					surfaceKind: "latin",
					strongestField: "body",
					matchQuality: "exact",
				},
				{
					normalizedText: "cached",
					surfaceGroupIndex: 1,
					surfaceKind: "latin",
					strongestField: "body",
					matchQuality: "prefix",
				},
			],
			document,
		);

		expect(bestWindow).toEqual({
			field: "body",
			matchedUnitKeys: ["0:cache", "1:cached"],
			contiguousSurfaceGroupCount: 2,
			windowWidth: 2,
			averageDistance: 1,
			preservesSurfaceOrder: true,
		});
	});
});
