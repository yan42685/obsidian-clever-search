import { estimateBodyBlockBytes } from "../layout/body-blocks";
import {
	describeBodyFamilyPostingByteBreakdown,
	estimateBodyFamilyPostingBytes,
} from "../layout/body-family-posting";
import { estimateDocTableBytes } from "../layout/doc-table";
import { estimateExactTapeBytes } from "../layout/exact-tapes";
import { estimateFamilyLexiconBytes } from "../layout/family-lexicon";
import {
	describeHanRouteByteBreakdown,
	estimateHanRouteBytes,
} from "../layout/han-route";
import {
	describeIntegerSection,
	sentinelStartsEncodingFlag,
} from "../layout/integer-arrays";
import {
	estimateHeadingBytes,
	estimateMetadataContainerBytes,
} from "../layout/metadata-containers";
import type {
	ResidentBase,
	ResidentBaseMetrics,
	ResidentBaseSummary,
	ResidentBodyBlockArena,
	ResidentDocTable,
	ResidentExactTapeArena,
	ResidentFamilyLexicon,
	ResidentHanRouteArena,
	ResidentMetadataContainerArena,
	ResidentStringArena,
} from "../layout/types";

type MetricsBuildInput = Readonly<{
	stringArena: ResidentStringArena;
	stringArenaSourceBreakdown: Readonly<{
		pathBytes: number;
		familyBytes: number;
		identityWitnessBytes: number;
		routeWitnessBytes: number;
		headingWitnessBytes: number;
		bodyWitnessBytes: number;
		multiSourceBytes: number;
		unattributedBytes: number;
	}>;
	docTable: ResidentDocTable;
	familyLexicon: ResidentFamilyLexicon;
	metadataContainers: ResidentMetadataContainerArena;
	bodyBlocks: ResidentBodyBlockArena;
	bodyFamilyPosting: ResidentBase["bodyFamilyPosting"];
	exactTapes: ResidentExactTapeArena;
	hanRoute: ResidentHanRouteArena;
	auxiliaryBytes: number;
	indexedSurfaceUtf8Bytes: number;
	rawMarkdownUtf8Bytes: number;
}>;

const textEncoder = new TextEncoder();

export function buildResidentBaseMetrics(
	input: MetricsBuildInput,
): ResidentBaseMetrics {
	const docArenaBytes = estimateDocTableBytes(input.docTable);
	const stringArenaBytes = estimateStringArenaBytes(input.stringArena);
	const familyLexiconBytes = estimateFamilyLexiconBytes(input.familyLexicon);
	const metadataContainerBytes = estimateMetadataContainerBytes(
		input.metadataContainers,
	);
	const headingBytes = estimateHeadingBytes(input.metadataContainers);
	const familyPostingBytes = estimateBodyFamilyPostingBytes(
		input.bodyFamilyPosting,
	);
	const familyPostingBreakdown = describeBodyFamilyPostingByteBreakdown(
		input.bodyFamilyPosting,
	);
	const bodyBlockBytes = estimateBodyBlockBytes(input.bodyBlocks);
	const exactTapeBytes = estimateExactTapeBytes(input.exactTapes);
	const hanRouteBytes = estimateHanRouteBytes(input.hanRoute);
	const hanRouteBreakdown = describeHanRouteByteBreakdown(input.hanRoute);
	const stringArenaSourceBreakdown = input.stringArenaSourceBreakdown;
	const auxiliaryBytes = Math.max(0, input.auxiliaryBytes);
	const stringPayloadBytes = textEncoder.encode(input.stringArena.text).byteLength;
	const countBytes =
		input.docTable.identityCountByDocId.byteLength +
		input.docTable.routeCountByDocId.byteLength +
		input.docTable.headingCountByDocId.byteLength +
		input.docTable.bodyBlockCountByDocId.byteLength +
		input.bodyBlocks.exactTapeCountByBlockId.byteLength;
	const scaffoldBytes =
		input.stringArena.offsets.byteLength +
		input.stringArena.lengths.byteLength +
		input.docTable.pathStringIds.byteLength +
		input.docTable.generationByDocId.byteLength +
		input.docTable.identityStartByDocId.byteLength +
		input.docTable.identityCountByDocId.byteLength +
		input.docTable.routeStartByDocId.byteLength +
		input.docTable.routeCountByDocId.byteLength +
		input.docTable.headingStartByDocId.byteLength +
		input.docTable.headingCountByDocId.byteLength +
		input.docTable.bodyBlockStartByDocId.byteLength +
		input.docTable.bodyBlockCountByDocId.byteLength +
		input.metadataContainers.identityPostings.postingStarts.byteLength +
		input.metadataContainers.routePostings.postingStarts.byteLength +
		input.metadataContainers.headingPostings.postingStarts.byteLength +
		input.bodyFamilyPosting.smallValueStarts.byteLength +
		input.bodyFamilyPosting.deltaTapeStarts.byteLength +
		input.bodyBlocks.exactTapeStartByBlockId.byteLength +
		input.bodyBlocks.exactTapeCountByBlockId.byteLength +
		input.bodyBlocks.familySupportStartByBlockId.byteLength +
		input.exactTapes.positionEncodingByBlockId.byteLength +
		input.exactTapes.positionStartByBlockId.byteLength +
		input.hanRoute.metadataPostingStarts.byteLength +
		input.hanRoute.bodyAdaptivePostings.smallValueStarts.byteLength +
		input.hanRoute.bodyAdaptivePostings.deltaTapeStarts.byteLength +
		input.hanRoute.metadataCharPostingStarts.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.smallValueStarts.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.deltaTapeStarts.byteLength +
		input.hanRoute.identityWitnessStartByDocId.byteLength +
		input.hanRoute.routeWitnessStartByDocId.byteLength +
		input.hanRoute.headingWitnessStartByDocId.byteLength +
		input.hanRoute.bodyWitnessOccurrenceStartByBlockId.byteLength +
		input.hanRoute.bodyWitnessPositionEncodingByBlockId.byteLength +
		input.hanRoute.bodyWitnessPositionStartByBlockId.byteLength;
	const idPayloadBytes =
		input.familyLexicon.familyStringIds.byteLength +
		input.familyLexicon.familyFlagsByFamilyId.byteLength +
		input.metadataContainers.identityFamiliesByDoc.byteLength +
		input.metadataContainers.identitySourceMaskByDocEntry.byteLength +
		input.metadataContainers.routeFamiliesByDoc.byteLength +
		input.metadataContainers.routeSourceMaskByDocEntry.byteLength +
		input.metadataContainers.headingFamiliesByDoc.byteLength +
		input.metadataContainers.identityPostings.docIds.byteLength +
		input.metadataContainers.routePostings.docIds.byteLength +
		input.metadataContainers.headingPostings.docIds.byteLength +
		input.bodyFamilyPosting.singletonTermIds.byteLength +
		input.bodyFamilyPosting.singletonValueIds.byteLength +
		input.bodyFamilyPosting.pairTermIds.byteLength +
		input.bodyFamilyPosting.pairFirstValueIds.byteLength +
		input.bodyFamilyPosting.pairSecondValueIds.byteLength +
		input.bodyFamilyPosting.smallTermIds.byteLength +
		input.bodyFamilyPosting.smallValueIds.byteLength +
		input.bodyFamilyPosting.deltaTermIds.byteLength +
		input.bodyFamilyPosting.postingTape.byteLength +
		input.bodyBlocks.docIdByBlockId.byteLength +
		input.bodyBlocks.blockOrdinalByBlockId.byteLength +
		input.bodyBlocks.familySupportFamilyIds.byteLength +
		input.bodyBlocks.familySupportMaskByEntry.byteLength +
		input.exactTapes.familyIds.byteLength +
		input.exactTapes.positionDeltaU8Tape.byteLength +
		input.exactTapes.positionDeltaU16Tape.byteLength +
		input.exactTapes.positionDeltaU32Tape.byteLength +
		input.hanRoute.bigramIds.byteLength +
		input.hanRoute.metadataDocIds.byteLength +
		input.hanRoute.bodyAdaptivePostings.singletonTermIds.byteLength +
		input.hanRoute.bodyAdaptivePostings.singletonValueIds.byteLength +
		input.hanRoute.bodyAdaptivePostings.pairTermIds.byteLength +
		input.hanRoute.bodyAdaptivePostings.pairFirstValueIds.byteLength +
		input.hanRoute.bodyAdaptivePostings.pairSecondValueIds.byteLength +
		input.hanRoute.bodyAdaptivePostings.smallTermIds.byteLength +
		input.hanRoute.bodyAdaptivePostings.smallValueIds.byteLength +
		input.hanRoute.bodyAdaptivePostings.deltaTermIds.byteLength +
		input.hanRoute.bodyAdaptivePostings.postingTape.byteLength +
		input.hanRoute.metadataCharIds.byteLength +
		input.hanRoute.metadataCharDocIds.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.singletonTermIds.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.singletonValueIds.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.pairTermIds.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.pairFirstValueIds.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.pairSecondValueIds.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.smallTermIds.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.smallValueIds.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.deltaTermIds.byteLength +
		input.hanRoute.bodyCharAdaptivePostings.postingTape.byteLength +
		input.hanRoute.identityWitnessStringIds.byteLength +
		input.hanRoute.routeWitnessStringIds.byteLength +
		input.hanRoute.headingWitnessStringIds.byteLength +
		input.hanRoute.bodyWitnessOccurrenceStringIds.byteLength +
		input.hanRoute.bodyWitnessPositionDeltaU8Tape.byteLength +
		input.hanRoute.bodyWitnessPositionDeltaU16Tape.byteLength +
		input.hanRoute.bodyWitnessPositionDeltaU32Tape.byteLength;
	const residentBytes =
		docArenaBytes +
		stringArenaBytes +
		familyLexiconBytes +
		metadataContainerBytes +
		headingBytes +
		familyPostingBytes +
		bodyBlockBytes +
		exactTapeBytes +
		hanRouteBytes +
		auxiliaryBytes;
	return {
		docArenaBytes,
		stringArenaBytes,
		stringArenaPathBytes: stringArenaSourceBreakdown.pathBytes,
		stringArenaFamilyBytes: stringArenaSourceBreakdown.familyBytes,
		stringArenaIdentityWitnessBytes:
			stringArenaSourceBreakdown.identityWitnessBytes,
		stringArenaRouteWitnessBytes: stringArenaSourceBreakdown.routeWitnessBytes,
		stringArenaHeadingWitnessBytes:
			stringArenaSourceBreakdown.headingWitnessBytes,
		stringArenaBodyWitnessBytes: stringArenaSourceBreakdown.bodyWitnessBytes,
		stringArenaMultiSourceBytes: stringArenaSourceBreakdown.multiSourceBytes,
		stringArenaUnattributedBytes:
			stringArenaSourceBreakdown.unattributedBytes,
		familyLexiconBytes,
		metadataContainerBytes,
		headingBytes,
		familyPostingBytes,
		familyPostingTermIdsBytes: familyPostingBreakdown.termIdsBytes,
		familyPostingPostingStartsBytes:
			familyPostingBreakdown.postingStartsBytes,
		familyPostingBlockIdsBytes: familyPostingBreakdown.blockIdsBytes,
		familyPostingSingletonTermIdsBytes:
			familyPostingBreakdown.singletonTermIdsBytes,
		familyPostingSingletonBlockIdsBytes:
			familyPostingBreakdown.singletonBlockIdsBytes,
		familyPostingPairTermIdsBytes:
			familyPostingBreakdown.pairTermIdsBytes,
		familyPostingPairFirstBlockIdsBytes:
			familyPostingBreakdown.pairFirstBlockIdsBytes,
		familyPostingPairSecondBlockIdsBytes:
			familyPostingBreakdown.pairSecondBlockIdsBytes,
		familyPostingSmallTermIdsBytes:
			familyPostingBreakdown.smallTermIdsBytes,
		familyPostingSmallPostingStartsBytes:
			familyPostingBreakdown.smallPostingStartsBytes,
		familyPostingSmallBlockIdsBytes:
			familyPostingBreakdown.smallBlockIdsBytes,
		familyPostingDeltaTermIdsBytes:
			familyPostingBreakdown.deltaTermIdsBytes,
		familyPostingDeltaTapeStartsBytes:
			familyPostingBreakdown.deltaTapeStartsBytes,
		familyPostingDeltaPostingTapeBytes:
			familyPostingBreakdown.deltaPostingTapeBytes,
		bodyBlockBytes,
		exactTapeBytes,
		exactTapePositionBytes:
			input.exactTapes.positionEncodingByBlockId.byteLength +
			input.exactTapes.positionStartByBlockId.byteLength +
			input.exactTapes.positionDeltaU8Tape.byteLength +
			input.exactTapes.positionDeltaU16Tape.byteLength +
			input.exactTapes.positionDeltaU32Tape.byteLength,
		hanRouteBytes,
		hanRouteSharedBigramIdsBytes: hanRouteBreakdown.sharedBigramIdsBytes,
		hanRouteMetadataHanPostingsBytes:
			hanRouteBreakdown.metadataHanPostingsBytes,
		hanRouteMetadataHanPostingStartsBytes:
			hanRouteBreakdown.metadataHanPostingStartsBytes,
		hanRouteMetadataHanDocIdsBytes:
			hanRouteBreakdown.metadataHanDocIdsBytes,
		hanRouteHanBigramPostingBytes:
			hanRouteBreakdown.bodyHanPostingsBytes,
		hanRouteBodyBigramIdsBytes: hanRouteBreakdown.bodyBigramIdsBytes,
		hanRouteHanBigramPostingStartsBytes:
			hanRouteBreakdown.bodyHanPostingStartsBytes,
		hanRouteHanBigramBlockIdsBytes:
			hanRouteBreakdown.bodyHanBodyBlockIdsBytes,
		hanRouteHanBigramSingletonTermIdsBytes:
			hanRouteBreakdown.bodyHanSingletonTermIdsBytes,
		hanRouteHanBigramSingletonBlockIdsBytes:
			hanRouteBreakdown.bodyHanSingletonBodyBlockIdsBytes,
		hanRouteHanBigramPairTermIdsBytes:
			hanRouteBreakdown.bodyHanPairTermIdsBytes,
		hanRouteHanBigramPairFirstBlockIdsBytes:
			hanRouteBreakdown.bodyHanPairFirstBodyBlockIdsBytes,
		hanRouteHanBigramPairSecondBlockIdsBytes:
			hanRouteBreakdown.bodyHanPairSecondBodyBlockIdsBytes,
		hanRouteHanBigramSmallTermIdsBytes:
			hanRouteBreakdown.bodyHanSmallTermIdsBytes,
		hanRouteHanBigramSmallPostingStartsBytes:
			hanRouteBreakdown.bodyHanSmallPostingStartsBytes,
		hanRouteHanBigramSmallBlockIdsBytes:
			hanRouteBreakdown.bodyHanSmallBodyBlockIdsBytes,
		hanRouteHanBigramDeltaTermIdsBytes:
			hanRouteBreakdown.bodyHanDeltaTermIdsBytes,
		hanRouteHanBigramDeltaTapeStartsBytes:
			hanRouteBreakdown.bodyHanDeltaTapeStartsBytes,
		hanRouteHanBigramDeltaPostingTapeBytes:
			hanRouteBreakdown.bodyHanDeltaPostingTapeBytes,
		hanRouteMetadataHanCharPostingsBytes:
			hanRouteBreakdown.metadataHanCharPostingsBytes,
		hanRouteMetadataHanCharPostingStartsBytes:
			hanRouteBreakdown.metadataHanCharPostingStartsBytes,
		hanRouteMetadataHanCharDocIdsBytes:
			hanRouteBreakdown.metadataHanCharDocIdsBytes,
		hanRouteHanCharPostingBytes:
			hanRouteBreakdown.bodyHanCharPostingsBytes,
		hanRouteBodyCharIdsBytes: hanRouteBreakdown.bodyHanCharIdsBytes,
		hanRouteHanCharPostingStartsBytes:
			hanRouteBreakdown.bodyHanCharPostingStartsBytes,
		hanRouteHanCharBlockIdsBytes:
			hanRouteBreakdown.bodyHanCharBodyBlockIdsBytes,
		hanRouteMetadataWitnessBytes: hanRouteBreakdown.metadataWitnessBytes,
		hanRouteBodyWitnessBytes: hanRouteBreakdown.bodyWitnessBytes,
		hanRouteBodyWitnessPositionBytes: hanRouteBreakdown.bodyWitnessPositionBytes,
		scaffoldBytes,
		countBytes,
		idPayloadBytes,
		stringPayloadBytes,
		auxiliaryBytes,
		residentBytes,
		indexedSurfaceUtf8Bytes: Math.max(0, input.indexedSurfaceUtf8Bytes),
		rawMarkdownUtf8Bytes: Math.max(0, input.rawMarkdownUtf8Bytes),
		"residentBytes / indexedSurfaceUtf8Bytes": safeDivide(
			residentBytes,
			input.indexedSurfaceUtf8Bytes,
		),
		"residentBytes / rawMarkdownUtf8Bytes": safeDivide(
			residentBytes,
			input.rawMarkdownUtf8Bytes,
		),
	};
}

export function describeResidentBase(base: ResidentBase): ResidentBaseSummary {
	const metrics = base.metrics;
	return {
		documentCount: base.docTable.docCount,
		familyCount: base.familyLexicon.familyCount,
		blockCount: base.bodyBlocks.blockCount,
		exactTapeValueCount: base.exactTapes.familyIds.length,
		buckets: [
			buildBucketShare("docArenaBytes", metrics.docArenaBytes, metrics.residentBytes),
			buildBucketShare(
				"stringArenaBytes",
				metrics.stringArenaBytes,
				metrics.residentBytes,
			),
			buildBucketShare(
				"familyLexiconBytes",
				metrics.familyLexiconBytes,
				metrics.residentBytes,
			),
			buildBucketShare(
				"metadataContainerBytes",
				metrics.metadataContainerBytes,
				metrics.residentBytes,
			),
			buildBucketShare("headingBytes", metrics.headingBytes, metrics.residentBytes),
			buildBucketShare(
				"familyPostingBytes",
				metrics.familyPostingBytes,
				metrics.residentBytes,
			),
			buildBucketShare("bodyBlockBytes", metrics.bodyBlockBytes, metrics.residentBytes),
			buildBucketShare("exactTapeBytes", metrics.exactTapeBytes, metrics.residentBytes),
			buildBucketShare("hanRouteBytes", metrics.hanRouteBytes, metrics.residentBytes),
			buildBucketShare("auxiliaryBytes", metrics.auxiliaryBytes, metrics.residentBytes),
		],
		sectionEncodings: [
			describeIntegerSection("stringArena.offsets", base.stringArena.offsets),
			describeIntegerSection("stringArena.lengths", base.stringArena.lengths),
			describeIntegerSection("docTable.pathStringIds", base.docTable.pathStringIds),
			describeIntegerSection(
				"metadata.identityPostings.starts",
				base.metadataContainers.identityPostings.postingStarts,
				sentinelStartsEncodingFlag(),
			),
			describeIntegerSection(
				"metadata.identityPostings.docIds",
				base.metadataContainers.identityPostings.docIds,
			),
			describeIntegerSection(
				"familyPosting.singletonTermIds",
				base.bodyFamilyPosting.singletonTermIds,
			),
			describeIntegerSection(
				"familyPosting.singletonValueIds",
				base.bodyFamilyPosting.singletonValueIds,
			),
			describeIntegerSection(
				"familyPosting.pairTermIds",
				base.bodyFamilyPosting.pairTermIds,
			),
			describeIntegerSection(
				"familyPosting.pairFirstValueIds",
				base.bodyFamilyPosting.pairFirstValueIds,
			),
			describeIntegerSection(
				"familyPosting.pairSecondValueIds",
				base.bodyFamilyPosting.pairSecondValueIds,
			),
			describeIntegerSection(
				"familyPosting.smallTermIds",
				base.bodyFamilyPosting.smallTermIds,
			),
			describeIntegerSection(
				"familyPosting.smallValueStarts",
				base.bodyFamilyPosting.smallValueStarts,
				sentinelStartsEncodingFlag(),
			),
			describeIntegerSection(
				"familyPosting.smallValueIds",
				base.bodyFamilyPosting.smallValueIds,
			),
			describeIntegerSection(
				"familyPosting.deltaTermIds",
				base.bodyFamilyPosting.deltaTermIds,
			),
			describeIntegerSection(
				"familyPosting.deltaTapeStarts",
				base.bodyFamilyPosting.deltaTapeStarts,
				sentinelStartsEncodingFlag(),
			),
			describeIntegerSection(
				"familyPosting.postingTape",
				base.bodyFamilyPosting.postingTape,
			),
			describeIntegerSection("exactTapes.familyIds", base.exactTapes.familyIds),
			describeIntegerSection(
				"exactTapes.positionStartByBlockId",
				base.exactTapes.positionStartByBlockId,
			),
			describeIntegerSection(
				"exactTapes.positionDeltaU8Tape",
				base.exactTapes.positionDeltaU8Tape,
			),
			describeIntegerSection(
				"exactTapes.positionDeltaU16Tape",
				base.exactTapes.positionDeltaU16Tape,
			),
			describeIntegerSection(
				"exactTapes.positionDeltaU32Tape",
				base.exactTapes.positionDeltaU32Tape,
			),
			describeIntegerSection(
				"hanRoute.metadata.starts",
				base.hanRoute.metadataPostingStarts,
				sentinelStartsEncodingFlag(),
			),
			describeIntegerSection(
				"hanRoute.metadata.docIds",
				base.hanRoute.metadataDocIds,
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.singletonTermIds",
				base.hanRoute.bodyAdaptivePostings.singletonTermIds,
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.singletonValueIds",
				base.hanRoute.bodyAdaptivePostings.singletonValueIds,
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.pairTermIds",
				base.hanRoute.bodyAdaptivePostings.pairTermIds,
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.pairFirstValueIds",
				base.hanRoute.bodyAdaptivePostings.pairFirstValueIds,
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.pairSecondValueIds",
				base.hanRoute.bodyAdaptivePostings.pairSecondValueIds,
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.smallTermIds",
				base.hanRoute.bodyAdaptivePostings.smallTermIds,
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.smallValueStarts",
				base.hanRoute.bodyAdaptivePostings.smallValueStarts,
				sentinelStartsEncodingFlag(),
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.smallValueIds",
				base.hanRoute.bodyAdaptivePostings.smallValueIds,
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.deltaTermIds",
				base.hanRoute.bodyAdaptivePostings.deltaTermIds,
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.deltaTapeStarts",
				base.hanRoute.bodyAdaptivePostings.deltaTapeStarts,
				sentinelStartsEncodingFlag(),
			),
			describeIntegerSection(
				"hanRoute.hanBigramPosting.postingTape",
				base.hanRoute.bodyAdaptivePostings.postingTape,
			),
			describeIntegerSection(
				"hanRoute.bodyWitnessOccurrenceStartByBlockId",
				base.hanRoute.bodyWitnessOccurrenceStartByBlockId,
				sentinelStartsEncodingFlag(),
			),
			describeIntegerSection(
				"hanRoute.bodyWitnessOccurrenceStringIds",
				base.hanRoute.bodyWitnessOccurrenceStringIds,
			),
			describeIntegerSection(
				"hanRoute.bodyWitnessPositionStartByBlockId",
				base.hanRoute.bodyWitnessPositionStartByBlockId,
			),
			describeIntegerSection(
				"hanRoute.bodyWitnessPositionDeltaU8Tape",
				base.hanRoute.bodyWitnessPositionDeltaU8Tape,
			),
			describeIntegerSection(
				"hanRoute.bodyWitnessPositionDeltaU16Tape",
				base.hanRoute.bodyWitnessPositionDeltaU16Tape,
			),
			describeIntegerSection(
				"hanRoute.bodyWitnessPositionDeltaU32Tape",
				base.hanRoute.bodyWitnessPositionDeltaU32Tape,
			),
		],
		indexedSurfaceUtf8Bytes: metrics.indexedSurfaceUtf8Bytes,
		rawMarkdownUtf8Bytes: metrics.rawMarkdownUtf8Bytes,
		"residentBytes / indexedSurfaceUtf8Bytes":
			metrics["residentBytes / indexedSurfaceUtf8Bytes"],
		"residentBytes / rawMarkdownUtf8Bytes":
			metrics["residentBytes / rawMarkdownUtf8Bytes"],
	};
}

function estimateStringArenaBytes(stringArena: ResidentStringArena): number {
	return (
		textEncoder.encode(stringArena.text).byteLength +
		stringArena.offsets.byteLength +
		stringArena.lengths.byteLength
	);
}

function safeDivide(numerator: number, denominator: number): number {
	if (denominator <= 0) {
		return 0;
	}
	return numerator / denominator;
}

function buildBucketShare(
	label: string,
	bytes: number,
	total: number,
): Readonly<{
	label: string;
	bytes: number;
	share: number;
}> {
	return {
		label,
		bytes,
		share: safeDivide(bytes, total),
	};
}
