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

type PreparedDocument = Readonly<{
	path: string;
	generation: number;
	basename: string;
	folder: string;
	identityFamilyTexts: readonly string[];
	routeFamilyTexts: readonly string[];
	headingFamilyTexts: readonly string[];
	identityHanWitnessTexts: readonly string[];
	routeHanWitnessTexts: readonly string[];
	headingHanWitnessTexts: readonly string[];
	identityHanBigramIds: readonly number[];
	routeHanBigramIds: readonly number[];
	headingHanBigramIds: readonly number[];
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

export function buildResidentBase(
	documents: readonly IndexedDocument[],
	tokenizeDocumentText?: V3DocumentTokenizer,
): ResidentBase {
	const stringArenaBuilder = new StringArenaBuilder();
	const preparedDocuments = [...documents]
		.sort((left, right) => left.path.localeCompare(right.path))
		.map((document, docId) =>
			prepareDocument(document, docId, tokenizeDocumentText),
		);
	const familySourceMaskByText = collectFamilySourceMasks(preparedDocuments);
	const witnessTexts = collectWitnessTexts(preparedDocuments);
	const familyTexts = dedupeSorted([
		...familySourceMaskByText.keys(),
		...witnessTexts,
	]).sort((left, right) =>
		left.localeCompare(right),
	);
	const familyIdByText = new Map<string, number>();
	const familyLexicon = buildFamilyLexicon(
		familyTexts.map((text, familyId) => {
			familyIdByText.set(text, familyId);
			return {
				text,
				stringId: stringArenaBuilder.intern(text),
				sourceMask: familySourceMaskByText.get(text) ?? 0,
			};
		}),
	);

	const identityFamilyIdsByDoc = preparedDocuments.map((document) =>
		mapFamilyTextsToIds(document.identityFamilyTexts, familyIdByText),
	);
	const routeFamilyIdsByDoc = preparedDocuments.map((document) =>
		mapFamilyTextsToIds(document.routeFamilyTexts, familyIdByText),
	);
	const headingFamilyIdsByDoc = preparedDocuments.map((document) =>
		mapFamilyTextsToIds(document.headingFamilyTexts, familyIdByText),
	);
	const metadataContainers = buildMetadataContainerArena({
		familyCount: familyLexicon.familyCount,
		identityFamilyIdsByDoc,
		routeFamilyIdsByDoc,
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
		familyCount: familyLexicon.familyCount,
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
			pathStringId: stringArenaBuilder.intern(document.path),
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

	const stringArena = stringArenaBuilder.build();
	const hanRoute = buildResidentHanRoute(
		preparedDocuments,
		bodyBlocks,
		familyIdByText,
	);
	const metrics = buildResidentBaseMetrics({
		stringArena,
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
		identityFamilyTexts: dedupeSorted([
			...extractDocumentFamilyTexts(document.basename ?? "", tokenizeDocumentText),
			...extractDocumentFamilyTexts(aliasesText, tokenizeDocumentText),
		]),
		routeFamilyTexts: dedupeSorted([
			...extractDocumentFamilyTexts(document.folder ?? "", tokenizeDocumentText),
			...splitTagValues(tagsText).flatMap((tag) =>
				extractDocumentFamilyTexts(tag, tokenizeDocumentText),
			),
		]),
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
		headingHanBigramIds: dedupeSorted(extractHanBigrams(headingsText)).map(
			encodeHanBigramId,
		),
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

function collectWitnessTexts(documents: readonly PreparedDocument[]): string[] {
	const out: string[] = [];
	for (const document of documents) {
		out.push(...document.identityHanWitnessTexts);
		out.push(...document.routeHanWitnessTexts);
		out.push(...document.headingHanWitnessTexts);
		for (const block of document.bodyBlocks) {
			out.push(...block.hanWitnessTexts);
		}
	}
	return out;
}

function buildResidentHanRoute(
	documents: readonly PreparedDocument[],
	bodyBlocks: Readonly<{
		blockCount: number;
	}>,
	familyIdByText: ReadonlyMap<string, number>,
) {
	const identityWitnessFamilyIdsByDoc = documents.map((document) =>
		mapFamilyTextsToIds(document.identityHanWitnessTexts, familyIdByText),
	);
	const routeWitnessFamilyIdsByDoc = documents.map((document) =>
		mapFamilyTextsToIds(document.routeHanWitnessTexts, familyIdByText),
	);
	const headingWitnessFamilyIdsByDoc = documents.map((document) =>
		mapFamilyTextsToIds(document.headingHanWitnessTexts, familyIdByText),
	);
	const bodyWitnessFamilyIdsByBlock = documents.flatMap((document) =>
		document.bodyBlocks.map((block) =>
			mapFamilyTextsToIds(block.hanWitnessTexts, familyIdByText),
		),
	);
	const allBigramIds = dedupeSortedNumbers([
		...documents.flatMap((document) => document.identityHanBigramIds),
		...documents.flatMap((document) => document.routeHanBigramIds),
		...documents.flatMap((document) => document.headingHanBigramIds),
		...documents.flatMap((document) =>
			document.bodyBlocks.flatMap((block) => block.hanBigramIds),
		),
	]);
	if (allBigramIds.length === 0) {
		return buildHanRouteArena({
			bigramIds: [],
			metadataDocIdsByBigram: [],
			bodyBlockIdsByBigram: [],
			identityWitnessFamilyIdsByDoc,
			routeWitnessFamilyIdsByDoc,
			headingWitnessFamilyIdsByDoc,
			bodyWitnessFamilyIdsByBlock,
		});
	}
	const bigramIndexById = new Map(allBigramIds.map((bigramId, index) => [bigramId, index]));
	const metadataDocIdsByBigram = Array.from(
		{ length: allBigramIds.length },
		() => [] as number[],
	);
	const bodyBlockIdsByBigram = Array.from(
		{ length: allBigramIds.length },
		() => [] as number[],
	);
	let globalBlockId = 0;
	for (let docId = 0; docId < documents.length; docId += 1) {
		const document = documents[docId];
		pushBigramPostings(
			metadataDocIdsByBigram,
			dedupeSortedNumbers([
				...document.identityHanBigramIds,
				...document.routeHanBigramIds,
				...document.headingHanBigramIds,
			]),
			docId,
			bigramIndexById,
		);
		for (const block of document.bodyBlocks) {
			pushBigramPostings(bodyBlockIdsByBigram, block.hanBigramIds, globalBlockId, bigramIndexById);
			globalBlockId += 1;
		}
	}
	return buildHanRouteArena({
		bigramIds: allBigramIds,
		metadataDocIdsByBigram,
		bodyBlockIdsByBigram,
		identityWitnessFamilyIdsByDoc,
		routeWitnessFamilyIdsByDoc,
		headingWitnessFamilyIdsByDoc,
		bodyWitnessFamilyIdsByBlock,
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

	intern(value: string): number {
		const existingId = this.stringIdByValue.get(value);
		if (existingId !== undefined) {
			return existingId;
		}
		const stringId = this.values.length;
		this.values.push(value);
		this.stringIdByValue.set(value, stringId);
		return stringId;
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
