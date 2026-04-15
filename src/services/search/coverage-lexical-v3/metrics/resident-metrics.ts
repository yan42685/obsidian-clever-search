import { estimateBodyBlockBytes } from "../layout/body-blocks";
import { estimateBodySummaryBytes } from "../layout/body-summary-postings";
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
	docTable: ResidentDocTable;
	familyLexicon: ResidentFamilyLexicon;
	metadataContainers: ResidentMetadataContainerArena;
	bodyBlocks: ResidentBodyBlockArena;
	bodySummary: ResidentBase["bodySummary"];
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
	const bodySummaryBytes = estimateBodySummaryBytes(input.bodySummary);
	const bodyBlockBytes = estimateBodyBlockBytes(input.bodyBlocks);
	const exactTapeBytes = estimateExactTapeBytes(input.exactTapes);
	const hanRouteBytes = estimateHanRouteBytes(input.hanRoute);
	const hanRouteBreakdown = describeHanRouteByteBreakdown(input.hanRoute);
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
		input.bodySummary.postings.postingStarts.byteLength +
		input.bodyBlocks.exactTapeStartByBlockId.byteLength +
		input.bodyBlocks.exactTapeCountByBlockId.byteLength +
		input.hanRoute.metadataPostingStarts.byteLength +
		input.hanRoute.bodyBlockPostingStarts.byteLength +
		input.hanRoute.identityWitnessStartByDocId.byteLength +
		input.hanRoute.routeWitnessStartByDocId.byteLength +
		input.hanRoute.headingWitnessStartByDocId.byteLength +
		input.hanRoute.bodyWitnessStartByBlockId.byteLength;
	const idPayloadBytes =
		input.familyLexicon.familyStringIds.byteLength +
		input.familyLexicon.familyFlagsByFamilyId.byteLength +
		input.metadataContainers.identityFamiliesByDoc.byteLength +
		input.metadataContainers.routeFamiliesByDoc.byteLength +
		input.metadataContainers.headingFamiliesByDoc.byteLength +
		input.metadataContainers.identityPostings.docIds.byteLength +
		input.metadataContainers.routePostings.docIds.byteLength +
		input.metadataContainers.headingPostings.docIds.byteLength +
		input.bodySummary.postings.blockIds.byteLength +
		input.bodyBlocks.docIdByBlockId.byteLength +
		input.bodyBlocks.blockOrdinalByBlockId.byteLength +
		input.exactTapes.familyIds.byteLength +
		input.hanRoute.bigramIds.byteLength +
		input.hanRoute.metadataDocIds.byteLength +
		input.hanRoute.bodyBlockIds.byteLength +
		input.hanRoute.identityWitnessFamilyIds.byteLength +
		input.hanRoute.routeWitnessFamilyIds.byteLength +
		input.hanRoute.headingWitnessFamilyIds.byteLength +
		input.hanRoute.bodyWitnessFamilyIds.byteLength;
	const residentBytes =
		docArenaBytes +
		stringArenaBytes +
		familyLexiconBytes +
		metadataContainerBytes +
		headingBytes +
		bodySummaryBytes +
		bodyBlockBytes +
		exactTapeBytes +
		hanRouteBytes +
		auxiliaryBytes;
	return {
		docArenaBytes,
		stringArenaBytes,
		familyLexiconBytes,
		metadataContainerBytes,
		headingBytes,
		bodySummaryBytes,
		bodyBlockBytes,
		exactTapeBytes,
		hanRouteBytes,
		hanRouteMetadataHanPostingsBytes:
			hanRouteBreakdown.metadataHanPostingsBytes,
		hanRouteBodyHanPostingsBytes: hanRouteBreakdown.bodyHanPostingsBytes,
		hanRouteMetadataWitnessBytes: hanRouteBreakdown.metadataWitnessBytes,
		hanRouteBodyWitnessBytes: hanRouteBreakdown.bodyWitnessBytes,
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
				"bodySummaryBytes",
				metrics.bodySummaryBytes,
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
				"bodySummary.postings.starts",
				base.bodySummary.postings.postingStarts,
				sentinelStartsEncodingFlag(),
			),
			describeIntegerSection(
				"bodySummary.postings.blockIds",
				base.bodySummary.postings.blockIds,
			),
			describeIntegerSection("exactTapes.familyIds", base.exactTapes.familyIds),
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
				"hanRoute.body.starts",
				base.hanRoute.bodyBlockPostingStarts,
				sentinelStartsEncodingFlag(),
			),
			describeIntegerSection(
				"hanRoute.body.blockIds",
				base.hanRoute.bodyBlockIds,
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
