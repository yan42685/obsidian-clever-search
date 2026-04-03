import {
	createChunkContextBuilderFromOutline,
	estimateTokenCount,
	parseTextHeadingOutline,
} from "../chunker";
import { FileUtil } from "src/utils/file-util";
import {
	HYBRID_SHARED_SNIPPET_MAX_HEADER_TOKENS,
	truncateTextToTokenBudget,
} from "./token-budget";

const FILE_PREFIX = "File: ";
const SECTION_PREFIX = "Section: ";

export function buildHybridSharedSnippetHeader(params: {
	filePath: string;
	snapshotText: string;
	startLine: number;
}): string {
	const headingOutline = parseTextHeadingOutline(params.snapshotText);
	const buildContext = createChunkContextBuilderFromOutline(
		params.filePath,
		params.snapshotText.split("\n").length,
		headingOutline,
	);
	const basename = FileUtil.getBasename(params.filePath);
	const fileLine = `${FILE_PREFIX}${basename}`;
	const sectionValue = extractSectionValue(buildContext(params.startLine));
	if (!sectionValue) {
		return fileLine;
	}
	const fullHeader = `${fileLine}\n${SECTION_PREFIX}${sectionValue}`;
	if (estimateTokenCount(fullHeader) <= HYBRID_SHARED_SNIPPET_MAX_HEADER_TOKENS) {
		return fullHeader;
	}
	const compactSection = compactSectionValue(fileLine, sectionValue);
	return compactSection ? `${fileLine}\n${SECTION_PREFIX}${compactSection}` : fileLine;
}

function extractSectionValue(rawContext: string): string {
	return (
		rawContext
			.split("\n")
			.find((line) => line.startsWith(SECTION_PREFIX))
			?.slice(SECTION_PREFIX.length)
			.trim() ?? ""
	);
}

function compactSectionValue(fileLine: string, sectionValue: string): string {
	const sectionParts = sectionValue
		.split(" > ")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (sectionParts.length === 0) {
		return "";
	}

	let selected: string[] = [];
	for (let index = sectionParts.length - 1; index >= 0; index--) {
		const next = [sectionParts[index], ...selected];
		if (fitsHeaderBudget(fileLine, next.join(" > "))) {
			selected = next;
		}
	}
	if (selected.length > 0) {
		return selected.join(" > ");
	}

	const remainingBudget =
		HYBRID_SHARED_SNIPPET_MAX_HEADER_TOKENS -
		estimateTokenCount(`${fileLine}\n${SECTION_PREFIX}`);
	return truncateTextToTokenBudget(
		sectionParts[sectionParts.length - 1],
		remainingBudget,
	);
}

function fitsHeaderBudget(fileLine: string, sectionValue: string): boolean {
	return (
		estimateTokenCount(`${fileLine}\n${SECTION_PREFIX}${sectionValue}`) <=
		HYBRID_SHARED_SNIPPET_MAX_HEADER_TOKENS
	);
}
