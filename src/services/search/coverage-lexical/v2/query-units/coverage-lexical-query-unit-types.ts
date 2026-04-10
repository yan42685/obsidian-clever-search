export type CoverageLexicalV2QueryUnitTier = "primary" | "fallback" | "derived";

export type CoverageLexicalV2QueryUnitSurfaceKind =
	| "latin"
	| "han"
	| "mixed"
	| "other";

export type CoverageLexicalV2QueryUnitSource =
	| "latin_segment"
	| "tokenizer_han_term"
	| "surface_han_segment"
	| "mixed_script_segment"
	| "han_bigram"
	| "derived";

export type CoverageLexicalV2QuerySurfaceGroup = {
	index: number;
	text: string;
	normalizedText: string;
	kind: CoverageLexicalV2QueryUnitSurfaceKind;
};

export type CoverageLexicalV2QueryUnit = {
	text: string;
	normalizedText: string;
	tier: CoverageLexicalV2QueryUnitTier;
	source: CoverageLexicalV2QueryUnitSource;
	surfaceGroupIndex: number;
	surfaceKind: CoverageLexicalV2QueryUnitSurfaceKind;
};

export type CoverageLexicalV2SurfaceShapeKind =
	| "single_group"
	| "multi_group"
	| "mixed_script_grouped";

export type CoverageLexicalV2QuerySurfaceShape = {
	kind: CoverageLexicalV2SurfaceShapeKind;
	groupCount: number;
	requiresMultiGroupCoverage: boolean;
	requiresCrossScriptCoverage: boolean;
	hanGroupCount: number;
	latinGroupCount: number;
};

export type CoverageLexicalV2QueryAnalysis = {
	normalizedQueryText: string;
	surfaceGroups: CoverageLexicalV2QuerySurfaceGroup[];
	surfaceShape: CoverageLexicalV2QuerySurfaceShape;
	primaryUnits: CoverageLexicalV2QueryUnit[];
	fallbackUnits: CoverageLexicalV2QueryUnit[];
	derivedUnits: CoverageLexicalV2QueryUnit[];
	hasMixedScriptGroups: boolean;
	hasHanGroups: boolean;
	hasLatinGroups: boolean;
};
