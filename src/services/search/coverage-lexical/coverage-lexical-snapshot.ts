import { extractHanSegments } from "./coverage-lexical-cjk";

type CoverageLexicalSnapshotDocumentStateV1 = {
	docId: number;
	path: string;
	bodyText: string;
	basenameText: string;
	folderText: string;
	aliasesText: string;
	tagsText: string;
	headingsText: string;
	bodyTokenSequence: readonly string[];
	tagValues: readonly string[];
};

type CoverageLexicalSnapshotDocumentState = {
	docId: number;
	path: string;
	basenameText: string;
	folderText: string;
	aliasesText: string;
	tagsText: string;
	headingsText: string;
	bodyTokenSequence: readonly string[];
	bodyHanSegments: readonly string[];
	tagValues: readonly string[];
};

export type CoverageLexicalSnapshotState = {
	nextDocumentId: number;
	sortedLexicon: readonly string[];
	documents: readonly CoverageLexicalSnapshotDocumentState[];
	bodyPostings: ReadonlyMap<string, readonly number[]>;
	bodyCharPostings: ReadonlyMap<string, readonly number[]>;
	bodyHanSegmentPostings: ReadonlyMap<string, readonly number[]>;
	bodyPhrasePostings: ReadonlyMap<string, readonly number[]>;
	metadataAliasCharPostings: ReadonlyMap<string, readonly number[]>;
	metadataAliasHanSegmentPostings: ReadonlyMap<string, readonly number[]>;
	metadataAliasPhrasePostings: ReadonlyMap<string, readonly number[]>;
	metadataAliasPostings: ReadonlyMap<string, readonly number[]>;
	metadataBasenameCharPostings: ReadonlyMap<string, readonly number[]>;
	metadataBasenameHanSegmentPostings: ReadonlyMap<string, readonly number[]>;
	metadataBasenamePhrasePostings: ReadonlyMap<string, readonly number[]>;
	metadataBasenamePostings: ReadonlyMap<string, readonly number[]>;
	metadataFolderCharPostings: ReadonlyMap<string, readonly number[]>;
	metadataFolderHanSegmentPostings: ReadonlyMap<string, readonly number[]>;
	metadataFolderPhrasePostings: ReadonlyMap<string, readonly number[]>;
	metadataFolderPostings: ReadonlyMap<string, readonly number[]>;
	metadataHeadingCharPostings: ReadonlyMap<string, readonly number[]>;
	metadataHeadingHanSegmentPostings: ReadonlyMap<string, readonly number[]>;
	metadataHeadingPhrasePostings: ReadonlyMap<string, readonly number[]>;
	metadataHeadingPostings: ReadonlyMap<string, readonly number[]>;
	metadataPostings: ReadonlyMap<string, readonly number[]>;
	metadataTagCharPostings: ReadonlyMap<string, readonly number[]>;
	metadataTagFullPostings: ReadonlyMap<string, readonly number[]>;
	metadataTagPhrasePostings: ReadonlyMap<string, readonly number[]>;
	metadataTagPostings: ReadonlyMap<string, readonly number[]>;
};

const SNAPSHOT_MAGIC = [0x43, 0x4c, 0x58, 0x53] as const;
const SNAPSHOT_VERSION = 2;
const HEADER_BYTES = 12;
const DIRECTORY_ENTRY_BYTES = 16;

const DOCUMENT_STRING_FIELDS_V1 = [
	"bodyText",
	"basenameText",
	"folderText",
	"aliasesText",
	"tagsText",
	"headingsText",
] as const satisfies readonly (keyof CoverageLexicalSnapshotDocumentStateV1)[];

const DOCUMENT_STRING_FIELDS_V2 = [
	"basenameText",
	"folderText",
	"aliasesText",
	"tagsText",
	"headingsText",
] as const satisfies readonly (keyof CoverageLexicalSnapshotDocumentState)[];

const DOCUMENT_STRING_LIST_FIELDS_V1 = [
	"bodyTokenSequence",
	"tagValues",
] as const satisfies readonly (keyof CoverageLexicalSnapshotDocumentStateV1)[];

const DOCUMENT_STRING_LIST_FIELDS_V2 = [
	"bodyTokenSequence",
	"bodyHanSegments",
	"tagValues",
] as const satisfies readonly (keyof CoverageLexicalSnapshotDocumentState)[];

type DocumentStringFieldV1 = (typeof DOCUMENT_STRING_FIELDS_V1)[number];
type DocumentStringFieldV2 = (typeof DOCUMENT_STRING_FIELDS_V2)[number];
type DocumentStringListFieldV1 = (typeof DOCUMENT_STRING_LIST_FIELDS_V1)[number];
type DocumentStringListFieldV2 = (typeof DOCUMENT_STRING_LIST_FIELDS_V2)[number];

const enum CoverageLexicalSnapshotSectionKind {
	Metadata = 1,
	StringPool = 2,
	Lexicon = 3,
	Documents = 4,
	BodyPostings = 10,
	BodyCharPostings = 11,
	BodyHanSegmentPostings = 12,
	BodyPhrasePostings = 13,
	MetadataAliasCharPostings = 14,
	MetadataAliasHanSegmentPostings = 15,
	MetadataAliasPhrasePostings = 16,
	MetadataAliasPostings = 17,
	MetadataBasenameCharPostings = 18,
	MetadataBasenameHanSegmentPostings = 19,
	MetadataBasenamePhrasePostings = 20,
	MetadataBasenamePostings = 21,
	MetadataFolderCharPostings = 22,
	MetadataFolderHanSegmentPostings = 23,
	MetadataFolderPhrasePostings = 24,
	MetadataFolderPostings = 25,
	MetadataHeadingCharPostings = 26,
	MetadataHeadingHanSegmentPostings = 27,
	MetadataHeadingPhrasePostings = 28,
	MetadataHeadingPostings = 29,
	MetadataPostings = 30,
	MetadataTagCharPostings = 31,
	MetadataTagFullPostings = 32,
	MetadataTagPhrasePostings = 33,
	MetadataTagPostings = 34,
}

type CoverageLexicalSnapshotSection = {
	kind: CoverageLexicalSnapshotSectionKind;
	count: number;
	payload: Uint8Array;
};

export function encodeCoverageLexicalSnapshotV1(
	state: CoverageLexicalSnapshotState,
): ArrayBuffer {
	const stringPool = new SnapshotStringPoolBuilder();
	registerSnapshotStrings(stringPool, state);
	const sections: CoverageLexicalSnapshotSection[] = [
		buildMetadataSection(state),
		buildStringPoolSection(stringPool),
		buildLexiconSection(state.sortedLexicon, stringPool),
		buildDocumentsSection(state.documents, stringPool),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.BodyPostings,
			state.bodyPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.BodyCharPostings,
			state.bodyCharPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.BodyHanSegmentPostings,
			state.bodyHanSegmentPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.BodyPhrasePostings,
			state.bodyPhrasePostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataAliasCharPostings,
			state.metadataAliasCharPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataAliasHanSegmentPostings,
			state.metadataAliasHanSegmentPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataAliasPhrasePostings,
			state.metadataAliasPhrasePostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataAliasPostings,
			state.metadataAliasPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataBasenameCharPostings,
			state.metadataBasenameCharPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataBasenameHanSegmentPostings,
			state.metadataBasenameHanSegmentPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataBasenamePhrasePostings,
			state.metadataBasenamePhrasePostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataBasenamePostings,
			state.metadataBasenamePostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataFolderCharPostings,
			state.metadataFolderCharPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataFolderHanSegmentPostings,
			state.metadataFolderHanSegmentPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataFolderPhrasePostings,
			state.metadataFolderPhrasePostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataFolderPostings,
			state.metadataFolderPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataHeadingCharPostings,
			state.metadataHeadingCharPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataHeadingHanSegmentPostings,
			state.metadataHeadingHanSegmentPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataHeadingPhrasePostings,
			state.metadataHeadingPhrasePostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataHeadingPostings,
			state.metadataHeadingPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataPostings,
			state.metadataPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataTagCharPostings,
			state.metadataTagCharPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataTagFullPostings,
			state.metadataTagFullPostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataTagPhrasePostings,
			state.metadataTagPhrasePostings,
			stringPool,
		),
		buildPostingSection(
			CoverageLexicalSnapshotSectionKind.MetadataTagPostings,
			state.metadataTagPostings,
			stringPool,
		),
	];
	const headerWriter = new SnapshotWriter();
	const headerBytes = HEADER_BYTES + sections.length * DIRECTORY_ENTRY_BYTES;
	let payloadOffset = headerBytes;
	headerWriter.writeBytes(SNAPSHOT_MAGIC);
	headerWriter.writeUint32(SNAPSHOT_VERSION);
	headerWriter.writeUint32(sections.length);
	for (const section of sections) {
		headerWriter.writeUint32(section.kind);
		headerWriter.writeUint32(payloadOffset);
		headerWriter.writeUint32(section.payload.byteLength);
		headerWriter.writeUint32(section.count);
		payloadOffset += section.payload.byteLength;
	}
	for (const section of sections) {
		headerWriter.writeBytes(section.payload);
	}
	return headerWriter.toArrayBuffer();
}

export function decodeCoverageLexicalSnapshotV1(
	data: ArrayBuffer,
): CoverageLexicalSnapshotState {
	const reader = new SnapshotReader(data);
	reader.expectBytes(SNAPSHOT_MAGIC);
	const version = reader.readUint32();
	if (version !== 1 && version !== SNAPSHOT_VERSION) {
		throw new Error(`Unsupported coverage lexical snapshot version: ${version}`);
	}
	const sectionCount = reader.readUint32();
	const sections = new Map<CoverageLexicalSnapshotSectionKind, { offset: number; length: number; count: number }>();
	for (let index = 0; index < sectionCount; index += 1) {
		const kind = reader.readUint32() as CoverageLexicalSnapshotSectionKind;
		sections.set(kind, {
			offset: reader.readUint32(),
			length: reader.readUint32(),
			count: reader.readUint32(),
		});
	}
	const strings = decodeStringPool(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.StringPool));
	const nextDocumentId = decodeMetadataSection(
		reader,
		requireSection(sections, CoverageLexicalSnapshotSectionKind.Metadata),
	);
	return {
		nextDocumentId,
		sortedLexicon: decodeLexiconSection(
			reader,
			requireSection(sections, CoverageLexicalSnapshotSectionKind.Lexicon),
			strings,
		),
		documents: decodeDocumentsSection(
			reader,
			requireSection(sections, CoverageLexicalSnapshotSectionKind.Documents),
			strings,
			version,
		),
		bodyPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.BodyPostings), strings),
		bodyCharPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.BodyCharPostings), strings),
		bodyHanSegmentPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.BodyHanSegmentPostings), strings),
		bodyPhrasePostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.BodyPhrasePostings), strings),
		metadataAliasCharPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataAliasCharPostings), strings),
		metadataAliasHanSegmentPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataAliasHanSegmentPostings), strings),
		metadataAliasPhrasePostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataAliasPhrasePostings), strings),
		metadataAliasPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataAliasPostings), strings),
		metadataBasenameCharPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataBasenameCharPostings), strings),
		metadataBasenameHanSegmentPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataBasenameHanSegmentPostings), strings),
		metadataBasenamePhrasePostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataBasenamePhrasePostings), strings),
		metadataBasenamePostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataBasenamePostings), strings),
		metadataFolderCharPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataFolderCharPostings), strings),
		metadataFolderHanSegmentPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataFolderHanSegmentPostings), strings),
		metadataFolderPhrasePostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataFolderPhrasePostings), strings),
		metadataFolderPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataFolderPostings), strings),
		metadataHeadingCharPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataHeadingCharPostings), strings),
		metadataHeadingHanSegmentPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataHeadingHanSegmentPostings), strings),
		metadataHeadingPhrasePostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataHeadingPhrasePostings), strings),
		metadataHeadingPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataHeadingPostings), strings),
		metadataPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataPostings), strings),
		metadataTagCharPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataTagCharPostings), strings),
		metadataTagFullPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataTagFullPostings), strings),
		metadataTagPhrasePostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataTagPhrasePostings), strings),
		metadataTagPostings: decodePostingSection(reader, requireSection(sections, CoverageLexicalSnapshotSectionKind.MetadataTagPostings), strings),
	};
}

function registerSnapshotStrings(
	stringPool: SnapshotStringPoolBuilder,
	state: CoverageLexicalSnapshotState,
): void {
	for (const term of state.sortedLexicon) {
		stringPool.intern(term);
	}
	for (const document of state.documents) {
		stringPool.intern(document.path);
		for (const field of DOCUMENT_STRING_FIELDS_V2) {
			stringPool.intern(document[field]);
		}
		for (const field of DOCUMENT_STRING_LIST_FIELDS_V2) {
			for (const value of document[field]) {
				stringPool.intern(value);
			}
		}
	}
	for (const postingMap of getPostingMaps(state)) {
		for (const [term] of postingMap) {
			stringPool.intern(term);
		}
	}
}


function getPostingMaps(
	state: CoverageLexicalSnapshotState,
): ReadonlyArray<ReadonlyMap<string, readonly number[]>> {
	return [
		state.bodyPostings,
		state.bodyCharPostings,
		state.bodyHanSegmentPostings,
		state.bodyPhrasePostings,
		state.metadataAliasCharPostings,
		state.metadataAliasHanSegmentPostings,
		state.metadataAliasPhrasePostings,
		state.metadataAliasPostings,
		state.metadataBasenameCharPostings,
		state.metadataBasenameHanSegmentPostings,
		state.metadataBasenamePhrasePostings,
		state.metadataBasenamePostings,
		state.metadataFolderCharPostings,
		state.metadataFolderHanSegmentPostings,
		state.metadataFolderPhrasePostings,
		state.metadataFolderPostings,
		state.metadataHeadingCharPostings,
		state.metadataHeadingHanSegmentPostings,
		state.metadataHeadingPhrasePostings,
		state.metadataHeadingPostings,
		state.metadataPostings,
		state.metadataTagCharPostings,
		state.metadataTagFullPostings,
		state.metadataTagPhrasePostings,
		state.metadataTagPostings,
	];
}

function buildMetadataSection(
	state: CoverageLexicalSnapshotState,
): CoverageLexicalSnapshotSection {
	const writer = new SnapshotWriter();
	writer.writeVarUint(state.nextDocumentId);
	return {
		kind: CoverageLexicalSnapshotSectionKind.Metadata,
		count: 1,
		payload: writer.toUint8Array(),
	};
}

function buildStringPoolSection(
	stringPool: SnapshotStringPoolBuilder,
): CoverageLexicalSnapshotSection {
	const writer = new SnapshotWriter();
	for (const value of stringPool.values) {
		writer.writeString(value);
	}
	return {
		kind: CoverageLexicalSnapshotSectionKind.StringPool,
		count: stringPool.values.length,
		payload: writer.toUint8Array(),
	};
}

function buildLexiconSection(
	sortedLexicon: readonly string[],
	stringPool: SnapshotStringPoolBuilder,
): CoverageLexicalSnapshotSection {
	const writer = new SnapshotWriter();
	for (const term of sortedLexicon) {
		writer.writeVarUint(stringPool.getId(term));
	}
	return {
		kind: CoverageLexicalSnapshotSectionKind.Lexicon,
		count: sortedLexicon.length,
		payload: writer.toUint8Array(),
	};
}

function buildDocumentsSection(
	documents: readonly CoverageLexicalSnapshotDocumentState[],
	stringPool: SnapshotStringPoolBuilder,
): CoverageLexicalSnapshotSection {
	const writer = new SnapshotWriter();
	let previousDocId = 0;
	for (const document of documents) {
		writer.writeVarUint(document.docId - previousDocId);
		writer.writeVarUint(stringPool.getId(document.path));
		for (const field of DOCUMENT_STRING_FIELDS_V2) {
			writer.writeVarUint(stringPool.getId(document[field]));
		}
		for (const field of DOCUMENT_STRING_LIST_FIELDS_V2) {
			writeStringIdList(writer, document[field], stringPool);
		}
		previousDocId = document.docId;
	}
	return {
		kind: CoverageLexicalSnapshotSectionKind.Documents,
		count: documents.length,
		payload: writer.toUint8Array(),
	};
}


function buildPostingSection(
	kind: CoverageLexicalSnapshotSectionKind,
	postings: ReadonlyMap<string, readonly number[]>,
	stringPool: SnapshotStringPoolBuilder,
): CoverageLexicalSnapshotSection {
	const writer = new SnapshotWriter();
	const entries = Array.from(postings.entries()).sort(([left], [right]) =>
		left.localeCompare(right),
	);
	for (const [term, docIds] of entries) {
		writer.writeVarUint(stringPool.getId(term));
		writer.writeVarUint(docIds.length);
		let previousDocId = 0;
		for (const docId of docIds) {
			writer.writeVarUint(docId - previousDocId);
			previousDocId = docId;
		}
	}
	return {
		kind,
		count: entries.length,
		payload: writer.toUint8Array(),
	};
}

function writeStringIdList(
	writer: SnapshotWriter,
	values: readonly string[],
	stringPool: SnapshotStringPoolBuilder,
): void {
	writer.writeVarUint(values.length);
	for (const value of values) {
		writer.writeVarUint(stringPool.getId(value));
	}
}

function decodeMetadataSection(
	reader: SnapshotReader,
	section: { offset: number; length: number; count: number },
): number {
	const sectionReader = reader.slice(section.offset, section.length);
	return sectionReader.readVarUint();
}

function decodeStringPool(
	reader: SnapshotReader,
	section: { offset: number; length: number; count: number },
): string[] {
	const sectionReader = reader.slice(section.offset, section.length);
	const values: string[] = [];
	for (let index = 0; index < section.count; index += 1) {
		values.push(sectionReader.readString());
	}
	return values;
}

function decodeLexiconSection(
	reader: SnapshotReader,
	section: { offset: number; length: number; count: number },
	strings: readonly string[],
): string[] {
	const sectionReader = reader.slice(section.offset, section.length);
	const values: string[] = [];
	for (let index = 0; index < section.count; index += 1) {
		values.push(readStringId(sectionReader, strings));
	}
	return values;
}

function decodeDocumentsSection(
	reader: SnapshotReader,
	section: { offset: number; length: number; count: number },
	strings: readonly string[],
	version: number,
): CoverageLexicalSnapshotDocumentState[] {
	const sectionReader = reader.slice(section.offset, section.length);
	const documents: CoverageLexicalSnapshotDocumentState[] = [];
	let previousDocId = 0;
	for (let index = 0; index < section.count; index += 1) {
		const docId = previousDocId + sectionReader.readVarUint();
		const path = readStringId(sectionReader, strings);
		if (version === 1) {
			const fieldValues = new Map<DocumentStringFieldV1, string>();
			for (const field of DOCUMENT_STRING_FIELDS_V1) {
				fieldValues.set(field, readStringId(sectionReader, strings));
			}
			const listValues = new Map<DocumentStringListFieldV1, readonly string[]>();
			for (const field of DOCUMENT_STRING_LIST_FIELDS_V1) {
				listValues.set(field, readStringIdList(sectionReader, strings));
			}
			const bodyText = fieldValues.get("bodyText") ?? "";
			documents.push({
				docId,
				path,
				basenameText: fieldValues.get("basenameText") ?? "",
				folderText: fieldValues.get("folderText") ?? "",
				aliasesText: fieldValues.get("aliasesText") ?? "",
				tagsText: fieldValues.get("tagsText") ?? "",
				headingsText: fieldValues.get("headingsText") ?? "",
				bodyTokenSequence: listValues.get("bodyTokenSequence") ?? [],
				bodyHanSegments: extractHanSegments(bodyText),
				tagValues: listValues.get("tagValues") ?? [],
			});
			previousDocId = docId;
			continue;
		}
		const fieldValues = new Map<DocumentStringFieldV2, string>();
		for (const field of DOCUMENT_STRING_FIELDS_V2) {
			fieldValues.set(field, readStringId(sectionReader, strings));
		}
		const listValues = new Map<DocumentStringListFieldV2, readonly string[]>();
		for (const field of DOCUMENT_STRING_LIST_FIELDS_V2) {
			listValues.set(field, readStringIdList(sectionReader, strings));
		}
		documents.push({
			docId,
			path,
			basenameText: fieldValues.get("basenameText") ?? "",
			folderText: fieldValues.get("folderText") ?? "",
			aliasesText: fieldValues.get("aliasesText") ?? "",
			tagsText: fieldValues.get("tagsText") ?? "",
			headingsText: fieldValues.get("headingsText") ?? "",
			bodyTokenSequence: listValues.get("bodyTokenSequence") ?? [],
			bodyHanSegments: listValues.get("bodyHanSegments") ?? [],
			tagValues: listValues.get("tagValues") ?? [],
		});
		previousDocId = docId;
	}
	return documents;
}


function decodePostingSection(
	reader: SnapshotReader,
	section: { offset: number; length: number; count: number },
	strings: readonly string[],
): Map<string, readonly number[]> {
	const sectionReader = reader.slice(section.offset, section.length);
	const postings = new Map<string, readonly number[]>();
	for (let index = 0; index < section.count; index += 1) {
		const term = readStringId(sectionReader, strings);
		const docCount = sectionReader.readVarUint();
		const docIds: number[] = [];
		let previousDocId = 0;
		for (let docIndex = 0; docIndex < docCount; docIndex += 1) {
			const docId = previousDocId + sectionReader.readVarUint();
			docIds.push(docId);
			previousDocId = docId;
		}
		postings.set(term, docIds);
	}
	return postings;
}

function readStringIdList(
	reader: SnapshotReader,
	strings: readonly string[],
): string[] {
	const count = reader.readVarUint();
	const values: string[] = [];
	for (let index = 0; index < count; index += 1) {
		values.push(readStringId(reader, strings));
	}
	return values;
}

function readStringId(reader: SnapshotReader, strings: readonly string[]): string {
	const stringId = reader.readVarUint();
	const value = strings[stringId];
	if (value === undefined) {
		throw new Error(`Invalid coverage lexical snapshot string id: ${stringId}`);
	}
	return value;
}

function requireSection(
	sections: ReadonlyMap<
		CoverageLexicalSnapshotSectionKind,
		{ offset: number; length: number; count: number }
	>,
	kind: CoverageLexicalSnapshotSectionKind,
): { offset: number; length: number; count: number } {
	const section = sections.get(kind);
	if (!section) {
		throw new Error(`Missing coverage lexical snapshot section: ${kind}`);
	}
	return section;
}

class SnapshotStringPoolBuilder {
	private readonly ids = new Map<string, number>();
	readonly values: string[] = [];

	intern(value: string): number {
		const existing = this.ids.get(value);
		if (existing !== undefined) {
			return existing;
		}
		const created = this.values.length;
		this.ids.set(value, created);
		this.values.push(value);
		return created;
	}

	getId(value: string): number {
		const existing = this.ids.get(value);
		if (existing === undefined) {
			throw new Error(`Missing coverage lexical snapshot string: ${value}`);
		}
		return existing;
	}
}

class SnapshotWriter {
	private readonly chunks: Uint8Array[] = [];
	private totalBytes = 0;
	private readonly encoder = new TextEncoder();

	writeBytes(value: readonly number[] | Uint8Array): void {
		const chunk = value instanceof Uint8Array ? value : Uint8Array.from(value);
		this.chunks.push(chunk);
		this.totalBytes += chunk.byteLength;
	}

	writeUint32(value: number): void {
		const chunk = new Uint8Array(4);
		const view = new DataView(chunk.buffer);
		view.setUint32(0, value, true);
		this.writeBytes(chunk);
	}

	writeVarUint(value: number): void {
		let remaining = value >>> 0;
		while (remaining >= 0x80) {
			this.writeBytes([0x80 | (remaining & 0x7f)]);
			remaining >>>= 7;
		}
		this.writeBytes([remaining]);
	}

	writeString(value: string): void {
		const encoded = this.encoder.encode(value);
		this.writeVarUint(encoded.byteLength);
		this.writeBytes(encoded);
	}

	toUint8Array(): Uint8Array {
		const out = new Uint8Array(this.totalBytes);
		let offset = 0;
		for (const chunk of this.chunks) {
			out.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return out;
	}

	toArrayBuffer(): ArrayBuffer {
		return this.toUint8Array().buffer;
	}
}

class SnapshotReader {
	private readonly view: Uint8Array;
	private readonly decoder = new TextDecoder();
	private offset = 0;

	constructor(data: ArrayBuffer | Uint8Array) {
		this.view = data instanceof Uint8Array ? data : new Uint8Array(data);
	}

	expectBytes(expected: readonly number[]): void {
		for (const value of expected) {
			if (this.readByte() !== value) {
				throw new Error("Invalid coverage lexical snapshot magic");
			}
		}
	}

	readUint32(): number {
		this.ensureAvailable(4);
		const value = new DataView(
			this.view.buffer,
			this.view.byteOffset + this.offset,
			4,
		).getUint32(0, true);
		this.offset += 4;
		return value;
	}

	readVarUint(): number {
		let shift = 0;
		let out = 0;
		while (true) {
			const byte = this.readByte();
			out |= (byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) {
				return out >>> 0;
			}
			shift += 7;
		}
	}

	readString(): string {
		const length = this.readVarUint();
		this.ensureAvailable(length);
		const value = this.decoder.decode(
			this.view.subarray(this.offset, this.offset + length),
		);
		this.offset += length;
		return value;
	}

	slice(offset: number, length: number): SnapshotReader {
		this.ensureRange(offset, length);
		return new SnapshotReader(this.view.slice(offset, offset + length));
	}

	private readByte(): number {
		this.ensureAvailable(1);
		const value = this.view[this.offset];
		this.offset += 1;
		return value;
	}

	private ensureAvailable(length: number): void {
		this.ensureRange(this.offset, length);
	}

	private ensureRange(offset: number, length: number): void {
		if (offset < 0 || length < 0 || offset + length > this.view.byteLength) {
			throw new Error("Coverage lexical snapshot read out of range");
		}
	}
}
