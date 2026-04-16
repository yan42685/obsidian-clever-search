import type { IndexedDocument } from "src/globals/search-types";
import { buildBodyBlockArena } from "../layout/body-blocks";
import { buildBodySummaryArena } from "../layout/body-summary-postings";
import { buildDocTable } from "../layout/doc-table";
import {
	buildExactTapeArena,
	type ExactTapeDraft,
} from "../layout/exact-tapes";
import { buildFamilyLexicon } from "../layout/family-lexicon";
import { buildHanRouteArena } from "../layout/han-route";
import { buildIntegerArray } from "../layout/integer-arrays";
import { buildMetadataContainerArena } from "../layout/metadata-containers";
import type { ResidentBase } from "../layout/types";
import {
	IDENTITY_METADATA_SOURCE_ALIAS,
	IDENTITY_METADATA_SOURCE_BASENAME,
	ROUTE_METADATA_SOURCE_FOLDER,
	ROUTE_METADATA_SOURCE_TAG,
} from "../metadata-source";
import { buildResidentBaseMetrics } from "../metrics";
import {
	encodeHanBigramId,
	extractDocumentFamilySequence,
	extractDocumentFamilyTexts,
	extractHanBigrams,
	extractHanSegments,
	splitBodyBlocks,
	splitBodyBlocksWithDocumentTokenizer,
	splitTagValues,
	type V3DocumentTokenizer,
} from "../query";

const textEncoder = new TextEncoder();

const SOURCE_MASK_IDENTITY = 1 << 0;
const SOURCE_MASK_ROUTE = 1 << 1;
const SOURCE_MASK_HEADING = 1 << 2;
const SOURCE_MASK_BODY = 1 << 3;

const STRING_SOURCE_PATH = 1 << 0;
const STRING_SOURCE_FAMILY = 1 << 1;
const STRING_SOURCE_IDENTITY_WITNESS = 1 << 2;
const STRING_SOURCE_ROUTE_WITNESS = 1 << 3;
const STRING_SOURCE_HEADING_WITNESS = 1 << 4;
const STRING_SOURCE_BODY_WITNESS = 1 << 5;

type PreparedDocument = Readonly<{
	path: string;
	generation: number;
	basename: string;
	folder: string;
	basenameFamilyTexts: readonly string[];
	aliasFamilyTexts: readonly string[];
	identityFamilyTexts: readonly string[];
	identitySourceMasks: readonly number[];
	folderFamilyTexts: readonly string[];
	tagFamilyTexts: readonly string[];
	routeFamilyTexts: readonly string[];
	routeSourceMasks: readonly number[];
	headingFamilyTexts: readonly string[];
	identityHanWitnessTexts: readonly string[];
	routeHanWitnessTexts: readonly string[];
	headingHanWitnessTexts: readonly string[];
	identityHanBigramIds: readonly number[];
	routeHanBigramIds: readonly number[];
	bodyBlocks: readonly PreparedBodyBlock[];
}>;

type PreparedBodyBlock = Readonly<{
	docId: number;
	ordinal: number;
	summaryFamilyTexts: readonly string[];
	exactFamilyTexts: readonly string[];
	hanWitnessTexts: readonly string[];
	hanBigramIds: readonly number[];
}>;

export type ResidentBuildArtifacts = Readonly<{
	base: ResidentBase;
}>;

export function buildResidentBase(
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): ResidentBase {
	return buildResidentBaseArtifacts(documents, tokenizeDocumentText).base;
}

export function buildResidentBaseArtifacts(
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): ResidentBuildArtifacts {
	const stringArenaBuilder = new StringArenaBuilder();
	const preparedDocuments = [...documents]
		.sort((left, right) => left.path.localeCompare(right.path))
		.map((document, docId) =>
			prepareDocument(document, docId, tokenizeDocumentText),
		);
	const familySourceMaskByText = collectFamilySourceMasks(preparedDocuments);
	const familyTexts = [...familySourceMaskByText.keys()].sort((left, right) =>
		left.localeCompare(right),
	);
	const familyIdByText = new Map<string, number>();
	const familyLexicon = buildFamilyLexicon(
		familyTexts.map((text, familyId) => {
			familyIdByText.set(text, familyId);
			return {
				text,
				stringId: stringArenaBuilder.intern(text, STRING_SOURCE_FAMILY),
				sourceMask: familySourceMaskByText.get(text) ?? 0,
			};
		}),
	);

	const identityFamilyIdsByDoc = preparedDocuments.map((document) =>
		mapFamilyTextsToIds(document.identityFamilyTexts, familyIdByText),
	);
	const identitySourceMasksByDoc = preparedDocuments.map(
		(document) => document.identitySourceMasks,
	);
	const routeFamilyIdsByDoc = preparedDocuments.map((document) =>
		mapFamilyTextsToIds(document.routeFamilyTexts, familyIdByText),
	);
	const routeSourceMasksByDoc = preparedDocuments.map(
		(document) => document.routeSourceMasks,
	);
	const headingFamilyIdsByDoc = preparedDocuments.map((document) =>
		mapFamilyTextsToIds(document.headingFamilyTexts, familyIdByText),
	);
	const metadataContainers = buildMetadataContainerArena({
		familyCount: familyLexicon.familyCount,
		identityFamilyIdsByDoc,
		identitySourceMasksByDoc,
		routeFamilyIdsByDoc,
		routeSourceMasksByDoc,
		headingFamilyIdsByDoc,
	});

	const blockInputs: Array<{
		docId: number;
		ordinal: number;
		summaryFamilyIds: readonly number[];
		exactDraft: ExactTapeDraft;
	}> = [];
	const bodyBlockStartByDocId: number[] = [];
	const bodyBlockCountByDocId: number[] = [];
	for (const document of preparedDocuments) {
		bodyBlockStartByDocId.push(blockInputs.length);
		for (const block of document.bodyBlocks) {
			const exactFamilyIds = block.exactFamilyTexts
				.map((familyText) => familyIdByText.get(familyText))
				.filter((familyId): familyId is number => familyId !== undefined);
			blockInputs.push({
				docId: block.docId,
				ordinal: block.ordinal,
				summaryFamilyIds: mapFamilyTextsToIds(
					block.summaryFamilyTexts,
					familyIdByText,
				),
				exactDraft: {
					familyIds: exactFamilyIds,
				},
			});
		}
		bodyBlockCountByDocId.push(blockInputs.length - bodyBlockStartByDocId.at(-1)!);
	}
	const exactTapes = buildExactTapeArena(
		blockInputs.map((block) => block.exactDraft),
	);
	const bodySummary = buildBodySummaryArena({
		summaryFamilyIdsByBlock: blockInputs.map((block) => block.summaryFamilyIds),
	});
	const bodyBlocks = buildBodyBlockArena(
		blockInputs.map((block, blockId) => ({
			docId: block.docId,
			ordinal: block.ordinal,
			exactTapeStart: exactTapes.startsByDraftIndex[blockId] ?? 0,
			exactTapeCount: exactTapes.countsByDraftIndex[blockId] ?? 0,
		})),
	);

	const docTable = buildDocTable(
		preparedDocuments.map((document, docId) => ({
			pathStringId: stringArenaBuilder.intern(document.path, STRING_SOURCE_PATH),
			generation: document.generation,
			identityStart: metadataContainers.identityStartByDocId[docId] ?? 0,
			identityCount: metadataContainers.identityCountByDocId[docId] ?? 0,
			routeStart: metadataContainers.routeStartByDocId[docId] ?? 0,
			routeCount: metadataContainers.routeCountByDocId[docId] ?? 0,
			headingStart: metadataContainers.headingStartByDocId[docId] ?? 0,
			headingCount: metadataContainers.headingCountByDocId[docId] ?? 0,
			bodyBlockStart: bodyBlockStartByDocId[docId] ?? 0,
			bodyBlockCount: bodyBlockCountByDocId[docId] ?? 0,
		})),
	);

	const hanRoute = buildResidentHanRoute(preparedDocuments, stringArenaBuilder);
	const stringArenaSourceBreakdown = stringArenaBuilder.describeSourceUtf8Bytes();
	const stringArena = stringArenaBuilder.build();
	const metrics = buildResidentBaseMetrics({
		stringArena,
		stringArenaSourceBreakdown,
		docTable,
		familyLexicon,
		metadataContainers: metadataContainers.arena,
		bodySummary,
		bodyBlocks,
		exactTapes: exactTapes.arena,
		hanRoute,
		auxiliaryBytes: 0,
		indexedSurfaceUtf8Bytes: computeIndexedSurfaceUtf8Bytes(documents),
		rawMarkdownUtf8Bytes: computeRawMarkdownUtf8Bytes(documents),
	});

	return {
		base: {
			version: 1,
			stringArena,
			docTable,
			familyLexicon,
			metadataContainers: metadataContainers.arena,
			bodySummary,
			bodyBlocks,
			exactTapes: exactTapes.arena,
			hanRoute,
			metrics,
		},
	};
}

export function buildResidentBaseFromAutomationReadyDocuments(
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): ResidentBase {
	return buildResidentBase(documents, tokenizeDocumentText);
}

export function buildDocumentHanBigramInventory(
	document: IndexedDocument,
): Readonly<{
	identityHanBigrams: readonly string[];
	routeHanBigrams: readonly string[];
	headingHanBigrams: readonly string[];
	bodyHanBigrams: readonly string[];
}> {
	return {
		identityHanBigrams: dedupeSorted([
			...extractHanBigrams(document.basename ?? ""),
			...extractHanBigrams(document.aliases ?? ""),
		]),
		routeHanBigrams: dedupeSorted([
			...extractHanBigrams(document.folder ?? ""),
			...splitTagValues(document.tags ?? "").flatMap((tag) => extractHanBigrams(tag)),
		]),
		headingHanBigrams: dedupeSorted(extractHanBigrams(document.headings ?? "")),
		bodyHanBigrams: dedupeSorted(
			splitBodyBlocks(document.content ?? "").flatMap((block) => block.hanBigramTexts),
		),
	};
}

export function buildDocumentExactFamilySequence(
	document: IndexedDocument,
	tokenizeDocumentText?: V3DocumentTokenizer,
): readonly string[] {
	return extractDocumentFamilySequence(
		document.content ?? "",
		tokenizeDocumentText,
	);
}

function prepareDocument(
	document: IndexedDocument,
	docId: number,
	tokenizeDocumentText?: V3DocumentTokenizer,
): PreparedDocument {
	const aliasesText = document.aliases ?? "";
	const tagsText = document.tags ?? "";
	const headingsText = document.headings ?? "";
	const contentText = document.content ?? "";
	const basenameFamilyTexts = dedupeSorted(
		extractDocumentFamilyTexts(document.basename ?? "", tokenizeDocumentText),
	);
	const aliasFamilyTexts = dedupeSorted(
		extractDocumentFamilyTexts(aliasesText, tokenizeDocumentText),
	);
	const folderFamilyTexts = dedupeSorted(
		extractDocumentFamilyTexts(document.folder ?? "", tokenizeDocumentText),
	);
	const tagFamilyTexts = dedupeSorted(
		splitTagValues(tagsText).flatMap((tag) =>
			extractDocumentFamilyTexts(tag, tokenizeDocumentText),
		),
	);
	const bodyBlocks = splitBodyBlocksWithDocumentTokenizer(
		contentText,
		tokenizeDocumentText,
	).map<PreparedBodyBlock>((block) => ({
		docId,
		ordinal: block.ordinal,
		summaryFamilyTexts: dedupeSorted(block.familyTexts),
		exactFamilyTexts: block.exactFamilyTexts,
		hanWitnessTexts: dedupeSorted(block.hanWitnessTexts),
		hanBigramIds: dedupeSorted(block.hanBigramTexts).map(encodeHanBigramId),
	}));
	const identityHanWitnessTexts = dedupeSorted([
		...extractHanSegments(document.basename ?? ""),
		...extractHanSegments(aliasesText),
	]);
	const routeHanWitnessTexts = dedupeSorted([
		...extractHanSegments(document.folder ?? ""),
		...splitTagValues(tagsText).flatMap((tag) => extractHanSegments(tag)),
	]);
	const headingHanWitnessTexts = dedupeSorted(extractHanSegments(headingsText));
	return {
		path: document.path,
		generation: document.generation ?? 1,
		basename: document.basename ?? "",
		folder: document.folder ?? "",
		basenameFamilyTexts,
		aliasFamilyTexts,
		identityFamilyTexts: dedupeSorted([...basenameFamilyTexts, ...aliasFamilyTexts]),
		identitySourceMasks: buildDocMetadataSourceMasks(
			dedupeSorted([...basenameFamilyTexts, ...aliasFamilyTexts]),
			[
				{
					familyTexts: basenameFamilyTexts,
					mask: IDENTITY_METADATA_SOURCE_BASENAME,
				},
				{
					familyTexts: aliasFamilyTexts,
					mask: IDENTITY_METADATA_SOURCE_ALIAS,
				},
			],
		),
		folderFamilyTexts,
		tagFamilyTexts,
		routeFamilyTexts: dedupeSorted([...folderFamilyTexts, ...tagFamilyTexts]),
		routeSourceMasks: buildDocMetadataSourceMasks(
			dedupeSorted([...folderFamilyTexts, ...tagFamilyTexts]),
			[
				{
					familyTexts: tagFamilyTexts,
					mask: ROUTE_METADATA_SOURCE_TAG,
				},
				{
					familyTexts: folderFamilyTexts,
					mask: ROUTE_METADATA_SOURCE_FOLDER,
				},
			],
		),
		headingFamilyTexts: dedupeSorted(
			extractDocumentFamilyTexts(headingsText, tokenizeDocumentText),
		),
		identityHanWitnessTexts,
		routeHanWitnessTexts,
		headingHanWitnessTexts,
		identityHanBigramIds: dedupeSorted([
			...extractHanBigrams(document.basename ?? ""),
			...extractHanBigrams(aliasesText),
		]).map(encodeHanBigramId),
		routeHanBigramIds: dedupeSorted([
			...extractHanBigrams(document.folder ?? ""),
			...splitTagValues(tagsText).flatMap((tag) => extractHanBigrams(tag)),
		]).map(encodeHanBigramId),
		bodyBlocks,
	};
}

function collectFamilySourceMasks(
	documents: readonly PreparedDocument[],
): Map<string, number> {
	const familySourceMaskByText = new Map<string, number>();
	for (const document of documents) {
		mergeSourceMask(
			familySourceMaskByText,
			document.identityFamilyTexts,
			SOURCE_MASK_IDENTITY,
		);
		mergeSourceMask(
			familySourceMaskByText,
			document.routeFamilyTexts,
			SOURCE_MASK_ROUTE,
		);
		mergeSourceMask(
			familySourceMaskByText,
			document.headingFamilyTexts,
			SOURCE_MASK_HEADING,
		);
		for (const block of document.bodyBlocks) {
			mergeSourceMask(
				familySourceMaskByText,
				block.summaryFamilyTexts,
				SOURCE_MASK_BODY,
			);
		}
	}
	return familySourceMaskByText;
}

function buildResidentHanRoute(
	documents: readonly PreparedDocument[],
	stringArenaBuilder: StringArenaBuilder,
) {
	const identityWitnessStringIdsByDoc = documents.map((document) =>
		mapStringsToStringIds(
			document.identityHanWitnessTexts,
			stringArenaBuilder,
			STRING_SOURCE_IDENTITY_WITNESS,
		),
	);
	const routeWitnessStringIdsByDoc = documents.map((document) =>
		mapStringsToStringIds(
			document.routeHanWitnessTexts,
			stringArenaBuilder,
			STRING_SOURCE_ROUTE_WITNESS,
		),
	);
	const headingWitnessStringIdsByDoc = documents.map((document) =>
		mapStringsToStringIds(
			document.headingHanWitnessTexts,
			stringArenaBuilder,
			STRING_SOURCE_HEADING_WITNESS,
		),
	);
	const bodyWitnessStringIdsByBlock = documents.flatMap((document) =>
		document.bodyBlocks.map((block) =>
			mapStringsToStringIds(
				block.hanWitnessTexts,
				stringArenaBuilder,
				STRING_SOURCE_BODY_WITNESS,
			),
		),
	);
	const allBodyBlocks = documents.flatMap((document) => document.bodyBlocks);
	const metadataBigramIds = dedupeSortedNumbers([
		...documents.flatMap((document) => document.identityHanBigramIds),
		...documents.flatMap((document) => document.routeHanBigramIds),
	]);
	const bodyPostingsByBigramId = new Map<number, number[]>();
	for (let blockId = 0; blockId < allBodyBlocks.length; blockId += 1) {
		for (const bigramId of allBodyBlocks[blockId]?.hanBigramIds ?? []) {
			let blockIds = bodyPostingsByBigramId.get(bigramId);
			if (!blockIds) {
				blockIds = [];
				bodyPostingsByBigramId.set(bigramId, blockIds);
			}
			blockIds.push(blockId);
		}
	}
	if (metadataBigramIds.length === 0 && bodyPostingsByBigramId.size === 0) {
		return buildHanRouteArena({
			bigramIds: [],
			metadataDocIdsByBigram: [],
			bodyPostingsByBigramId: new Map(),
			identityWitnessStringIdsByDoc,
			routeWitnessStringIdsByDoc,
			headingWitnessStringIdsByDoc,
			bodyWitnessStringIdsByBlock,
		});
	}
	const metadataBigramIndexById = new Map(
		metadataBigramIds.map((bigramId, index) => [bigramId, index]),
	);
	const metadataDocIdsByBigram = Array.from(
		{ length: metadataBigramIds.length },
		() => [] as number[],
	);
	for (let docId = 0; docId < documents.length; docId += 1) {
		const document = documents[docId];
		pushBigramPostings(
			metadataDocIdsByBigram,
			dedupeSortedNumbers([
				...document.identityHanBigramIds,
				...document.routeHanBigramIds,
			]),
			docId,
			metadataBigramIndexById,
		);
	}
	return buildHanRouteArena({
		bigramIds: metadataBigramIds,
		metadataDocIdsByBigram,
		bodyPostingsByBigramId,
		identityWitnessStringIdsByDoc,
		routeWitnessStringIdsByDoc,
		headingWitnessStringIdsByDoc,
		bodyWitnessStringIdsByBlock,
	});
}
function mergeSourceMask(
	target: Map<string, number>,
	familyTexts: readonly string[],
	mask: number,
): void {
	for (const familyText of familyTexts) {
		target.set(familyText, (target.get(familyText) ?? 0) | mask);
	}
}

function mapFamilyTextsToIds(
	familyTexts: readonly string[],
	familyIdByText: ReadonlyMap<string, number>,
): number[] {
	return familyTexts
		.map((familyText) => familyIdByText.get(familyText))
		.filter((familyId): familyId is number => familyId !== undefined);
}

function buildDocMetadataSourceMasks(
	familyTexts: readonly string[],
	sourceEntries: readonly Readonly<{
		familyTexts: readonly string[];
		mask: number;
	}>[],
): number[] {
	const sourceMaskByFamilyText = new Map<string, number>();
	for (const entry of sourceEntries) {
		mergeSourceMask(sourceMaskByFamilyText, entry.familyTexts, entry.mask);
	}
	return familyTexts.map((familyText) => sourceMaskByFamilyText.get(familyText) ?? 0);
}

function mapStringsToStringIds(
	values: readonly string[],
	stringArenaBuilder: StringArenaBuilder,
	sourceMask: number,
): number[] {
	return values.map((value) => stringArenaBuilder.intern(value, sourceMask));
}

function computeIndexedSurfaceUtf8Bytes(
	documents: readonly IndexedDocument[],
): number {
	return documents.reduce(
		(total, document) =>
			total +
			estimateUtf8Bytes(document.basename ?? "") +
			estimateUtf8Bytes(document.folder ?? "") +
			estimateUtf8Bytes(document.aliases ?? "") +
			estimateUtf8Bytes(document.tags ?? "") +
			estimateUtf8Bytes(document.headings ?? "") +
			estimateUtf8Bytes(document.content ?? ""),
		0,
	);
}

function computeRawMarkdownUtf8Bytes(
	documents: readonly IndexedDocument[],
): number {
	return documents.reduce((total, document) => {
		if (typeof document.size === "number" && document.size > 0) {
			return total + document.size;
		}
		const rawProjection = [
			document.aliases ?? "",
			document.tags ?? "",
			document.headings ?? "",
			document.content ?? "",
		]
			.filter((value) => value.length > 0)
			.join("\n");
		return total + estimateUtf8Bytes(rawProjection);
	}, 0);
}

function dedupeSorted(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) =>
		left.localeCompare(right),
	);
}

function dedupeSortedNumbers(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function pushBigramPostings(
	postingsByBigram: number[][],
	bigramIds: readonly number[],
	value: number,
	bigramIndexById: ReadonlyMap<number, number>,
): void {
	for (const bigramId of bigramIds) {
		const bigramIndex = bigramIndexById.get(bigramId);
		if (bigramIndex === undefined) {
			continue;
		}
		postingsByBigram[bigramIndex].push(value);
	}
}

function estimateUtf8Bytes(text: string): number {
	return textEncoder.encode(text).byteLength;
}

class StringArenaBuilder {
	private readonly stringIdByValue = new Map<string, number>();

	private readonly values: string[] = [];

	private readonly sourceMasksByStringId: number[] = [];

	intern(value: string, sourceMask = 0): number {
		const existingId = this.stringIdByValue.get(value);
		if (existingId !== undefined) {
			this.sourceMasksByStringId[existingId] =
				(this.sourceMasksByStringId[existingId] ?? 0) | sourceMask;
			return existingId;
		}
		const stringId = this.values.length;
		this.values.push(value);
		this.sourceMasksByStringId.push(sourceMask);
		this.stringIdByValue.set(value, stringId);
		return stringId;
	}

	describeSourceUtf8Bytes() {
		let pathBytes = 0;
		let familyBytes = 0;
		let identityWitnessBytes = 0;
		let routeWitnessBytes = 0;
		let headingWitnessBytes = 0;
		let bodyWitnessBytes = 0;
		let multiSourceBytes = 0;
		let unattributedBytes = 0;
		for (let stringId = 0; stringId < this.values.length; stringId += 1) {
			const value = this.values[stringId] ?? "";
			const mask = this.sourceMasksByStringId[stringId] ?? 0;
			const bytes = estimateUtf8Bytes(value);
			if (mask === 0) {
				unattributedBytes += bytes;
				continue;
			}
			if ((mask & (mask - 1)) !== 0) {
				multiSourceBytes += bytes;
				continue;
			}
			switch (mask) {
				case STRING_SOURCE_PATH:
					pathBytes += bytes;
					break;
				case STRING_SOURCE_FAMILY:
					familyBytes += bytes;
					break;
				case STRING_SOURCE_IDENTITY_WITNESS:
					identityWitnessBytes += bytes;
					break;
				case STRING_SOURCE_ROUTE_WITNESS:
					routeWitnessBytes += bytes;
					break;
				case STRING_SOURCE_HEADING_WITNESS:
					headingWitnessBytes += bytes;
					break;
				case STRING_SOURCE_BODY_WITNESS:
					bodyWitnessBytes += bytes;
					break;
				default:
					multiSourceBytes += bytes;
					break;
			}
		}
		return {
			pathBytes,
			familyBytes,
			identityWitnessBytes,
			routeWitnessBytes,
			headingWitnessBytes,
			bodyWitnessBytes,
			multiSourceBytes,
			unattributedBytes,
		} as const;
	}

	build() {
		const offsets: number[] = [];
		const lengths: number[] = [];
		let text = "";
		for (const value of this.values) {
			offsets.push(text.length);
			lengths.push(value.length);
			text += value;
		}
		return {
			text,
			offsets: buildIntegerArray(offsets),
			lengths: buildIntegerArray(lengths),
			count: this.values.length,
		} as const;
	}
}


