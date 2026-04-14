import { estimateBodyBlockBytes } from "../layout/body-blocks";
import { estimateDocTableBytes } from "../layout/doc-table";
import { estimateExactTapeBytes } from "../layout/exact-tapes";
import { estimateFamilyLexiconBytes } from "../layout/family-lexicon";
import { estimateHanRouteBytes } from "../layout/han-route";
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
	const bodyBlockBytes = estimateBodyBlockBytes(input.bodyBlocks);
	const exactTapeBytes = estimateExactTapeBytes(input.exactTapes);
	const hanRouteBytes = estimateHanRouteBytes(input.hanRoute);
	const auxiliaryBytes = Math.max(0, input.auxiliaryBytes);
	const residentBytes =
		docArenaBytes +
		stringArenaBytes +
		familyLexiconBytes +
		metadataContainerBytes +
		headingBytes +
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
		bodyBlockBytes,
		exactTapeBytes,
		hanRouteBytes,
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
			buildBucketShare("bodyBlockBytes", metrics.bodyBlockBytes, metrics.residentBytes),
			buildBucketShare("exactTapeBytes", metrics.exactTapeBytes, metrics.residentBytes),
			buildBucketShare("hanRouteBytes", metrics.hanRouteBytes, metrics.residentBytes),
			buildBucketShare("auxiliaryBytes", metrics.auxiliaryBytes, metrics.residentBytes),
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
