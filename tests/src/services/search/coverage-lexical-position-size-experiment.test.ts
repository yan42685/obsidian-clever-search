import { container } from "tsyringe";

import {
	decodeCoverageLexicalSnapshotV1,
	encodeCoverageLexicalSnapshotV1,
	type CoverageLexicalSnapshotState,
} from "src/services/search/coverage-lexical/coverage-lexical-snapshot";
import {
	COVERAGE_LEXICAL_POSTING_DESCRIPTORS,
	CoverageLexicalSnapshotSectionKind,
} from "src/services/search/coverage-lexical/coverage-lexical-posting-layout";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = "1";

const {
	createAutomationCorpus,
	createMockTokenizer,
} = require("./coverage-lexical-legacy-automation-benchmark.bench") as {
	createAutomationCorpus(): {
		documents: Array<{
			path: string;
			basename: string;
			folder: string;
			content?: string;
			aliases?: string;
			tags?: string;
			headings?: string;
		}>;
	};
	createMockTokenizer(): {
		tokenize(text: string, mode?: "index" | "search"): string[];
		tokenizeSequence(text: string, mode?: "index" | "search"): string[];
	};
};

type MockTokenizer = {
	tokenize(text: string, mode?: "index" | "search"): string[];
	tokenizeSequence(text: string, mode?: "index" | "search"): string[];
};

type CoverageLexicalBinarySnapshot = {
	__backend: "coverage-lexical";
	__version: 2;
	__encoding: "binary-snapshot-v2";
	data: ArrayBuffer;
};

const SNAPSHOT_MAGIC = [0x43, 0x4c, 0x58, 0x53] as const;
const HEADER_BYTES = 12;
const DIRECTORY_ENTRY_BYTES = 16;
const INDUSTRIAL_FIELDS = [
	"body",
	"alias",
	"basename",
	"folder",
	"heading",
	"tag",
] as const;
const CLASSIC_BM25_LEXICON_POSTING_KEYS = new Set([
	"bodyPostings",
	"metadataAliasPostings",
	"metadataBasenamePostings",
	"metadataFolderPostings",
	"metadataHeadingPostings",
	"metadataTagPostings",
]);
const POSITIONAL_POSTING_KEYS = [
	"metadataAliasPhrasePostings",
	"metadataBasenamePhrasePostings",
	"metadataFolderPhrasePostings",
	"metadataHeadingPhrasePostings",
	"metadataTagPhrasePostings",
	"bodyHanSegmentPostings",
	"metadataAliasHanSegmentPostings",
	"metadataBasenameHanSegmentPostings",
	"metadataFolderHanSegmentPostings",
	"metadataHeadingHanSegmentPostings",
] as const;
const POSITIONAL_SECTION_KINDS = [
	CoverageLexicalSnapshotSectionKind.BodyTokenLexicon,
	CoverageLexicalSnapshotSectionKind.MetadataAliasPhrasePostings,
	CoverageLexicalSnapshotSectionKind.MetadataBasenamePhrasePostings,
	CoverageLexicalSnapshotSectionKind.MetadataFolderPhrasePostings,
	CoverageLexicalSnapshotSectionKind.MetadataHeadingPhrasePostings,
	CoverageLexicalSnapshotSectionKind.MetadataTagPhrasePostings,
	CoverageLexicalSnapshotSectionKind.BodyHanSegmentPostings,
	CoverageLexicalSnapshotSectionKind.MetadataAliasHanSegmentPostings,
	CoverageLexicalSnapshotSectionKind.MetadataBasenameHanSegmentPostings,
	CoverageLexicalSnapshotSectionKind.MetadataFolderHanSegmentPostings,
	CoverageLexicalSnapshotSectionKind.MetadataHeadingHanSegmentPostings,
] as const;

type IndustrialFieldName = (typeof INDUSTRIAL_FIELDS)[number];

type IndustrialPostingEntry = {
	docId: number;
	tf: number;
};

type IndustrialModelEstimate = {
	name: string;
	fields: readonly IndustrialFieldName[];
	dictionaryEncoding: "front-coded" | "aggressive-fst-like";
	pointerEncoding: "absolute-varint" | "delta-varint";
	postingEncoding: "varint" | "block-packed";
	termCount: number;
	postingListCount: number;
	postingEntryCount: number;
	dictionaryBytes: number;
	dictionaryPointerBytes: number;
	postingsBytes: number;
	normBytes: number;
	storedPathBytes: number;
	totalBytes: number;
	coreIndexBytes: number;
	byField: Record<
		IndustrialFieldName,
		{
			termCount: number;
			postingListCount: number;
			postingEntryCount: number;
			postingsBytes: number;
		}
	>;
};

function resetContainer(): void {
	if ("reset" in container && typeof (container as any).reset === "function") {
		(container as any).reset();
		return;
	}
	container.clearInstances();
}

function installWindowMock(): void {
	(global as any).window = {
		localStorage: {
			getItem: jest.fn(() => "zh"),
			setItem: jest.fn(),
			removeItem: jest.fn(),
		},
	};
}

function removeWindowMock(): void {
	delete (global as any).window;
}

function createCoverageLexicalEngine(): {
	addDocuments(documents: Array<{
		path: string;
		basename: string;
		folder: string;
		content?: string;
		aliases?: string;
		tags?: string;
		headings?: string;
	}>): Promise<void>;
	serialize(): CoverageLexicalBinarySnapshot | null;
	estimateIndexBytes(): number | null;
} {
	const {
		OuterSetting,
		DEFAULT_OUTER_SETTING,
	} = require("src/globals/plugin-setting");
	const { CoverageLexicalFileSearchEngine } = require(
		"src/services/search/coverage-lexical/coverage-lexical-engine",
	) as {
		CoverageLexicalFileSearchEngine: new () => {
			addDocuments(documents: Array<{
				path: string;
				basename: string;
				folder: string;
				content?: string;
				aliases?: string;
				tags?: string;
				headings?: string;
			}>): Promise<void>;
			serialize(): CoverageLexicalBinarySnapshot | null;
			estimateIndexBytes(): number | null;
		};
	};
	const tokenizer = createMockTokenizer();
	const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));

	setting.fileSearchBackend = "coverage-lexical";
	setting.isCaseSensitive = false;
	setting.enableChinesePatch = false;
	setting.isUseOnlyFileName = false;

	container.register(OuterSetting, { useValue: setting });
	container.register(Tokenizer, { useValue: tokenizer });

	return new CoverageLexicalFileSearchEngine();
}

function round(value: number, digits = 6): number {
	return Number(value.toFixed(digits));
}

function estimateVarUintBytes(value: number): number {
	let remaining = Math.max(0, value >>> 0);
	let bytes = 1;
	while (remaining >= 0x80) {
		remaining >>>= 7;
		bytes += 1;
	}
	return bytes;
}

function parseSnapshotSections(data: ArrayBuffer): Map<number, { offset: number; length: number; count: number }> {
	const bytes = new Uint8Array(data);
	const view = new DataView(data);

	for (let index = 0; index < SNAPSHOT_MAGIC.length; index += 1) {
		if (bytes[index] !== SNAPSHOT_MAGIC[index]) {
			throw new Error("Invalid coverage lexical snapshot magic");
		}
	}

	const sectionCount = view.getUint32(8, true);
	const sections = new Map<number, { offset: number; length: number; count: number }>();

	for (let index = 0; index < sectionCount; index += 1) {
		const baseOffset = HEADER_BYTES + index * DIRECTORY_ENTRY_BYTES;
		const kind = view.getUint32(baseOffset, true);
		sections.set(kind, {
			offset: view.getUint32(baseOffset + 4, true),
			length: view.getUint32(baseOffset + 8, true),
			count: view.getUint32(baseOffset + 12, true),
		});
	}

	return sections;
}

function countUtf8Bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function estimateRawCorpusBytes(documents: Array<{
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
}>): {
	bodyTextBytes: number;
	allIndexedTextBytes: number;
	allDocumentTextBytesExcludingPath: number;
} {
	let bodyTextBytes = 0;
	let allIndexedTextBytes = 0;
	let allDocumentTextBytesExcludingPath = 0;

	for (const document of documents) {
		const contentBytes = countUtf8Bytes(document.content ?? "");
		const basenameBytes = countUtf8Bytes(document.basename);
		const folderBytes = countUtf8Bytes(document.folder);
		const aliasesBytes = countUtf8Bytes(document.aliases ?? "");
		const tagsBytes = countUtf8Bytes(document.tags ?? "");
		const headingsBytes = countUtf8Bytes(document.headings ?? "");
		const pathBytes = countUtf8Bytes(document.path);

		bodyTextBytes += contentBytes;
		allDocumentTextBytesExcludingPath +=
			contentBytes +
			basenameBytes +
			folderBytes +
			aliasesBytes +
			tagsBytes +
			headingsBytes;
		allIndexedTextBytes +=
			contentBytes +
			basenameBytes +
			folderBytes +
			aliasesBytes +
			tagsBytes +
			headingsBytes +
			pathBytes;
	}

	return {
		bodyTextBytes,
		allIndexedTextBytes,
		allDocumentTextBytesExcludingPath,
	};
}

function sharedPrefixLength(left: string, right: string): number {
	const max = Math.min(left.length, right.length);
	let index = 0;
	while (index < max && left[index] === right[index]) {
		index += 1;
	}
	return index;
}

function estimateFrontCodedDictionaryBytes(
	terms: readonly string[],
	blockSize = 16,
): number {
	let total = 0;

	for (let blockStart = 0; blockStart < terms.length; blockStart += blockSize) {
		const blockTerms = terms.slice(blockStart, blockStart + blockSize);
		if (blockTerms.length === 0) {
			continue;
		}
		total += 1;
		const first = blockTerms[0];
		const firstBytes = countUtf8Bytes(first);
		total += estimateVarUintBytes(firstBytes) + firstBytes;
		for (let index = 1; index < blockTerms.length; index += 1) {
			const term = blockTerms[index];
			const prefixLength = sharedPrefixLength(blockTerms[index - 1], term);
			const suffix = term.slice(prefixLength);
			const suffixBytes = countUtf8Bytes(suffix);
			total += estimateVarUintBytes(prefixLength);
			total += estimateVarUintBytes(suffixBytes);
			total += suffixBytes;
		}
	}

	return total;
}

function estimateAggressiveFstLikeDictionaryBytes(
	terms: readonly string[],
): number {
	const frontCodedBytes = estimateFrontCodedDictionaryBytes(terms, 32);
	return Math.max(64, Math.ceil(frontCodedBytes * 0.72));
}

function buildLexiconFromPostingKeys(
	state: CoverageLexicalSnapshotState,
	postingKeys: ReadonlySet<string>,
): string[] {
	const terms = new Set<string>();

	for (const descriptor of COVERAGE_LEXICAL_POSTING_DESCRIPTORS) {
		if (!postingKeys.has(descriptor.key)) {
			continue;
		}
		for (const term of state[descriptor.key].keys()) {
			terms.add(term);
		}
	}

	return [...terms].sort((left, right) => left.localeCompare(right));
}

function createNoBodyTokenSequenceState(
	state: CoverageLexicalSnapshotState,
): CoverageLexicalSnapshotState {
	return {
		...state,
		documents: state.documents.map((document) => ({
			...document,
			bodyTokenIds: [],
		})),
	};
}

function createClassicBm25LikeState(
	state: CoverageLexicalSnapshotState,
): CoverageLexicalSnapshotState {
	const nextState: CoverageLexicalSnapshotState = {
		...state,
		sortedLexicon: buildLexiconFromPostingKeys(
			state,
			CLASSIC_BM25_LEXICON_POSTING_KEYS,
		),
		bodyTokenLexicon: [],
		documents: state.documents.map((document) => ({
			...document,
			bodyTokenIds: [],
			bodyHanSegments: [],
		})),
	};

	for (const key of POSITIONAL_POSTING_KEYS) {
		(nextState as any)[key] = new Map();
	}

	return nextState;
}

function getSectionLength(
	sections: ReadonlyMap<number, { offset: number; length: number; count: number }>,
	kind: number,
): number {
	return sections.get(kind)?.length ?? 0;
}

function sumSectionLengths(
	sections: ReadonlyMap<number, { offset: number; length: number; count: number }>,
	kinds: readonly number[],
): number {
	return kinds.reduce((sum, kind) => sum + getSectionLength(sections, kind), 0);
}

function decodeBodyTokens(
	document: CoverageLexicalSnapshotState["documents"][number],
	bodyTokenLexicon: readonly string[],
): string[] {
	return document.bodyTokenIds.map((tokenId) => {
		const token = bodyTokenLexicon[tokenId];
		if (token === undefined) {
			throw new Error(`Missing body token for token id ${tokenId}`);
		}
		return token;
	});
}

function tokenizeNormalized(
	tokenizer: MockTokenizer,
	text: string,
): string[] {
	return tokenizer
		.tokenizeSequence(text, "index")
		.map((term) => term.toLowerCase());
}

function countTokens(tokens: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const token of tokens) {
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	return counts;
}

function buildIndustrialPostingMaps(
	state: CoverageLexicalSnapshotState,
	tokenizer: MockTokenizer,
	fields: readonly IndustrialFieldName[] = INDUSTRIAL_FIELDS,
): Record<IndustrialFieldName, Map<string, IndustrialPostingEntry[]>> {
	const postingMaps = Object.fromEntries(
		INDUSTRIAL_FIELDS.map((field) => [field, new Map<string, IndustrialPostingEntry[]>()]),
	) as Record<IndustrialFieldName, Map<string, IndustrialPostingEntry[]>>;

	for (const document of state.documents) {
		const fieldTokens: Record<IndustrialFieldName, string[]> = {
			body: decodeBodyTokens(document, state.bodyTokenLexicon),
			alias: tokenizeNormalized(tokenizer, document.aliasesText),
			basename: tokenizeNormalized(tokenizer, document.basenameText),
			folder: tokenizeNormalized(tokenizer, document.folderText),
			heading: tokenizeNormalized(tokenizer, document.headingsText),
			tag: tokenizeNormalized(tokenizer, document.tagsText),
		};

		for (const field of fields) {
			const termCounts = countTokens(fieldTokens[field]);
			for (const [term, tf] of termCounts.entries()) {
				const postings = postingMaps[field].get(term) ?? [];
				postings.push({ docId: document.docId, tf });
				postingMaps[field].set(term, postings);
			}
		}
	}

	for (const field of fields) {
		for (const postings of postingMaps[field].values()) {
			postings.sort((left, right) => left.docId - right.docId);
		}
	}

	return postingMaps;
}

function estimateIndustrialPostingListBytes(
	postings: readonly IndustrialPostingEntry[],
): number {
	let total = estimateVarUintBytes(postings.length);
	let previousDocId = 0;

	for (const entry of postings) {
		total += estimateVarUintBytes(entry.docId - previousDocId);
		total += estimateVarUintBytes(entry.tf);
		previousDocId = entry.docId;
	}

	if (postings.length >= 32) {
		total += Math.floor(postings.length / 32) * 4;
	}

	return total;
}

function estimatePackedIntegerBlockBytes(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	let maxValue = 0;
	for (const value of values) {
		if (value > maxValue) {
			maxValue = value;
		}
	}
	const bitWidth =
		maxValue <= 0 ? 0 : Math.max(1, Math.ceil(Math.log2(maxValue + 1)));
	return 1 + Math.ceil((bitWidth * values.length) / 8);
}

function estimateBlockPackedPostingListBytes(
	postings: readonly IndustrialPostingEntry[],
	blockSize = 128,
): number {
	let total = estimateVarUintBytes(postings.length);
	const docDeltas: number[] = [];
	const freqsMinusOne: number[] = [];
	let previousDocId = 0;
	let allTfOne = true;

	for (const entry of postings) {
		docDeltas.push(entry.docId - previousDocId);
		freqsMinusOne.push(Math.max(0, entry.tf - 1));
		if (entry.tf !== 1) {
			allTfOne = false;
		}
		previousDocId = entry.docId;
	}

	for (let start = 0; start < docDeltas.length; start += blockSize) {
		const block = docDeltas.slice(start, start + blockSize);
		total += estimatePackedIntegerBlockBytes(block);
	}

	total += 1;
	if (!allTfOne) {
		for (let start = 0; start < freqsMinusOne.length; start += blockSize) {
			const block = freqsMinusOne.slice(start, start + blockSize);
			total += estimatePackedIntegerBlockBytes(block);
		}
	}

	if (postings.length >= 128) {
		total += Math.floor(postings.length / 128) * 4;
	}

	return total;
}

function estimatePointerBytes(
	offsets: readonly number[],
	mode: "absolute-varint" | "delta-varint",
): number {
	if (mode === "absolute-varint") {
		return offsets.reduce(
			(sum, offset) => sum + estimateVarUintBytes(offset),
			0,
		);
	}

	let total = 0;
	let previousOffset = 0;
	for (const offset of offsets) {
		total += estimateVarUintBytes(offset - previousOffset);
		previousOffset = offset;
	}
	return total;
}

function estimateIndustrialBm25LikeBytes(
	state: CoverageLexicalSnapshotState,
	tokenizer: MockTokenizer,
	options: {
		name: string;
		fields: readonly IndustrialFieldName[];
		includeStoredPathBytes: boolean;
		dictionaryEncoding?: "front-coded" | "aggressive-fst-like";
		pointerEncoding?: "absolute-varint" | "delta-varint";
		postingEncoding?: "varint" | "block-packed";
	},
): IndustrialModelEstimate {
	const dictionaryEncoding = options.dictionaryEncoding ?? "front-coded";
	const pointerEncoding = options.pointerEncoding ?? "absolute-varint";
	const postingEncoding = options.postingEncoding ?? "varint";
	const postingMaps = buildIndustrialPostingMaps(
		state,
		tokenizer,
		options.fields,
	);
	const termUnion = new Set<string>();
	const offsetsByField = new Map<IndustrialFieldName, Map<string, number>>();
	const byField = Object.fromEntries(
		INDUSTRIAL_FIELDS.map((field) => [
			field,
			{
				termCount: 0,
				postingListCount: 0,
				postingEntryCount: 0,
				postingsBytes: 0,
			},
		]),
	) as IndustrialModelEstimate["byField"];

	let postingsBytes = 0;
	let postingListCount = 0;
	let postingEntryCount = 0;

	for (const field of options.fields) {
		const fieldOffsets = new Map<string, number>();
		let offset = 0;
		const entries = [...postingMaps[field].entries()].sort(([left], [right]) =>
			left.localeCompare(right),
		);

		byField[field].termCount = entries.length;
		byField[field].postingListCount = entries.length;

		for (const [term, postings] of entries) {
			termUnion.add(term);
			fieldOffsets.set(term, offset);
			const postingBytes =
				postingEncoding === "block-packed"
					? estimateBlockPackedPostingListBytes(postings)
					: estimateIndustrialPostingListBytes(postings);
			offset += postingBytes;
			postingsBytes += postingBytes;
			postingListCount += 1;
			postingEntryCount += postings.length;
			byField[field].postingEntryCount += postings.length;
			byField[field].postingsBytes += postingBytes;
		}

		offsetsByField.set(field, fieldOffsets);
	}

	const sortedTerms = [...termUnion].sort((left, right) => left.localeCompare(right));
	const dictionaryBytes =
		dictionaryEncoding === "aggressive-fst-like"
			? estimateAggressiveFstLikeDictionaryBytes(sortedTerms)
			: estimateFrontCodedDictionaryBytes(sortedTerms);
	let dictionaryPointerBytes = 0;
	const pointerOffsets: number[] = [];

	for (const term of sortedTerms) {
		let fieldMask = 0;
		for (let index = 0; index < options.fields.length; index += 1) {
			const field = options.fields[index];
			const offset = offsetsByField.get(field)?.get(term);
			if (offset === undefined) {
				continue;
			}
			fieldMask |= 1 << index;
			pointerOffsets.push(offset);
		}
		dictionaryPointerBytes += 1;
		if (fieldMask === 0) {
			throw new Error(`Industrial estimate term ${term} had no field mask`);
		}
	}
	dictionaryPointerBytes += estimatePointerBytes(pointerOffsets, pointerEncoding);

	const normBytes = state.documents.length * options.fields.length;
	const storedPathBytes = options.includeStoredPathBytes
		? estimateFrontCodedDictionaryBytes(
				state.documents
					.slice()
					.sort((left, right) => left.docId - right.docId)
					.map((document) => document.path),
				16,
			)
		: 0;
	const coreIndexBytes =
		dictionaryBytes + dictionaryPointerBytes + postingsBytes + normBytes;

	return {
		name: options.name,
		fields: [...options.fields],
		dictionaryEncoding,
		pointerEncoding,
		postingEncoding,
		termCount: sortedTerms.length,
		postingListCount,
		postingEntryCount,
		dictionaryBytes,
		dictionaryPointerBytes,
		postingsBytes,
		normBytes,
		storedPathBytes,
		coreIndexBytes,
		totalBytes: coreIndexBytes + storedPathBytes,
		byField,
	};
}

describe("coverage lexical position size experiment", () => {
	beforeEach(() => {
		resetContainer();
		installWindowMock();
	});

	afterEach(() => {
		removeWindowMock();
		resetContainer();
	});

	test("measures snapshot size for non-positional bm25-like variants", async () => {
		const { documents } = createAutomationCorpus();
		const tokenizer = createMockTokenizer() as MockTokenizer;
		const engine = createCoverageLexicalEngine();
		const rawCorpusBytes = estimateRawCorpusBytes(documents);

		await engine.addDocuments(documents);

		const serialized = engine.serialize();
		expect(serialized?.data).toBeInstanceOf(ArrayBuffer);

		const baselineSnapshot = serialized!.data;
		const baselineState = decodeCoverageLexicalSnapshotV1(baselineSnapshot);
		const noBodyTokenSequenceSnapshot = encodeCoverageLexicalSnapshotV1(
			createNoBodyTokenSequenceState(baselineState),
		);
		const classicBm25LikeSnapshot = encodeCoverageLexicalSnapshotV1(
			createClassicBm25LikeState(baselineState),
		);

		const baselineSections = parseSnapshotSections(baselineSnapshot);
		const noBodyTokenSequenceSections = parseSnapshotSections(
			noBodyTokenSequenceSnapshot,
		);
		const classicBm25LikeSections = parseSnapshotSections(classicBm25LikeSnapshot);
		const baselineDocumentsSection =
			baselineSections.get(CoverageLexicalSnapshotSectionKind.Documents);
		const noBodyTokenSequenceDocumentsSection =
			noBodyTokenSequenceSections.get(
				CoverageLexicalSnapshotSectionKind.Documents,
			);
		const classicBm25LikeDocumentsSection =
			classicBm25LikeSections.get(
				CoverageLexicalSnapshotSectionKind.Documents,
			);
		const totalBodyTokenCount = baselineState.documents.reduce(
			(sum, document) => sum + document.bodyTokenIds.length,
			0,
		);
		const baselineBytes = baselineSnapshot.byteLength;
		const noBodyTokenSequenceBytes = noBodyTokenSequenceSnapshot.byteLength;
		const classicBm25LikeBytes = classicBm25LikeSnapshot.byteLength;
		const industrialClassicBm25BodyOnlyCoreEstimate =
			estimateIndustrialBm25LikeBytes(
				baselineState,
				tokenizer,
				{
					name: "industrialClassicBm25BodyOnlyCore",
					fields: ["body"],
					includeStoredPathBytes: false,
				},
			);
		const industrialClassicBm25BodyOnlyWithPathEstimate =
			estimateIndustrialBm25LikeBytes(
				baselineState,
				tokenizer,
				{
					name: "industrialClassicBm25BodyOnlyWithPath",
					fields: ["body"],
					includeStoredPathBytes: true,
				},
			);
		const industrialClassicBm25FieldedCoreEstimate =
			estimateIndustrialBm25LikeBytes(
			baselineState,
			tokenizer,
				{
					name: "industrialClassicBm25FieldedCore",
					fields: INDUSTRIAL_FIELDS,
					includeStoredPathBytes: false,
				},
			);
		const industrialClassicBm25BodyOnlyAggressiveCoreEstimate =
			estimateIndustrialBm25LikeBytes(
				baselineState,
				tokenizer,
				{
					name: "industrialClassicBm25BodyOnlyAggressiveCore",
					fields: ["body"],
					includeStoredPathBytes: false,
					dictionaryEncoding: "aggressive-fst-like",
					pointerEncoding: "delta-varint",
					postingEncoding: "block-packed",
				},
			);
		const noBodyTokenSequenceSavedBytes =
			baselineBytes - noBodyTokenSequenceBytes;
		const classicBm25LikeSavedBytes = baselineBytes - classicBm25LikeBytes;
		const positionalSectionBytes = sumSectionLengths(
			baselineSections,
			POSITIONAL_SECTION_KINDS,
		);

		console.log(
			"[coverage-lexical-position-size-experiment] summary",
			JSON.stringify(
				{
					experiment:
						"classic bm25 lower bound uses industrial-style exact inverted index compression for body-only terms; no positions, no phrase, no fuzzy/prefix support cost",
					rawCorpusBytes,
					documentCount: baselineState.documents.length,
					totalBodyTokenCount,
					avgBodyTokensPerDocument:
						baselineState.documents.length === 0
							? 0
							: round(totalBodyTokenCount / baselineState.documents.length, 3),
					snapshots: {
						baseline: {
							bytes: baselineBytes,
							kb: round(baselineBytes / 1024, 3),
						},
						noBodyTokenSequence: {
							bytes: noBodyTokenSequenceBytes,
							kb: round(noBodyTokenSequenceBytes / 1024, 3),
							vsBaselineRatio: round(
								baselineBytes === 0
									? 0
									: noBodyTokenSequenceBytes / baselineBytes,
								6,
							),
							baselineVsVariantRatio: round(
								noBodyTokenSequenceBytes === 0
									? 0
									: baselineBytes / noBodyTokenSequenceBytes,
								6,
							),
							savedBytes: noBodyTokenSequenceSavedBytes,
							savedKB: round(noBodyTokenSequenceSavedBytes / 1024, 3),
							savedRatio: round(
								baselineBytes === 0
									? 0
									: noBodyTokenSequenceSavedBytes / baselineBytes,
								6,
							),
						},
						classicBm25Like: {
							bytes: classicBm25LikeBytes,
							kb: round(classicBm25LikeBytes / 1024, 3),
							vsBaselineRatio: round(
								baselineBytes === 0 ? 0 : classicBm25LikeBytes / baselineBytes,
								6,
							),
							baselineVsVariantRatio: round(
								classicBm25LikeBytes === 0
									? 0
									: baselineBytes / classicBm25LikeBytes,
								6,
							),
							savedBytes: classicBm25LikeSavedBytes,
							savedKB: round(classicBm25LikeSavedBytes / 1024, 3),
							savedRatio: round(
								baselineBytes === 0 ? 0 : classicBm25LikeSavedBytes / baselineBytes,
								6,
							),
						},
						industrialClassicBm25BodyOnlyCore: {
							bytes: industrialClassicBm25BodyOnlyCoreEstimate.totalBytes,
							kb: round(
								industrialClassicBm25BodyOnlyCoreEstimate.totalBytes / 1024,
								3,
							),
							vsBaselineRatio: round(
								baselineBytes === 0
									? 0
									:
										industrialClassicBm25BodyOnlyCoreEstimate.totalBytes /
										baselineBytes,
								6,
							),
							baselineVsVariantRatio: round(
								industrialClassicBm25BodyOnlyCoreEstimate.totalBytes === 0
									? 0
									:
										baselineBytes /
										industrialClassicBm25BodyOnlyCoreEstimate.totalBytes,
								6,
							),
							savedBytes:
								baselineBytes -
								industrialClassicBm25BodyOnlyCoreEstimate.totalBytes,
							savedKB: round(
								(
									baselineBytes -
									industrialClassicBm25BodyOnlyCoreEstimate.totalBytes
								) / 1024,
								3,
							),
							savedRatio: round(
								baselineBytes === 0
									? 0
									:
										(
											baselineBytes -
											industrialClassicBm25BodyOnlyCoreEstimate.totalBytes
										) /
										baselineBytes,
								6,
							),
							vsRawBodyRatio: round(
								rawCorpusBytes.bodyTextBytes === 0
									? 0
									:
										industrialClassicBm25BodyOnlyCoreEstimate.totalBytes /
										rawCorpusBytes.bodyTextBytes,
								6,
							),
							rawBodyVsIndexRatio: round(
								industrialClassicBm25BodyOnlyCoreEstimate.totalBytes === 0
									? 0
									:
										rawCorpusBytes.bodyTextBytes /
										industrialClassicBm25BodyOnlyCoreEstimate.totalBytes,
								6,
							),
							coreIndexBytes:
								industrialClassicBm25BodyOnlyCoreEstimate.coreIndexBytes,
							coreIndexKB: round(
								industrialClassicBm25BodyOnlyCoreEstimate.coreIndexBytes / 1024,
								3,
							),
							coreIndexVsBaselineRatio: round(
								baselineBytes === 0
									? 0
									:
										industrialClassicBm25BodyOnlyCoreEstimate.coreIndexBytes /
										baselineBytes,
								6,
							),
						},
						industrialClassicBm25BodyOnlyWithPath: {
							bytes: industrialClassicBm25BodyOnlyWithPathEstimate.totalBytes,
							kb: round(
								industrialClassicBm25BodyOnlyWithPathEstimate.totalBytes / 1024,
								3,
							),
							vsBaselineRatio: round(
								baselineBytes === 0
									? 0
									:
										industrialClassicBm25BodyOnlyWithPathEstimate.totalBytes /
										baselineBytes,
								6,
							),
							vsRawBodyRatio: round(
								rawCorpusBytes.bodyTextBytes === 0
									? 0
									:
										industrialClassicBm25BodyOnlyWithPathEstimate.totalBytes /
										rawCorpusBytes.bodyTextBytes,
								6,
							),
						},
						industrialClassicBm25FieldedCore: {
							bytes: industrialClassicBm25FieldedCoreEstimate.totalBytes,
							kb: round(
								industrialClassicBm25FieldedCoreEstimate.totalBytes / 1024,
								3,
							),
							vsBaselineRatio: round(
								baselineBytes === 0
									? 0
									:
										industrialClassicBm25FieldedCoreEstimate.totalBytes /
										baselineBytes,
								6,
							),
							vsRawAllIndexedTextRatio: round(
								rawCorpusBytes.allIndexedTextBytes === 0
									? 0
									:
										industrialClassicBm25FieldedCoreEstimate.totalBytes /
										rawCorpusBytes.allIndexedTextBytes,
								6,
							),
						},
						industrialClassicBm25BodyOnlyAggressiveCore: {
							bytes:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.totalBytes,
							kb: round(
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.totalBytes /
									1024,
								3,
							),
							vsBaselineRatio: round(
								baselineBytes === 0
									? 0
									:
										industrialClassicBm25BodyOnlyAggressiveCoreEstimate.totalBytes /
										baselineBytes,
								6,
							),
							vsRawBodyRatio: round(
								rawCorpusBytes.bodyTextBytes === 0
									? 0
									:
										industrialClassicBm25BodyOnlyAggressiveCoreEstimate.totalBytes /
										rawCorpusBytes.bodyTextBytes,
								6,
							),
							rawBodyVsIndexRatio: round(
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.totalBytes ===
									0
									? 0
									:
										rawCorpusBytes.bodyTextBytes /
										industrialClassicBm25BodyOnlyAggressiveCoreEstimate.totalBytes,
								6,
							),
							savedBytes:
								baselineBytes -
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.totalBytes,
							savedRatio: round(
								baselineBytes === 0
									? 0
									:
										(
											baselineBytes -
											industrialClassicBm25BodyOnlyAggressiveCoreEstimate.totalBytes
										) / baselineBytes,
								6,
							),
						},
					},
					sectionBytes: {
						documents: {
							baseline: baselineDocumentsSection?.length ?? null,
							noBodyTokenSequence:
								noBodyTokenSequenceDocumentsSection?.length ?? null,
							classicBm25Like:
								classicBm25LikeDocumentsSection?.length ?? null,
						},
						bodyTokenLexicon: {
							baseline: getSectionLength(
								baselineSections,
								CoverageLexicalSnapshotSectionKind.BodyTokenLexicon,
							),
							classicBm25Like: getSectionLength(
								classicBm25LikeSections,
								CoverageLexicalSnapshotSectionKind.BodyTokenLexicon,
							),
						},
						positionalSectionsTotal: {
							baseline: positionalSectionBytes,
							classicBm25Like: sumSectionLengths(
								classicBm25LikeSections,
								POSITIONAL_SECTION_KINDS,
							),
						},
					},
					industrialBreakdown: {
						bodyOnlyCore: {
							name: industrialClassicBm25BodyOnlyCoreEstimate.name,
							dictionaryEncoding:
								industrialClassicBm25BodyOnlyCoreEstimate.dictionaryEncoding,
							pointerEncoding:
								industrialClassicBm25BodyOnlyCoreEstimate.pointerEncoding,
							postingEncoding:
								industrialClassicBm25BodyOnlyCoreEstimate.postingEncoding,
							termCount: industrialClassicBm25BodyOnlyCoreEstimate.termCount,
							postingListCount:
								industrialClassicBm25BodyOnlyCoreEstimate.postingListCount,
							postingEntryCount:
								industrialClassicBm25BodyOnlyCoreEstimate.postingEntryCount,
							dictionaryBytes:
								industrialClassicBm25BodyOnlyCoreEstimate.dictionaryBytes,
							dictionaryPointerBytes:
								industrialClassicBm25BodyOnlyCoreEstimate.dictionaryPointerBytes,
							postingsBytes:
								industrialClassicBm25BodyOnlyCoreEstimate.postingsBytes,
							normBytes: industrialClassicBm25BodyOnlyCoreEstimate.normBytes,
							storedPathBytes:
								industrialClassicBm25BodyOnlyCoreEstimate.storedPathBytes,
							byField: industrialClassicBm25BodyOnlyCoreEstimate.byField,
						},
						bodyOnlyAggressiveCore: {
							name: industrialClassicBm25BodyOnlyAggressiveCoreEstimate.name,
							dictionaryEncoding:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.dictionaryEncoding,
							pointerEncoding:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.pointerEncoding,
							postingEncoding:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.postingEncoding,
							termCount:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.termCount,
							postingListCount:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.postingListCount,
							postingEntryCount:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.postingEntryCount,
							dictionaryBytes:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.dictionaryBytes,
							dictionaryPointerBytes:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.dictionaryPointerBytes,
							postingsBytes:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.postingsBytes,
							normBytes:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.normBytes,
							storedPathBytes:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.storedPathBytes,
							byField:
								industrialClassicBm25BodyOnlyAggressiveCoreEstimate.byField,
						},
						fieldedCore: {
							name: industrialClassicBm25FieldedCoreEstimate.name,
							dictionaryEncoding:
								industrialClassicBm25FieldedCoreEstimate.dictionaryEncoding,
							pointerEncoding:
								industrialClassicBm25FieldedCoreEstimate.pointerEncoding,
							postingEncoding:
								industrialClassicBm25FieldedCoreEstimate.postingEncoding,
							termCount: industrialClassicBm25FieldedCoreEstimate.termCount,
							postingListCount:
								industrialClassicBm25FieldedCoreEstimate.postingListCount,
							postingEntryCount:
								industrialClassicBm25FieldedCoreEstimate.postingEntryCount,
							dictionaryBytes:
								industrialClassicBm25FieldedCoreEstimate.dictionaryBytes,
							dictionaryPointerBytes:
								industrialClassicBm25FieldedCoreEstimate.dictionaryPointerBytes,
							postingsBytes:
								industrialClassicBm25FieldedCoreEstimate.postingsBytes,
							normBytes:
								industrialClassicBm25FieldedCoreEstimate.normBytes,
							storedPathBytes:
								industrialClassicBm25FieldedCoreEstimate.storedPathBytes,
							byField: industrialClassicBm25FieldedCoreEstimate.byField,
						},
					},
					removedPostingFamilies: [...POSITIONAL_POSTING_KEYS],
					estimatedLiveIndexBytes: engine.estimateIndexBytes(),
				},
				null,
				2,
			),
		);

		expect(noBodyTokenSequenceBytes).toBeLessThan(baselineBytes);
		expect(classicBm25LikeBytes).toBeLessThan(noBodyTokenSequenceBytes);
		expect(industrialClassicBm25BodyOnlyCoreEstimate.totalBytes).toBeLessThan(
			classicBm25LikeBytes,
		);
		expect(
			industrialClassicBm25BodyOnlyAggressiveCoreEstimate.totalBytes,
		).toBeLessThan(industrialClassicBm25BodyOnlyCoreEstimate.totalBytes);
		expect(classicBm25LikeSavedBytes).toBeGreaterThan(0);
	});
});
