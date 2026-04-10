import type {
	CoverageLexicalV2QuerySurfaceGroup,
	CoverageLexicalV2QuerySurfaceShape,
} from "./coverage-lexical-query-unit-types";

export function analyzeCoverageLexicalV2QuerySurfaceShape(
	surfaceGroups: readonly CoverageLexicalV2QuerySurfaceGroup[],
): CoverageLexicalV2QuerySurfaceShape {
	const relevantGroups = surfaceGroups.filter((group) => group.kind !== "other");
	const hanGroupCount = relevantGroups.filter((group) => group.kind === "han" || group.kind === "mixed").length;
	const latinGroupCount = relevantGroups.filter((group) => group.kind === "latin" || group.kind === "mixed").length;
	const requiresCrossScriptCoverage = hanGroupCount > 0 && latinGroupCount > 0;
	const groupCount = relevantGroups.length;
	const requiresMultiGroupCoverage = groupCount > 1;
	const kind: CoverageLexicalV2QuerySurfaceShape["kind"] = requiresCrossScriptCoverage
		? "mixed_script_grouped"
		: requiresMultiGroupCoverage
			? "multi_group"
			: "single_group";
	return {
		kind,
		groupCount,
		requiresMultiGroupCoverage,
		requiresCrossScriptCoverage,
		hanGroupCount,
		latinGroupCount,
	};
}
