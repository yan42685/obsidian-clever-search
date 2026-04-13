import type { IndexedDocument } from "src/globals/search-types";
import {
	extractHanBigrams,
	extractHanSegments,
} from "src/services/search/coverage-lexical/coverage-lexical-cjk";

export type CoverageLexicalV2AdaptiveHanBigramDocPostingEstimate = {
	rawMarkdownBytes: number;
	hanOnlyUtf8Bytes: number;
	hanDocumentCount: number;
	hanLogicalBlockCount: number;
	uniqueBigramCount: number;
	docBigramIncidenceCount: number;
	blockBigramIncidenceCount: number;
	docFrequencyHistogram: {
		df1: number;
		df2: number;
		df3: number;
		df4to8: number;
		df9plus: number;
	};
	optimisticPackedBytes: number;
	optimisticPackedVsHanRaw: number | null;
	optimisticPackedVsRawMarkdown: number | null;
	ultraOptimisticPackedBytes: number;
	ultraOptimisticPackedVsHanRaw: number | null;
	ultraOptimisticPackedVsRawMarkdown: number | null;
	denseBigramIdBytes: number;
	hanDocOrdinalBytes: number;
	denseBigramOptimisticPackedBytes: number;
	denseBigramOptimisticPackedVsHanRaw: number | null;
	denseBigramOptimisticPackedVsRawMarkdown: number | null;
	denseBigramHanDocOrdinalPackedBytes: number;
	denseBigramHanDocOrdinalPackedVsHanRaw: number | null;
	denseBigramHanDocOrdinalPackedVsRawMarkdown: number | null;
	denseBigramDictionaryLowerBoundBytes: number;
	denseBigramHanDocOrdinalWithDictionaryLowerBoundBytes: number;
	denseBigramHanDocOrdinalWithDictionaryLowerBoundVsHanRaw: number | null;
	denseBigramHanDocOrdinalWithDictionaryLowerBoundVsRawMarkdown: number | null;
	maxBlocksPerHanDocument: number;
	blockIdBytes: number;
	blockOrdinalBytes: number;
	blockDescriptorSearchCoreBytes: number;
	blockDescriptorOperationalBytes: number;
	denseBigramBlockPostingBytes: number;
	denseBigramBlockPostingVsHanRaw: number | null;
	denseBigramBlockPostingVsRawMarkdown: number | null;
	denseBigramBlockPostingWithDictionaryLowerBoundBytes: number;
	denseBigramBlockPostingWithDictionaryLowerBoundVsHanRaw: number | null;
	denseBigramBlockPostingWithDictionaryLowerBoundVsRawMarkdown: number | null;
	blockQueryViewWithSearchCoreBytes: number;
	blockQueryViewWithSearchCoreVsHanRaw: number | null;
	blockQueryViewWithSearchCoreVsRawMarkdown: number | null;
	blockQueryViewWithOperationalDescriptorBytes: number;
	blockQueryViewWithOperationalDescriptorVsHanRaw: number | null;
	blockQueryViewWithOperationalDescriptorVsRawMarkdown: number | null;
	docAdaptiveCodec: CoverageLexicalV2AdaptivePostingCodecEstimate;
	docAdaptiveCodecWithDictionaryLowerBoundBytes: number;
	docAdaptiveCodecWithDictionaryLowerBoundVsHanRaw: number | null;
	docAdaptiveCodecWithDictionaryLowerBoundVsRawMarkdown: number | null;
	blockAdaptiveCodec: CoverageLexicalV2AdaptivePostingCodecEstimate;
	blockAdaptiveCodecWithDictionaryLowerBoundBytes: number;
	blockAdaptiveCodecWithDictionaryLowerBoundVsHanRaw: number | null;
	blockAdaptiveCodecWithDictionaryLowerBoundVsRawMarkdown: number | null;
	exactFanout: CoverageLexicalV2AdaptiveHanBigramExactFanoutEstimate;
	blockSizeSweep: readonly CoverageLexicalV2AdaptiveHanLogicalBlockSweepRow[];
};

export type CoverageLexicalV2AdaptivePostingCodecEstimate = {
	smallInlineCap: number;
	termIdBytes: number;
	valueIdBytes: number;
	totalBytes: number;
	singletonCount: number;
	singletonBytes: number;
	pairCount: number;
	pairBytes: number;
	smallCount: number;
	smallBytes: number;
	deltaCount: number;
	deltaBytes: number;
};

export type CoverageLexicalV2AdaptiveHanLogicalBlockSweepRow = {
	label: string;
	targetSymbols: number;
	targetEncodedBytes: number;
	hanLogicalBlockCount: number;
	maxBlocksPerHanDocument: number;
	blockIdBytes: number;
	blockOrdinalBytes: number;
	blockAdaptiveCodecTotalBytes: number;
	blockAdaptiveCodecWithDictionaryLowerBoundBytes: number;
	blockQueryViewWithSearchCoreBytes: number;
	blockQueryViewWithOperationalDescriptorBytes: number;
	directBlockCandidateCountAvg: number;
	directBlockCandidateCountP90: number;
	directBlockByteCountAvg: number;
	directBlockByteCountP90: number;
	docRouteFanoutBlockCountAvg: number;
	docRouteFanoutBlockCountP90: number;
	docRouteVsBlockRouteByteRatioAvg: number;
	docRouteVsBlockRouteByteRatioP90: number;
	queryViewBytesVsCurrent: number | null;
	directExactBytesVsCurrent: number | null;
	heuristicBalanceScoreVsCurrent: number | null;
};

export type CoverageLexicalV2AdaptiveHanBigramExactFanoutEstimate = {
	queryCount: number;
	oneBigramQueryCount: number;
	twoBigramQueryCount: number;
	threePlusBigramQueryCount: number;
	docCandidateCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	docRouteFanoutBlockCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	directBlockCandidateCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	docRouteFanoutByteCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	directBlockByteCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	docRouteVsBlockRouteBlockRatio: CoverageLexicalV2AdaptiveHanBigramDistribution;
	docRouteVsBlockRouteByteRatio: CoverageLexicalV2AdaptiveHanBigramDistribution;
	byBucket: {
		oneBigram: CoverageLexicalV2AdaptiveHanBigramExactFanoutBucket;
		twoBigram: CoverageLexicalV2AdaptiveHanBigramExactFanoutBucket;
		threePlusBigram: CoverageLexicalV2AdaptiveHanBigramExactFanoutBucket;
	};
};

type CoverageLexicalV2AdaptiveHanBigramExactFanoutBucket = {
	queryCount: number;
	docCandidateCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	docRouteFanoutBlockCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	directBlockCandidateCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	docRouteFanoutByteCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	directBlockByteCount: CoverageLexicalV2AdaptiveHanBigramDistribution;
	docRouteVsBlockRouteBlockRatio: CoverageLexicalV2AdaptiveHanBigramDistribution;
	docRouteVsBlockRouteByteRatio: CoverageLexicalV2AdaptiveHanBigramDistribution;
};

type CoverageLexicalV2AdaptiveHanBigramDistribution = {
	avg: number;
	p50: number;
	p90: number;
	p95: number;
	max: number;
};

const UTF8_BYTE_ENCODER = new TextEncoder();

type ApproximateHanLogicalBlockConfig = {
	label: string;
	targetSymbols: number;
	targetEncodedBytes: number;
};

type PreparedHanSegment = {
	symbolCount: number;
	encodedByteLength: number;
	bigramIds: readonly number[];
};

type PreparedHanDocument = {
	hanDocOrdinal: number | null;
	preparedSegments: readonly PreparedHanSegment[];
	docBigramIds: readonly number[];
};

const DEFAULT_APPROXIMATE_HAN_LOGICAL_BLOCK_CONFIG: ApproximateHanLogicalBlockConfig = {
	label: "1x",
	targetSymbols: 384,
	targetEncodedBytes: 1536,
};

const APPROXIMATE_HAN_LOGICAL_BLOCK_SWEEP_CONFIGS: readonly ApproximateHanLogicalBlockConfig[] = [
	{ label: "0.5x", targetSymbols: 192, targetEncodedBytes: 768 },
	{ label: "0.75x", targetSymbols: 288, targetEncodedBytes: 1152 },
	DEFAULT_APPROXIMATE_HAN_LOGICAL_BLOCK_CONFIG,
	{ label: "1.5x", targetSymbols: 576, targetEncodedBytes: 2304 },
	{ label: "2x", targetSymbols: 768, targetEncodedBytes: 3072 },
	{ label: "3x", targetSymbols: 1152, targetEncodedBytes: 4608 },
	{ label: "4x", targetSymbols: 1536, targetEncodedBytes: 6144 },
	{ label: "5x", targetSymbols: 1920, targetEncodedBytes: 7680 },
];

export function estimateCoverageLexicalV2AdaptiveHanBigramDocPostingBytes(
	documents: readonly IndexedDocument[],
): CoverageLexicalV2AdaptiveHanBigramDocPostingEstimate {
	const bigramDocFrequency = new Map<number, number>();
	const bigramDocOrdinals = new Map<number, number[]>();
	const queryBigramIdsBySignature = new Map<string, readonly number[]>();
	const preparedDocuments: PreparedHanDocument[] = [];
	let hanOnlyUtf8Bytes = 0;
	let hanDocumentCount = 0;
	let rawMarkdownBytes = 0;

	for (const document of documents) {
		const content = document.content ?? "";
		rawMarkdownBytes += measureUtf8Bytes(content);
		const segments = extractHanSegments(content);
		let hanDocOrdinal: number | null = null;
		if (segments.length > 0) {
			hanDocOrdinal = hanDocumentCount;
			hanDocumentCount += 1;
		}
		hanOnlyUtf8Bytes += measureUtf8Bytes(segments.join(""));
		const preparedSegments = segments
			.map((segment) => prepareHanSegment(segment))
			.filter((segment): segment is PreparedHanSegment => segment !== null);
		const bigramIds = new Set<number>();
		for (const preparedSegment of preparedSegments) {
			if (preparedSegment.bigramIds.length > 0) {
				queryBigramIdsBySignature.set(
					preparedSegment.bigramIds.join(","),
					preparedSegment.bigramIds,
				);
			}
			for (const bigramId of preparedSegment.bigramIds) {
				bigramIds.add(bigramId);
			}
		}
		const docBigramIds = [...bigramIds].sort((left, right) => left - right);
		preparedDocuments.push({
			hanDocOrdinal,
			preparedSegments,
			docBigramIds,
		});
		for (const bigramId of bigramIds) {
			bigramDocFrequency.set(
				bigramId,
				(bigramDocFrequency.get(bigramId) ?? 0) + 1,
			);
			if (hanDocOrdinal !== null) {
				pushMapNumber(bigramDocOrdinals, bigramId, hanDocOrdinal);
			}
		}
	}

	const histogram = {
		df1: 0,
		df2: 0,
		df3: 0,
		df4to8: 0,
		df9plus: 0,
	};
	let docBigramIncidenceCount = 0;
	let optimisticPackedBytes = 0;
	let ultraOptimisticPackedBytes = 0;

	for (const docFrequency of bigramDocFrequency.values()) {
		docBigramIncidenceCount += docFrequency;
		if (docFrequency === 1) {
			histogram.df1 += 1;
			optimisticPackedBytes += 4 + 2;
			ultraOptimisticPackedBytes += 4 + 1;
			continue;
		}
		if (docFrequency === 2) {
			histogram.df2 += 1;
			optimisticPackedBytes += 4 + 4;
			ultraOptimisticPackedBytes += 4 + 2;
			continue;
		}
		if (docFrequency === 3) {
			histogram.df3 += 1;
		} else if (docFrequency <= 8) {
			histogram.df4to8 += 1;
		} else {
			histogram.df9plus += 1;
		}
		optimisticPackedBytes += 8 + 2 * docFrequency;
		ultraOptimisticPackedBytes += 6 + docFrequency;
	}
	const denseBigramIdBytes = bigramDocFrequency.size <= 0xffff ? 2 : 4;
	const hanDocOrdinalBytes = hanDocumentCount <= 0xff ? 1 : hanDocumentCount <= 0xffff ? 2 : 4;
	let denseBigramOptimisticPackedBytes = 0;
	let denseBigramHanDocOrdinalPackedBytes = 0;

	for (const docFrequency of bigramDocFrequency.values()) {
		if (docFrequency === 1) {
			denseBigramOptimisticPackedBytes += denseBigramIdBytes + 2;
			denseBigramHanDocOrdinalPackedBytes +=
				denseBigramIdBytes + hanDocOrdinalBytes;
			continue;
		}
		if (docFrequency === 2) {
			denseBigramOptimisticPackedBytes += denseBigramIdBytes + 4;
			denseBigramHanDocOrdinalPackedBytes +=
				denseBigramIdBytes + 2 * hanDocOrdinalBytes;
			continue;
		}
		denseBigramOptimisticPackedBytes += denseBigramIdBytes + 4 + 2 * docFrequency;
		denseBigramHanDocOrdinalPackedBytes +=
			denseBigramIdBytes + 2 + docFrequency * hanDocOrdinalBytes;
	}

	const denseBigramDictionaryLowerBoundBytes = bigramDocFrequency.size * 4;
	const denseBigramHanDocOrdinalWithDictionaryLowerBoundBytes =
		denseBigramHanDocOrdinalPackedBytes + denseBigramDictionaryLowerBoundBytes;
	const docAdaptiveCodec = estimateAdaptivePostingCodec(
		[...bigramDocOrdinals.values()],
		denseBigramIdBytes,
		hanDocOrdinalBytes,
	);
	const docAdaptiveCodecWithDictionaryLowerBoundBytes =
		docAdaptiveCodec.totalBytes + denseBigramDictionaryLowerBoundBytes;
	const currentBlockAnalysis = analyzeApproximateHanLogicalBlocksForEstimate({
		preparedDocuments,
		queryBigramIdsBySignature,
		bigramDocOrdinals,
		denseBigramIdBytes,
		hanDocOrdinalBytes,
		denseBigramDictionaryLowerBoundBytes,
		config: DEFAULT_APPROXIMATE_HAN_LOGICAL_BLOCK_CONFIG,
	});
	const blockSizeSweepBase = APPROXIMATE_HAN_LOGICAL_BLOCK_SWEEP_CONFIGS.map((config) =>
		analyzeApproximateHanLogicalBlocksForEstimate({
			preparedDocuments,
			queryBigramIdsBySignature,
			bigramDocOrdinals,
			denseBigramIdBytes,
			hanDocOrdinalBytes,
			denseBigramDictionaryLowerBoundBytes,
			config,
		}),
	);
	const currentSweepRow =
		blockSizeSweepBase.find(
			(row) =>
				row.label === DEFAULT_APPROXIMATE_HAN_LOGICAL_BLOCK_CONFIG.label &&
				row.targetSymbols ===
					DEFAULT_APPROXIMATE_HAN_LOGICAL_BLOCK_CONFIG.targetSymbols &&
				row.targetEncodedBytes ===
					DEFAULT_APPROXIMATE_HAN_LOGICAL_BLOCK_CONFIG.targetEncodedBytes,
		) ?? null;
	const blockSizeSweep = blockSizeSweepBase.map((row) => {
		const queryViewBytesVsCurrent =
			currentSweepRow != null && currentSweepRow.blockQueryViewWithSearchCoreBytes > 0
				? round(
						row.blockQueryViewWithSearchCoreBytes /
							currentSweepRow.blockQueryViewWithSearchCoreBytes,
				  )
				: null;
		const directExactBytesVsCurrent =
			currentSweepRow != null && currentSweepRow.exactFanout.directBlockByteCount.avg > 0
				? round(
						row.exactFanout.directBlockByteCount.avg /
							currentSweepRow.exactFanout.directBlockByteCount.avg,
				  )
				: null;
		return {
			label: row.label,
			targetSymbols: row.targetSymbols,
			targetEncodedBytes: row.targetEncodedBytes,
			hanLogicalBlockCount: row.hanLogicalBlockCount,
			maxBlocksPerHanDocument: row.maxBlocksPerHanDocument,
			blockIdBytes: row.blockIdBytes,
			blockOrdinalBytes: row.blockOrdinalBytes,
			blockAdaptiveCodecTotalBytes: row.blockAdaptiveCodec.totalBytes,
			blockAdaptiveCodecWithDictionaryLowerBoundBytes:
				row.blockAdaptiveCodecWithDictionaryLowerBoundBytes,
			blockQueryViewWithSearchCoreBytes: row.blockQueryViewWithSearchCoreBytes,
			blockQueryViewWithOperationalDescriptorBytes:
				row.blockQueryViewWithOperationalDescriptorBytes,
			directBlockCandidateCountAvg: row.exactFanout.directBlockCandidateCount.avg,
			directBlockCandidateCountP90: row.exactFanout.directBlockCandidateCount.p90,
			directBlockByteCountAvg: row.exactFanout.directBlockByteCount.avg,
			directBlockByteCountP90: row.exactFanout.directBlockByteCount.p90,
			docRouteFanoutBlockCountAvg: row.exactFanout.docRouteFanoutBlockCount.avg,
			docRouteFanoutBlockCountP90: row.exactFanout.docRouteFanoutBlockCount.p90,
			docRouteVsBlockRouteByteRatioAvg:
				row.exactFanout.docRouteVsBlockRouteByteRatio.avg,
			docRouteVsBlockRouteByteRatioP90:
				row.exactFanout.docRouteVsBlockRouteByteRatio.p90,
			queryViewBytesVsCurrent,
			directExactBytesVsCurrent,
			heuristicBalanceScoreVsCurrent:
				queryViewBytesVsCurrent != null && directExactBytesVsCurrent != null
					? round(queryViewBytesVsCurrent * directExactBytesVsCurrent)
					: null,
		};
	});

	return {
		rawMarkdownBytes,
		hanOnlyUtf8Bytes,
		hanDocumentCount,
		hanLogicalBlockCount: currentBlockAnalysis.hanLogicalBlockCount,
		uniqueBigramCount: bigramDocFrequency.size,
		docBigramIncidenceCount,
		blockBigramIncidenceCount: currentBlockAnalysis.blockBigramIncidenceCount,
		docFrequencyHistogram: histogram,
		optimisticPackedBytes,
		optimisticPackedVsHanRaw:
			hanOnlyUtf8Bytes > 0 ? round(optimisticPackedBytes / hanOnlyUtf8Bytes) : null,
		optimisticPackedVsRawMarkdown:
			rawMarkdownBytes > 0 ? round(optimisticPackedBytes / rawMarkdownBytes) : null,
		ultraOptimisticPackedBytes,
		ultraOptimisticPackedVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(ultraOptimisticPackedBytes / hanOnlyUtf8Bytes)
				: null,
		ultraOptimisticPackedVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(ultraOptimisticPackedBytes / rawMarkdownBytes)
				: null,
		denseBigramIdBytes,
		hanDocOrdinalBytes,
		denseBigramOptimisticPackedBytes,
		denseBigramOptimisticPackedVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(denseBigramOptimisticPackedBytes / hanOnlyUtf8Bytes)
				: null,
		denseBigramOptimisticPackedVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(denseBigramOptimisticPackedBytes / rawMarkdownBytes)
				: null,
		denseBigramHanDocOrdinalPackedBytes,
		denseBigramHanDocOrdinalPackedVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(denseBigramHanDocOrdinalPackedBytes / hanOnlyUtf8Bytes)
				: null,
		denseBigramHanDocOrdinalPackedVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(denseBigramHanDocOrdinalPackedBytes / rawMarkdownBytes)
				: null,
		denseBigramDictionaryLowerBoundBytes,
		denseBigramHanDocOrdinalWithDictionaryLowerBoundBytes,
		denseBigramHanDocOrdinalWithDictionaryLowerBoundVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(
						denseBigramHanDocOrdinalWithDictionaryLowerBoundBytes /
							hanOnlyUtf8Bytes,
				  )
				: null,
		denseBigramHanDocOrdinalWithDictionaryLowerBoundVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(
						denseBigramHanDocOrdinalWithDictionaryLowerBoundBytes /
							rawMarkdownBytes,
				  )
				: null,
		maxBlocksPerHanDocument: currentBlockAnalysis.maxBlocksPerHanDocument,
		blockIdBytes: currentBlockAnalysis.blockIdBytes,
		blockOrdinalBytes: currentBlockAnalysis.blockOrdinalBytes,
		blockDescriptorSearchCoreBytes: currentBlockAnalysis.blockDescriptorSearchCoreBytes,
		blockDescriptorOperationalBytes:
			currentBlockAnalysis.blockDescriptorOperationalBytes,
		denseBigramBlockPostingBytes: currentBlockAnalysis.denseBigramBlockPostingBytes,
		denseBigramBlockPostingVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(
						currentBlockAnalysis.denseBigramBlockPostingBytes / hanOnlyUtf8Bytes,
				  )
				: null,
		denseBigramBlockPostingVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(
						currentBlockAnalysis.denseBigramBlockPostingBytes / rawMarkdownBytes,
				  )
				: null,
		denseBigramBlockPostingWithDictionaryLowerBoundBytes:
			currentBlockAnalysis.denseBigramBlockPostingWithDictionaryLowerBoundBytes,
		denseBigramBlockPostingWithDictionaryLowerBoundVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(
						currentBlockAnalysis.denseBigramBlockPostingWithDictionaryLowerBoundBytes /
							hanOnlyUtf8Bytes,
				  )
				: null,
		denseBigramBlockPostingWithDictionaryLowerBoundVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(
						currentBlockAnalysis.denseBigramBlockPostingWithDictionaryLowerBoundBytes /
							rawMarkdownBytes,
				  )
				: null,
		blockQueryViewWithSearchCoreBytes:
			currentBlockAnalysis.blockQueryViewWithSearchCoreBytes,
		blockQueryViewWithSearchCoreVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(
						currentBlockAnalysis.blockQueryViewWithSearchCoreBytes /
							hanOnlyUtf8Bytes,
				  )
				: null,
		blockQueryViewWithSearchCoreVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(
						currentBlockAnalysis.blockQueryViewWithSearchCoreBytes /
							rawMarkdownBytes,
				  )
				: null,
		blockQueryViewWithOperationalDescriptorBytes:
			currentBlockAnalysis.blockQueryViewWithOperationalDescriptorBytes,
		blockQueryViewWithOperationalDescriptorVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(
						currentBlockAnalysis.blockQueryViewWithOperationalDescriptorBytes /
							hanOnlyUtf8Bytes,
				  )
				: null,
		blockQueryViewWithOperationalDescriptorVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(
						currentBlockAnalysis.blockQueryViewWithOperationalDescriptorBytes /
							rawMarkdownBytes,
				  )
				: null,
		docAdaptiveCodec,
		docAdaptiveCodecWithDictionaryLowerBoundBytes,
		docAdaptiveCodecWithDictionaryLowerBoundVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(
						docAdaptiveCodecWithDictionaryLowerBoundBytes / hanOnlyUtf8Bytes,
				  )
				: null,
		docAdaptiveCodecWithDictionaryLowerBoundVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(
						docAdaptiveCodecWithDictionaryLowerBoundBytes / rawMarkdownBytes,
				  )
				: null,
		blockAdaptiveCodec: currentBlockAnalysis.blockAdaptiveCodec,
		blockAdaptiveCodecWithDictionaryLowerBoundBytes:
			currentBlockAnalysis.blockAdaptiveCodecWithDictionaryLowerBoundBytes,
		blockAdaptiveCodecWithDictionaryLowerBoundVsHanRaw:
			hanOnlyUtf8Bytes > 0
				? round(
						currentBlockAnalysis.blockAdaptiveCodecWithDictionaryLowerBoundBytes /
							hanOnlyUtf8Bytes,
				  )
				: null,
		blockAdaptiveCodecWithDictionaryLowerBoundVsRawMarkdown:
			rawMarkdownBytes > 0
				? round(
						currentBlockAnalysis.blockAdaptiveCodecWithDictionaryLowerBoundBytes /
							rawMarkdownBytes,
				  )
				: null,
		exactFanout: currentBlockAnalysis.exactFanout,
		blockSizeSweep,
	};
}

function encodeCoverageLexicalV2HanBigramIdForEstimate(
	bigram: string,
): number | null {
	const chars = Array.from(bigram);
	if (chars.length !== 2) {
		return null;
	}
	const leftCodePoint = chars[0]?.codePointAt(0);
	const rightCodePoint = chars[1]?.codePointAt(0);
	if (leftCodePoint === undefined || rightCodePoint === undefined) {
		return null;
	}
	let hash = 2166136261;
	hash = Math.imul(hash ^ leftCodePoint, 16777619);
	hash = Math.imul(hash ^ rightCodePoint, 16777619);
	return hash >>> 0;
}

function round(value: number): number {
	return Number(value.toFixed(3));
}

function measureUtf8Bytes(text: string): number {
	return UTF8_BYTE_ENCODER.encode(text).byteLength;
}

type ApproximateHanLogicalBlock = {
	bigramIds: readonly number[];
	encodedByteLength: number;
};

function buildApproximateHanLogicalBlocks(
	preparedSegments: readonly PreparedHanSegment[],
	config: ApproximateHanLogicalBlockConfig,
): readonly ApproximateHanLogicalBlock[] {
	if (preparedSegments.length === 0) {
		return [];
	}
	const logicalBlocks: ApproximateHanLogicalBlock[] = [];
	let pendingSegments: PreparedHanSegment[] = [];
	let pendingSymbolCount = 0;
	let pendingEncodedByteLength = 0;

	const flushPending = () => {
		if (pendingSegments.length === 0) {
			return;
		}
		logicalBlocks.push({
			bigramIds: Array.from(
				new Set(
					pendingSegments.flatMap((pendingSegment) => pendingSegment.bigramIds),
				),
			).sort((left, right) => left - right),
			encodedByteLength: pendingEncodedByteLength,
		});
		pendingSegments = [];
		pendingSymbolCount = 0;
		pendingEncodedByteLength = 0;
	};

	for (const preparedSegment of preparedSegments) {
		const shouldOwnBlock =
			preparedSegment.symbolCount >= config.targetSymbols ||
			preparedSegment.encodedByteLength >= config.targetEncodedBytes;
		const wouldOverflow =
			pendingSegments.length > 0 &&
			(
				pendingSymbolCount + preparedSegment.symbolCount > config.targetSymbols ||
				pendingEncodedByteLength + preparedSegment.encodedByteLength >
					config.targetEncodedBytes
			);
		if (shouldOwnBlock) {
			flushPending();
			pendingSegments = [preparedSegment];
			pendingSymbolCount = preparedSegment.symbolCount;
			pendingEncodedByteLength = preparedSegment.encodedByteLength;
			flushPending();
			continue;
		}
		if (wouldOverflow) {
			flushPending();
		}
		pendingSegments.push(preparedSegment);
		pendingSymbolCount += preparedSegment.symbolCount;
		pendingEncodedByteLength += preparedSegment.encodedByteLength;
	}
	flushPending();

	return logicalBlocks;
}

function prepareHanSegment(segment: string): PreparedHanSegment | null {
	const symbolCount = Array.from(segment).length;
	if (symbolCount === 0) {
		return null;
	}
	return {
		symbolCount,
		encodedByteLength: measureUtf8Bytes(segment),
		bigramIds: collectApproximateHanSegmentBigramIds(segment),
	};
}

function collectApproximateHanSegmentBigramIds(segment: string): readonly number[] {
	const bigramIds: number[] = [];
	const seen = new Set<number>();
	for (const bigram of extractHanBigrams(segment)) {
		const bigramId = encodeCoverageLexicalV2HanBigramIdForEstimate(bigram);
		if (bigramId == null || seen.has(bigramId)) {
			continue;
		}
		seen.add(bigramId);
		bigramIds.push(bigramId);
	}
	return bigramIds.sort((left, right) => left - right);
}

function pushMapNumber(map: Map<number, number[]>, key: number, value: number): void {
	const values = map.get(key);
	if (values) {
		values.push(value);
		return;
	}
	map.set(key, [value]);
}

function analyzeApproximateHanLogicalBlocksForEstimate(options: {
	preparedDocuments: readonly PreparedHanDocument[];
	queryBigramIdsBySignature: ReadonlyMap<string, readonly number[]>;
	bigramDocOrdinals: ReadonlyMap<number, readonly number[]>;
	denseBigramIdBytes: number;
	hanDocOrdinalBytes: number;
	denseBigramDictionaryLowerBoundBytes: number;
	config: ApproximateHanLogicalBlockConfig;
}): {
	label: string;
	targetSymbols: number;
	targetEncodedBytes: number;
	hanLogicalBlockCount: number;
	blockBigramIncidenceCount: number;
	maxBlocksPerHanDocument: number;
	blockIdBytes: number;
	blockOrdinalBytes: number;
	blockDescriptorSearchCoreBytes: number;
	blockDescriptorOperationalBytes: number;
	denseBigramBlockPostingBytes: number;
	denseBigramBlockPostingWithDictionaryLowerBoundBytes: number;
	blockQueryViewWithSearchCoreBytes: number;
	blockQueryViewWithOperationalDescriptorBytes: number;
	blockAdaptiveCodec: CoverageLexicalV2AdaptivePostingCodecEstimate;
	blockAdaptiveCodecWithDictionaryLowerBoundBytes: number;
	exactFanout: CoverageLexicalV2AdaptiveHanBigramExactFanoutEstimate;
} {
	const bigramBlockFrequency = new Map<number, number>();
	const bigramBlockIds = new Map<number, number[]>();
	const hanDocBlockCounts: number[] = [];
	const hanDocBlockByteSums: number[] = [];
	const blockEncodedByteLengths: number[] = [];
	let hanLogicalBlockCount = 0;
	let maxBlocksPerHanDocument = 0;

	for (const preparedDocument of options.preparedDocuments) {
		const logicalBlocks = buildApproximateHanLogicalBlocks(
			preparedDocument.preparedSegments,
			options.config,
		);
		hanLogicalBlockCount += logicalBlocks.length;
		maxBlocksPerHanDocument = Math.max(maxBlocksPerHanDocument, logicalBlocks.length);
		if (preparedDocument.hanDocOrdinal !== null) {
			hanDocBlockCounts[preparedDocument.hanDocOrdinal] = logicalBlocks.length;
			hanDocBlockByteSums[preparedDocument.hanDocOrdinal] = logicalBlocks.reduce(
				(sum, logicalBlock) => sum + logicalBlock.encodedByteLength,
				0,
			);
		}
		for (const logicalBlock of logicalBlocks) {
			const blockId = blockEncodedByteLengths.length;
			blockEncodedByteLengths.push(logicalBlock.encodedByteLength);
			for (const bigramId of logicalBlock.bigramIds) {
				bigramBlockFrequency.set(
					bigramId,
					(bigramBlockFrequency.get(bigramId) ?? 0) + 1,
				);
				pushMapNumber(bigramBlockIds, bigramId, blockId);
			}
		}
	}

	let blockBigramIncidenceCount = 0;
	for (const blockFrequency of bigramBlockFrequency.values()) {
		blockBigramIncidenceCount += blockFrequency;
	}

	const blockIdBytes =
		hanLogicalBlockCount <= 0xff ? 1 : hanLogicalBlockCount <= 0xffff ? 2 : 4;
	const blockOrdinalBytes =
		maxBlocksPerHanDocument <= 0xff ? 1 : maxBlocksPerHanDocument <= 0xffff ? 2 : 4;
	let denseBigramBlockPostingBytes = 0;
	for (const blockFrequency of bigramBlockFrequency.values()) {
		if (blockFrequency === 1) {
			denseBigramBlockPostingBytes += options.denseBigramIdBytes + blockIdBytes;
			continue;
		}
		if (blockFrequency === 2) {
			denseBigramBlockPostingBytes +=
				options.denseBigramIdBytes + 2 * blockIdBytes;
			continue;
		}
		denseBigramBlockPostingBytes +=
			options.denseBigramIdBytes + 2 + blockFrequency * blockIdBytes;
	}
	const denseBigramBlockPostingWithDictionaryLowerBoundBytes =
		denseBigramBlockPostingBytes + options.denseBigramDictionaryLowerBoundBytes;
	const blockDescriptorSearchCoreBytes =
		hanLogicalBlockCount * (options.hanDocOrdinalBytes + blockOrdinalBytes + 2);
	const blockDescriptorOperationalBytes =
		hanLogicalBlockCount *
		(options.hanDocOrdinalBytes + blockOrdinalBytes + 1 + 2 + 2);
	const blockQueryViewWithSearchCoreBytes =
		denseBigramBlockPostingBytes + blockDescriptorSearchCoreBytes;
	const blockQueryViewWithOperationalDescriptorBytes =
		denseBigramBlockPostingBytes + blockDescriptorOperationalBytes;
	const blockAdaptiveCodec = estimateAdaptivePostingCodec(
		[...bigramBlockIds.values()],
		options.denseBigramIdBytes,
		blockIdBytes,
	);
	const blockAdaptiveCodecWithDictionaryLowerBoundBytes =
		blockAdaptiveCodec.totalBytes + options.denseBigramDictionaryLowerBoundBytes;
	const exactFanout = estimateCoverageLexicalV2AdaptiveHanBigramExactFanout({
		queryBigramIdsBySignature: options.queryBigramIdsBySignature,
		bigramDocOrdinals: options.bigramDocOrdinals,
		bigramBlockIds,
		hanDocBlockCounts,
		hanDocBlockByteSums,
		blockEncodedByteLengths,
	});

	return {
		label: options.config.label,
		targetSymbols: options.config.targetSymbols,
		targetEncodedBytes: options.config.targetEncodedBytes,
		hanLogicalBlockCount,
		blockBigramIncidenceCount,
		maxBlocksPerHanDocument,
		blockIdBytes,
		blockOrdinalBytes,
		blockDescriptorSearchCoreBytes,
		blockDescriptorOperationalBytes,
		denseBigramBlockPostingBytes,
		denseBigramBlockPostingWithDictionaryLowerBoundBytes,
		blockQueryViewWithSearchCoreBytes,
		blockQueryViewWithOperationalDescriptorBytes,
		blockAdaptiveCodec,
		blockAdaptiveCodecWithDictionaryLowerBoundBytes,
		exactFanout,
	};
}

function estimateCoverageLexicalV2AdaptiveHanBigramExactFanout(options: {
	queryBigramIdsBySignature: ReadonlyMap<string, readonly number[]>;
	bigramDocOrdinals: ReadonlyMap<number, readonly number[]>;
	bigramBlockIds: ReadonlyMap<number, readonly number[]>;
	hanDocBlockCounts: readonly number[];
	hanDocBlockByteSums: readonly number[];
	blockEncodedByteLengths: readonly number[];
}): CoverageLexicalV2AdaptiveHanBigramExactFanoutEstimate {
	const allDocCandidateCounts: number[] = [];
	const allDocRouteFanoutBlockCounts: number[] = [];
	const allDirectBlockCandidateCounts: number[] = [];
	const allDocRouteFanoutByteCounts: number[] = [];
	const allDirectBlockByteCounts: number[] = [];
	const allBlockRatios: number[] = [];
	const allByteRatios: number[] = [];
	const oneBigram = createExactFanoutBucketAccumulator();
	const twoBigram = createExactFanoutBucketAccumulator();
	const threePlusBigram = createExactFanoutBucketAccumulator();

	for (const bigramIds of options.queryBigramIdsBySignature.values()) {
		if (bigramIds.length === 0) {
			continue;
		}
		const docCandidates = intersectPostingLists(
			bigramIds.map((bigramId) => options.bigramDocOrdinals.get(bigramId) ?? []),
		);
		const directBlockCandidates = intersectPostingLists(
			bigramIds.map((bigramId) => options.bigramBlockIds.get(bigramId) ?? []),
		);
		let docRouteFanoutBlockCount = 0;
		let docRouteFanoutByteCount = 0;
		for (const docOrdinal of docCandidates) {
			docRouteFanoutBlockCount += options.hanDocBlockCounts[docOrdinal] ?? 0;
			docRouteFanoutByteCount += options.hanDocBlockByteSums[docOrdinal] ?? 0;
		}
		let directBlockByteCount = 0;
		for (const blockId of directBlockCandidates) {
			directBlockByteCount += options.blockEncodedByteLengths[blockId] ?? 0;
		}
		const bucket =
			bigramIds.length === 1 ? oneBigram : bigramIds.length === 2 ? twoBigram : threePlusBigram;
		pushExactFanoutBucketSample(bucket, {
			docCandidateCount: docCandidates.length,
			docRouteFanoutBlockCount,
			directBlockCandidateCount: directBlockCandidates.length,
			docRouteFanoutByteCount,
			directBlockByteCount,
		});
		allDocCandidateCounts.push(docCandidates.length);
		allDocRouteFanoutBlockCounts.push(docRouteFanoutBlockCount);
		allDirectBlockCandidateCounts.push(directBlockCandidates.length);
		allDocRouteFanoutByteCounts.push(docRouteFanoutByteCount);
		allDirectBlockByteCounts.push(directBlockByteCount);
		if (directBlockCandidates.length > 0) {
			allBlockRatios.push(docRouteFanoutBlockCount / directBlockCandidates.length);
		}
		if (directBlockByteCount > 0) {
			allByteRatios.push(docRouteFanoutByteCount / directBlockByteCount);
		}
	}

	return {
		queryCount: options.queryBigramIdsBySignature.size,
		oneBigramQueryCount: oneBigram.queryCount,
		twoBigramQueryCount: twoBigram.queryCount,
		threePlusBigramQueryCount: threePlusBigram.queryCount,
		docCandidateCount: summarizeDistribution(allDocCandidateCounts),
		docRouteFanoutBlockCount: summarizeDistribution(allDocRouteFanoutBlockCounts),
		directBlockCandidateCount: summarizeDistribution(allDirectBlockCandidateCounts),
		docRouteFanoutByteCount: summarizeDistribution(allDocRouteFanoutByteCounts),
		directBlockByteCount: summarizeDistribution(allDirectBlockByteCounts),
		docRouteVsBlockRouteBlockRatio: summarizeDistribution(allBlockRatios),
		docRouteVsBlockRouteByteRatio: summarizeDistribution(allByteRatios),
		byBucket: {
			oneBigram: finalizeExactFanoutBucketAccumulator(oneBigram),
			twoBigram: finalizeExactFanoutBucketAccumulator(twoBigram),
			threePlusBigram: finalizeExactFanoutBucketAccumulator(threePlusBigram),
		},
	};
}

type ExactFanoutBucketAccumulator = {
	queryCount: number;
	docCandidateCounts: number[];
	docRouteFanoutBlockCounts: number[];
	directBlockCandidateCounts: number[];
	docRouteFanoutByteCounts: number[];
	directBlockByteCounts: number[];
	blockRatios: number[];
	byteRatios: number[];
};

function createExactFanoutBucketAccumulator(): ExactFanoutBucketAccumulator {
	return {
		queryCount: 0,
		docCandidateCounts: [],
		docRouteFanoutBlockCounts: [],
		directBlockCandidateCounts: [],
		docRouteFanoutByteCounts: [],
		directBlockByteCounts: [],
		blockRatios: [],
		byteRatios: [],
	};
}

function pushExactFanoutBucketSample(
	bucket: ExactFanoutBucketAccumulator,
	sample: {
		docCandidateCount: number;
		docRouteFanoutBlockCount: number;
		directBlockCandidateCount: number;
		docRouteFanoutByteCount: number;
		directBlockByteCount: number;
	},
): void {
	bucket.queryCount += 1;
	bucket.docCandidateCounts.push(sample.docCandidateCount);
	bucket.docRouteFanoutBlockCounts.push(sample.docRouteFanoutBlockCount);
	bucket.directBlockCandidateCounts.push(sample.directBlockCandidateCount);
	bucket.docRouteFanoutByteCounts.push(sample.docRouteFanoutByteCount);
	bucket.directBlockByteCounts.push(sample.directBlockByteCount);
	if (sample.directBlockCandidateCount > 0) {
		bucket.blockRatios.push(
			sample.docRouteFanoutBlockCount / sample.directBlockCandidateCount,
		);
	}
	if (sample.directBlockByteCount > 0) {
		bucket.byteRatios.push(
			sample.docRouteFanoutByteCount / sample.directBlockByteCount,
		);
	}
}

function finalizeExactFanoutBucketAccumulator(
	bucket: ExactFanoutBucketAccumulator,
): CoverageLexicalV2AdaptiveHanBigramExactFanoutBucket {
	return {
		queryCount: bucket.queryCount,
		docCandidateCount: summarizeDistribution(bucket.docCandidateCounts),
		docRouteFanoutBlockCount: summarizeDistribution(
			bucket.docRouteFanoutBlockCounts,
		),
		directBlockCandidateCount: summarizeDistribution(
			bucket.directBlockCandidateCounts,
		),
		docRouteFanoutByteCount: summarizeDistribution(bucket.docRouteFanoutByteCounts),
		directBlockByteCount: summarizeDistribution(bucket.directBlockByteCounts),
		docRouteVsBlockRouteBlockRatio: summarizeDistribution(bucket.blockRatios),
		docRouteVsBlockRouteByteRatio: summarizeDistribution(bucket.byteRatios),
	};
}

function intersectPostingLists(postings: readonly (readonly number[])[]): number[] {
	if (postings.length === 0) {
		return [];
	}
	const sortedPostings = [...postings].sort((left, right) => left.length - right.length);
	let current = [...sortedPostings[0]];
	for (let index = 1; index < sortedPostings.length; index += 1) {
		current = intersectSortedNumberLists(current, sortedPostings[index]);
		if (current.length === 0) {
			break;
		}
	}
	return current;
}

function intersectSortedNumberLists(
	left: readonly number[],
	right: readonly number[],
): number[] {
	const intersection: number[] = [];
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < left.length && rightIndex < right.length) {
		const leftValue = left[leftIndex] ?? Number.POSITIVE_INFINITY;
		const rightValue = right[rightIndex] ?? Number.POSITIVE_INFINITY;
		if (leftValue === rightValue) {
			intersection.push(leftValue);
			leftIndex += 1;
			rightIndex += 1;
			continue;
		}
		if (leftValue < rightValue) {
			leftIndex += 1;
			continue;
		}
		rightIndex += 1;
	}
	return intersection;
}

function summarizeDistribution(
	values: readonly number[],
): CoverageLexicalV2AdaptiveHanBigramDistribution {
	if (values.length === 0) {
		return {
			avg: 0,
			p50: 0,
			p90: 0,
			p95: 0,
			max: 0,
		};
	}
	const sorted = [...values].sort((left, right) => left - right);
	const sum = sorted.reduce((total, value) => total + value, 0);
	return {
		avg: round(sum / sorted.length),
		p50: quantileFromSorted(sorted, 0.5),
		p90: quantileFromSorted(sorted, 0.9),
		p95: quantileFromSorted(sorted, 0.95),
		max: sorted[sorted.length - 1] ?? 0,
	};
}

function quantileFromSorted(values: readonly number[], percentile: number): number {
	if (values.length === 0) {
		return 0;
	}
	const index = Math.min(
		values.length - 1,
		Math.max(0, Math.ceil(values.length * percentile) - 1),
	);
	return values[index] ?? 0;
}

function estimateAdaptivePostingCodec(
	postings: readonly (readonly number[])[],
	termIdBytes: number,
	valueIdBytes: number,
	smallInlineCap = 8,
): CoverageLexicalV2AdaptivePostingCodecEstimate {
	const singletonCount = postings.filter((posting) => posting.length === 1).length;
	const pairCount = postings.filter((posting) => posting.length === 2).length;
	const smallPostings = postings
		.map((posting) => [...posting].sort((left, right) => left - right))
		.filter((posting) => posting.length >= 3 && posting.length <= smallInlineCap);
	const deltaPostings = postings
		.map((posting) => [...posting].sort((left, right) => left - right))
		.filter((posting) => posting.length > smallInlineCap);

	const singletonBytes = singletonCount * (termIdBytes + valueIdBytes);
	const pairBytes = pairCount * (termIdBytes + valueIdBytes * 2);
	const smallDocStarts = buildSequentialStarts(
		smallPostings.map((posting) => posting.length),
	);
	const smallValueCount = smallPostings.reduce(
		(sum, posting) => sum + posting.length,
		0,
	);
	const smallBytes =
		smallPostings.length * termIdBytes +
		estimatePackedUnsignedListBytes(smallDocStarts) +
		smallValueCount * valueIdBytes;
	const deltaTapeByteLengths = deltaPostings.map((posting) =>
		estimateDeltaVarintByteLength(posting),
	);
	const deltaTapeStarts = buildSequentialStarts(deltaTapeByteLengths);
	const deltaBytes =
		deltaPostings.length * termIdBytes +
		estimatePackedUnsignedListBytes(deltaTapeStarts) +
		deltaTapeByteLengths.reduce((sum, length) => sum + length, 0);
	const totalBytes = singletonBytes + pairBytes + smallBytes + deltaBytes;

	return {
		smallInlineCap,
		termIdBytes,
		valueIdBytes,
		totalBytes,
		singletonCount,
		singletonBytes,
		pairCount,
		pairBytes,
		smallCount: smallPostings.length,
		smallBytes,
		deltaCount: deltaPostings.length,
		deltaBytes,
	};
}

function estimatePackedUnsignedListBytes(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	let maxValue = 0;
	for (const value of values) {
		if (value > maxValue) {
			maxValue = value;
		}
	}
	if (maxValue <= 0xff) {
		return values.length;
	}
	if (maxValue <= 0xffff) {
		return values.length * 2;
	}
	return values.length * 4;
}

function estimateDeltaVarintByteLength(values: readonly number[]): number {
	let total = 0;
	let previous = 0;
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index] ?? 0;
		const delta = index === 0 ? value : value - previous;
		total += estimateUnsignedVarintByteLength(delta >>> 0);
		previous = value;
	}
	return total;
}

function estimateUnsignedVarintByteLength(value: number): number {
	let length = 1;
	let nextValue = value >>> 0;
	while (nextValue >= 0x80) {
		length += 1;
		nextValue >>>= 7;
	}
	return length;
}

function buildSequentialStarts(lengths: readonly number[]): number[] {
	const starts: number[] = [];
	let offset = 0;
	for (const length of lengths) {
		starts.push(offset);
		offset += length;
	}
	return starts;
}
