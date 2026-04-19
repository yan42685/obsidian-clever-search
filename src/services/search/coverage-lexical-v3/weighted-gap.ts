export type WeightedGapIndex = Readonly<{
	textLength: number;
	prefixSums: readonly number[];
}>;

export type WeightedGapSegment = Readonly<{
	start: number;
	text: string;
}>;

const HAN_GAP_WEIGHT = 0.65;
const OTHER_GAP_WEIGHT = 0.25;
const HAN_CHAR_PATTERN = /\p{Script=Han}/u;

export function buildWeightedGapIndex(text: string): WeightedGapIndex {
	return buildWeightedGapIndexFromSegments(text.length, [{ start: 0, text }]);
}

export function buildWeightedGapIndexFromSegments(
	textLength: number,
	segments: readonly WeightedGapSegment[],
): WeightedGapIndex {
	const normalizedLength = Math.max(0, textLength);
	if (normalizedLength === 0) {
		return {
			textLength: 0,
			prefixSums: [0],
		};
	}
	const weights = Array.from({ length: normalizedLength }, () => OTHER_GAP_WEIGHT);
	for (const segment of segments) {
		applySegmentWeights(weights, normalizedLength, segment);
	}
	const prefixSums = new Array<number>(normalizedLength + 1).fill(0);
	for (let index = 0; index < normalizedLength; index += 1) {
		prefixSums[index + 1] = prefixSums[index] + (weights[index] ?? OTHER_GAP_WEIGHT);
	}
	return {
		textLength: normalizedLength,
		prefixSums,
	};
}

export function computeWeightedGap(
	index: WeightedGapIndex,
	start: number,
	end: number,
): number {
	const safeStart = clampOffset(Math.min(start, end), index.textLength);
	const safeEnd = clampOffset(Math.max(start, end), index.textLength);
	if (safeEnd <= safeStart) {
		return 0;
	}
	return (index.prefixSums[safeEnd] ?? 0) - (index.prefixSums[safeStart] ?? 0);
}

export function computeWeightedBoundaryGap(
	index: WeightedGapIndex,
	leftStart: number,
	leftEnd: number,
	rightStart: number,
	rightEnd: number,
): number {
	if (leftEnd <= rightStart) {
		return computeWeightedGap(index, leftEnd, rightStart);
	}
	if (rightEnd <= leftStart) {
		return computeWeightedGap(index, rightEnd, leftStart);
	}
	return 0;
}

export function computeWeightedAdjacentBoundaryGap(
	leftIndex: WeightedGapIndex,
	leftStart: number,
	leftEnd: number,
	rightIndex: WeightedGapIndex,
	rightStart: number,
	rightEnd: number,
): number {
	return (
		computeWeightedGap(leftIndex, leftEnd, leftIndex.textLength) +
		computeWeightedGap(rightIndex, 0, rightStart)
	);
}

function applySegmentWeights(
	weights: number[],
	textLength: number,
	segment: WeightedGapSegment,
): void {
	if (segment.text.length === 0) {
		return;
	}
	let localOffset = 0;
	while (localOffset < segment.text.length) {
		const codePoint = segment.text.codePointAt(localOffset);
		if (codePoint == null) {
			break;
		}
		const char = String.fromCodePoint(codePoint);
		const start = segment.start + localOffset;
		const end = Math.min(textLength, start + char.length);
		const weight = HAN_CHAR_PATTERN.test(char) ? HAN_GAP_WEIGHT : OTHER_GAP_WEIGHT;
		for (let index = Math.max(0, start); index < end; index += 1) {
			weights[index] = weight;
		}
		localOffset += char.length;
	}
}

function clampOffset(offset: number, textLength: number): number {
	if (offset <= 0) {
		return 0;
	}
	if (offset >= textLength) {
		return textLength;
	}
	return offset;
}
