import {
  buildCoverageLexicalV3HybridLexicalSubitems,
  type CoverageLexicalV3HybridLexicalSubitemsCandidateSpan,
  type CoverageLexicalV3HybridLexicalSubitemsRenderPayload,
} from "src/services/search/coverage-lexical-v3/hybrid-lexical-subitems";
import {
  buildIndexedSnapshotRequestKey,
  FileSnapshotStore,
} from "src/services/search/shared/file-snapshot-store";
import { getInstance } from "src/utils/my-lib";
import {
  buildLineOffsets,
  offsetToLine,
  parseTextHeadingOutline,
} from "../chunker";
import type {
  HybridLexicalLaneBlockCandidate,
  HybridLexicalLaneFileCandidate,
} from "./contracts";

export async function buildHybridLexicalLaneLocalBlockCandidates(params: {
  queryText: string;
  files: readonly HybridLexicalLaneFileCandidate[];
  maxBlocksPerFile: number;
}): Promise<{
  blockCandidates: HybridLexicalLaneBlockCandidate[];
  snapshotTextByPath: Map<string, string>;
}> {
  const snapshotStore = getInstance(FileSnapshotStore);
  const blockCandidates: HybridLexicalLaneBlockCandidate[] = [];
  const snapshotTextByPath = new Map<string, string>();
  const snapshotsByPath = await snapshotStore.readIndexedTextSnapshots(
    params.files.map((file) => ({
      path: file.filePath,
      generation: file.snapshotGeneration,
    })),
  );

  for (const file of params.files) {
    const snapshot = snapshotsByPath.get(
      buildIndexedSnapshotRequestKey({
        path: file.filePath,
        generation: file.snapshotGeneration,
      }),
    );
    if (!snapshot) {
      continue;
    }
    const snapshotText = snapshot.text;
    if (!snapshotText.trim()) {
      continue;
    }
    snapshotTextByPath.set(file.filePath, snapshotText);
    blockCandidates.push(
      ...buildHybridLexicalLaneBlockCandidatesForSnapshot({
        queryText: params.queryText,
        file: {
          ...file,
          snapshotGeneration: snapshot.generation,
          snapshotSource: snapshot.source,
        },
        snapshotText,
        maxBlocksPerFile: params.maxBlocksPerFile,
      }),
    );
  }

  return {
    blockCandidates,
    snapshotTextByPath,
  };
}

export function buildHybridLexicalLaneBlockCandidatesForSnapshot(params: {
  queryText: string;
  file: HybridLexicalLaneFileCandidate;
  snapshotText: string;
  headingOutline?: Array<{ line: number; level: number; title: string }>;
  maxBlocksPerFile: number;
}): HybridLexicalLaneBlockCandidate[] {
  if (!params.snapshotText.trim()) {
    return [];
  }

  const headingOutline =
    params.headingOutline ?? parseTextHeadingOutline(params.snapshotText);
  const headingChainByLine = buildHeadingChainsByLine(
    params.snapshotText.split("\n").length,
    headingOutline,
  );
  const lineOffsets = buildLineOffsets(params.snapshotText);
  const directSubitems = buildCoverageLexicalV3HybridLexicalSubitems({
    queryText: params.queryText,
    filePath: params.file.filePath,
    snapshotText: params.snapshotText,
  });

  return directSubitems.candidateSpans
    .slice(0, Math.max(0, params.maxBlocksPerFile))
    .flatMap((span, index) => {
      const payload = directSubitems.renderPayloads[index];
      return payload
        ? [
            createBlockCandidate({
              file: params.file,
              span,
              payload,
              lineOffsets,
              headingChainByLine,
              snapshotText: params.snapshotText,
              snapshotGeneration: params.file.snapshotGeneration,
              snapshotSource: params.file.snapshotSource,
            }),
          ]
        : [];
    });
}

function createBlockCandidate(params: {
  file: HybridLexicalLaneFileCandidate;
  span: CoverageLexicalV3HybridLexicalSubitemsCandidateSpan;
  payload: CoverageLexicalV3HybridLexicalSubitemsRenderPayload;
  lineOffsets: number[];
  headingChainByLine: string[][];
  snapshotText: string;
  snapshotGeneration?: number;
  snapshotSource?: "live" | "indexed" | "shadow";
}): HybridLexicalLaneBlockCandidate {
  const { file, span, payload, lineOffsets, headingChainByLine, snapshotText } =
    params;
  const startLine = payload.row;
  const endLine = offsetToLine(
    lineOffsets,
    Math.max(span.start, span.end - 1),
  );
  const endLineOffset = lineOffsets[endLine] ?? 0;
  return {
    docRef: file.docRef,
    filePath: file.filePath,
    snapshotGeneration: params.snapshotGeneration,
    snapshotSource: params.snapshotSource,
    blockId: `${file.filePath}#${span.start}-${span.end}`,
    startOffset: span.start,
    endOffset: span.end,
    startLine,
    startCol: payload.col,
    endLine,
    endCol: Math.max(0, span.end - endLineOffset),
    text: snapshotText.slice(span.start, span.end),
    headingChain: [...(headingChainByLine[startLine] ?? [])],
    parentFileScore: file.fileScore,
    parentFileRank: file.fileRank,
    parentMetadataSignals: { ...file.metadataSignals },
    localScore: computeLocalScore(span),
    localSignals: {
      coverageCount: span.score.coverageCount,
      exactCount: span.score.exactCount,
      prefixCount: span.score.prefixCount,
      fuzzyCount: span.score.fuzzyCount,
      queryTermCount: span.termStats.length,
      missCount: span.termStats.filter((termStat) => termStat.bestTier === "miss")
        .length,
      occurrenceCount: span.occurrences.length,
      occurrenceSpread: computeOccurrenceSpread(span),
      distancePenaltyTotal: span.score.distancePenaltyTotal,
      distancePenaltyMax: span.score.distancePenaltyMax,
      spanLength: span.score.spanLength,
      anchorOffset: span.score.anchorOffset,
    },
    termStats: span.termStats.map((termStat) => ({
      termId: termStat.termId,
      bestTier: termStat.bestTier,
      bestDistancePenalty: termStat.bestDistancePenalty,
    })),
    matchOccurrences: span.occurrences.map((occurrence) => ({
      termId: occurrence.termId,
      tier: occurrence.tier,
      start: occurrence.start,
      end: occurrence.end,
      distancePenalty: occurrence.distancePenalty,
    })),
  };
}

function computeLocalScore(
  span: CoverageLexicalV3HybridLexicalSubitemsCandidateSpan,
): number {
  const queryTermCount = Math.max(1, span.termStats.length);
  const missCount = span.termStats.filter((termStat) => termStat.bestTier === "miss")
    .length;
  const coverageRatio = span.score.coverageCount / queryTermCount;
  const occurrenceSpread = computeOccurrenceSpread(span);
  const compactnessBonus = Math.max(
    0,
    180 - Math.min(span.score.spanLength, occurrenceSpread || span.score.spanLength),
  );
  return (
    coverageRatio * 120 +
    span.score.exactCount * 28 +
    span.score.prefixCount * 12 +
    span.score.fuzzyCount * 4 -
    missCount * 18 -
    span.score.distancePenaltyTotal * 0.9 -
    span.score.distancePenaltyMax * 1.4 +
    compactnessBonus * 0.18
  );
}

function computeOccurrenceSpread(
  span: Pick<CoverageLexicalV3HybridLexicalSubitemsCandidateSpan, "occurrences">,
): number {
  if (span.occurrences.length <= 1) {
    return 0;
  }
  const first = span.occurrences[0];
  const last = span.occurrences[span.occurrences.length - 1];
  return Math.max(0, last.end - first.start);
}

function buildHeadingChainsByLine(
  lineCount: number,
  outline: Array<{ line: number; level: number; title: string }>,
): string[][] {
  const chainsByLine: string[][] = new Array(lineCount);
  const stack: Array<{ line: number; level: number; title: string }> = [];
  const sortedOutline = [...outline]
    .filter((entry) => entry.title.trim().length > 0 && entry.line >= 0)
    .sort((left, right) => left.line - right.line || left.level - right.level);
  let outlineIndex = 0;

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    while (
      outlineIndex < sortedOutline.length &&
      sortedOutline[outlineIndex].line === lineIndex
    ) {
      const heading = sortedOutline[outlineIndex];
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }
      stack.push({
        line: heading.line,
        level: heading.level,
        title: heading.title.replace(/\s+/g, " ").trim(),
      });
      outlineIndex += 1;
    }
    chainsByLine[lineIndex] = stack.map((entry) => entry.title);
  }

  return chainsByLine;
}
