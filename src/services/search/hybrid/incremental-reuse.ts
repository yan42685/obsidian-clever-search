export type UnchangedOffsetBlock = {
	oldStartOffset: number;
	oldEndOffset: number;
	newStartOffset: number;
	newEndOffset: number;
};

type LineSpan = {
	startOffset: number;
	endOffset: number;
	text: string;
	hash: string;
};

type AnchorPair = {
	oldIndex: number;
	newIndex: number;
};

type LineBlock = {
	oldStartLine: number;
	oldEndLine: number;
	newStartLine: number;
	newEndLine: number;
};

export function hashStableText(text: string): string {
	let h1 = 0xdeadbeef ^ text.length;
	let h2 = 0x41c6ce57 ^ text.length;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0)
		.toString(16)
		.padStart(8, "0")}`;
}

export function computeUnchangedOffsetBlocks(
	oldText: string,
	newText: string,
): UnchangedOffsetBlock[] {
	if (!oldText || !newText) {
		return [];
	}

	const oldLines = buildLineSpans(oldText);
	const newLines = buildLineSpans(newText);
	if (oldLines.length === 0 || newLines.length === 0) {
		return [];
	}

	const anchorPairs = buildAnchorPairs(oldLines, newLines);
	const anchorBlocks = expandAnchorPairs(oldLines, newLines, anchorPairs);
	const allBlocks = fillGapLineBlocks(oldLines, newLines, anchorBlocks);
	return mergeAdjacentOffsetBlocks(
		allBlocks.map((block) => lineBlockToOffsetBlock(oldLines, newLines, block)),
	);
}

function buildLineSpans(text: string): LineSpan[] {
	const spans: LineSpan[] = [];
	let startOffset = 0;
	for (let index = 0; index < text.length; index++) {
		if (text[index] !== "\n") {
			continue;
		}
		const endOffset = index + 1;
		const lineText = text.slice(startOffset, endOffset);
		spans.push({
			startOffset,
			endOffset,
			text: lineText,
			hash: hashStableText(lineText),
		});
		startOffset = endOffset;
	}

	if (startOffset < text.length) {
		const lineText = text.slice(startOffset);
		spans.push({
			startOffset,
			endOffset: text.length,
			text: lineText,
			hash: hashStableText(lineText),
		});
	}

	return spans;
}

function buildAnchorPairs(oldLines: LineSpan[], newLines: LineSpan[]): AnchorPair[] {
	const oldCountByHash = countByHash(oldLines);
	const newCountByHash = countByHash(newLines);
	const newIndexByHash = new Map<string, number>();
	for (let index = 0; index < newLines.length; index++) {
		const line = newLines[index];
		if ((newCountByHash.get(line.hash) ?? 0) === 1) {
			newIndexByHash.set(line.hash, index);
		}
	}

	const pairs: AnchorPair[] = [];
	for (let index = 0; index < oldLines.length; index++) {
		const line = oldLines[index];
		if ((oldCountByHash.get(line.hash) ?? 0) !== 1) {
			continue;
		}
		const newIndex = newIndexByHash.get(line.hash);
		if (newIndex === undefined) {
			continue;
		}
		if (oldLines[index].text !== newLines[newIndex].text) {
			continue;
		}
		pairs.push({
			oldIndex: index,
			newIndex,
		});
	}

	if (pairs.length <= 1) {
		return pairs;
	}

	return longestIncreasingSubsequenceByNewIndex(pairs);
}

function countByHash(lines: LineSpan[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const line of lines) {
		counts.set(line.hash, (counts.get(line.hash) ?? 0) + 1);
	}
	return counts;
}

function longestIncreasingSubsequenceByNewIndex(
	pairs: AnchorPair[],
): AnchorPair[] {
	const tails: number[] = [];
	const prev = new Array<number>(pairs.length).fill(-1);

	for (let index = 0; index < pairs.length; index++) {
		const value = pairs[index].newIndex;
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (pairs[tails[mid]].newIndex < value) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}
		if (lo > 0) {
			prev[index] = tails[lo - 1];
		}
		if (lo === tails.length) {
			tails.push(index);
		} else {
			tails[lo] = index;
		}
	}

	const result: AnchorPair[] = [];
	let current = tails[tails.length - 1] ?? -1;
	while (current >= 0) {
		result.push(pairs[current]);
		current = prev[current];
	}
	return result.reverse();
}

function expandAnchorPairs(
	oldLines: LineSpan[],
	newLines: LineSpan[],
	pairs: AnchorPair[],
): LineBlock[] {
	const blocks: LineBlock[] = [];
	for (let index = 0; index < pairs.length; index++) {
		const pair = pairs[index];
		const prevBlock = blocks[index - 1];
		const nextPair = pairs[index + 1];
		let oldStartLine = pair.oldIndex;
		let newStartLine = pair.newIndex;
		let oldEndLine = pair.oldIndex + 1;
		let newEndLine = pair.newIndex + 1;

		const minOldStart = prevBlock?.oldEndLine ?? 0;
		const minNewStart = prevBlock?.newEndLine ?? 0;
		while (
			oldStartLine > minOldStart &&
			newStartLine > minNewStart &&
			linesEqual(oldLines[oldStartLine - 1], newLines[newStartLine - 1])
		) {
			oldStartLine -= 1;
			newStartLine -= 1;
		}

		const maxOldEnd = nextPair?.oldIndex ?? oldLines.length;
		const maxNewEnd = nextPair?.newIndex ?? newLines.length;
		while (
			oldEndLine < maxOldEnd &&
			newEndLine < maxNewEnd &&
			linesEqual(oldLines[oldEndLine], newLines[newEndLine])
		) {
			oldEndLine += 1;
			newEndLine += 1;
		}

		blocks.push({
			oldStartLine,
			oldEndLine,
			newStartLine,
			newEndLine,
		});
	}
	return blocks;
}

function fillGapLineBlocks(
	oldLines: LineSpan[],
	newLines: LineSpan[],
	anchorBlocks: LineBlock[],
): LineBlock[] {
	const blocks: LineBlock[] = [];
	let oldCursor = 0;
	let newCursor = 0;

	for (const anchorBlock of anchorBlocks) {
		appendGapBlocks(
			blocks,
			oldLines,
			newLines,
			oldCursor,
			anchorBlock.oldStartLine,
			newCursor,
			anchorBlock.newStartLine,
		);
		blocks.push(anchorBlock);
		oldCursor = anchorBlock.oldEndLine;
		newCursor = anchorBlock.newEndLine;
	}

	appendGapBlocks(
		blocks,
		oldLines,
		newLines,
		oldCursor,
		oldLines.length,
		newCursor,
		newLines.length,
	);

	return mergeAdjacentLineBlocks(
		blocks.filter(
			(block) =>
				block.oldEndLine > block.oldStartLine &&
				block.newEndLine > block.newStartLine,
		),
	);
}

function appendGapBlocks(
	target: LineBlock[],
	oldLines: LineSpan[],
	newLines: LineSpan[],
	oldStart: number,
	oldEnd: number,
	newStart: number,
	newEnd: number,
): void {
	let prefixLength = 0;
	const maxPrefix = Math.min(oldEnd - oldStart, newEnd - newStart);
	while (
		prefixLength < maxPrefix &&
		linesEqual(
			oldLines[oldStart + prefixLength],
			newLines[newStart + prefixLength],
		)
	) {
		prefixLength += 1;
	}
	if (prefixLength > 0) {
		target.push({
			oldStartLine: oldStart,
			oldEndLine: oldStart + prefixLength,
			newStartLine: newStart,
			newEndLine: newStart + prefixLength,
		});
	}

	let suffixLength = 0;
	while (
		oldEnd - suffixLength - 1 >= oldStart + prefixLength &&
		newEnd - suffixLength - 1 >= newStart + prefixLength &&
		linesEqual(
			oldLines[oldEnd - suffixLength - 1],
			newLines[newEnd - suffixLength - 1],
		)
	) {
		suffixLength += 1;
	}
	if (suffixLength > 0) {
		target.push({
			oldStartLine: oldEnd - suffixLength,
			oldEndLine: oldEnd,
			newStartLine: newEnd - suffixLength,
			newEndLine: newEnd,
		});
	}
}

function mergeAdjacentLineBlocks(blocks: LineBlock[]): LineBlock[] {
	if (blocks.length <= 1) {
		return blocks;
	}

	const sorted = [...blocks].sort((left, right) => {
		if (left.oldStartLine !== right.oldStartLine) {
			return left.oldStartLine - right.oldStartLine;
		}
		return left.newStartLine - right.newStartLine;
	});

	const merged: LineBlock[] = [sorted[0]];
	for (let index = 1; index < sorted.length; index++) {
		const current = sorted[index];
		const previous = merged[merged.length - 1];
		if (
			previous.oldEndLine === current.oldStartLine &&
			previous.newEndLine === current.newStartLine
		) {
			previous.oldEndLine = current.oldEndLine;
			previous.newEndLine = current.newEndLine;
			continue;
		}
		merged.push({ ...current });
	}
	return merged;
}

function lineBlockToOffsetBlock(
	oldLines: LineSpan[],
	newLines: LineSpan[],
	block: LineBlock,
): UnchangedOffsetBlock {
	return {
		oldStartOffset: oldLines[block.oldStartLine].startOffset,
		oldEndOffset: oldLines[block.oldEndLine - 1].endOffset,
		newStartOffset: newLines[block.newStartLine].startOffset,
		newEndOffset: newLines[block.newEndLine - 1].endOffset,
	};
}

function mergeAdjacentOffsetBlocks(
	blocks: UnchangedOffsetBlock[],
): UnchangedOffsetBlock[] {
	if (blocks.length <= 1) {
		return blocks;
	}

	const sorted = [...blocks].sort((left, right) => {
		if (left.oldStartOffset !== right.oldStartOffset) {
			return left.oldStartOffset - right.oldStartOffset;
		}
		return left.newStartOffset - right.newStartOffset;
	});

	const merged: UnchangedOffsetBlock[] = [{ ...sorted[0] }];
	for (let index = 1; index < sorted.length; index++) {
		const current = sorted[index];
		const previous = merged[merged.length - 1];
		if (
			previous.oldEndOffset === current.oldStartOffset &&
			previous.newEndOffset === current.newStartOffset
		) {
			previous.oldEndOffset = current.oldEndOffset;
			previous.newEndOffset = current.newEndOffset;
			continue;
		}
		merged.push({ ...current });
	}
	return merged;
}

function linesEqual(left: LineSpan | undefined, right: LineSpan | undefined): boolean {
	return (
		left !== undefined &&
		right !== undefined &&
		left.hash === right.hash &&
		left.text === right.text
	);
}
