import { estimateTokenCount } from "../chunker";

export const HYBRID_SHARED_SNIPPET_MAX_TOKENS = 130;
export const HYBRID_SHARED_SNIPPET_MIN_BODY_TOKENS = 42;
export const HYBRID_SHARED_SNIPPET_MAX_HEADER_TOKENS = 24;

export function truncateTextToTokenBudget(
	text: string,
	tokenBudget: number,
): string {
	if (!text || tokenBudget <= 0) {
		return "";
	}
	if (estimateTokenCount(text) <= tokenBudget) {
		return text;
	}
	let end = text.length;
	while (end > 0) {
		const candidate = text.slice(0, end).trimEnd();
		if (candidate && estimateTokenCount(candidate) <= tokenBudget) {
			return candidate;
		}
		end -= 1;
	}
	return "";
}
