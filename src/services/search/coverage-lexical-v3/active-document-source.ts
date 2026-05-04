import type { IndexedDocument } from "src/globals/search-types";
import type {
	IndexedMetadataSnapshot,
	IndexedTextSnapshot,
} from "src/services/search/shared/file-snapshot-store";
import { buildIndexedSnapshotRequestKey } from "src/services/search/shared/file-snapshot-store";
import type { CoverageLexicalV3ResidentShardArtifactLoader } from "./artifact-loader";
import type { ResidentBase } from "./layout/types";
import { readResidentString } from "./recall/access";
import type { ResidentShardDescriptor } from "./shards";

export type ActiveShardIndexedSnapshotReader = Readonly<{
	readIndexedTextSnapshots: (
		requests: ReadonlyArray<{ path: string; generation?: number }>,
	) => Promise<Map<string, IndexedTextSnapshot>>;
	readIndexedMetadata: (
		requests: ReadonlyArray<{ path: string; generation?: number }>,
	) => Promise<Map<string, IndexedMetadataSnapshot>>;
}>;

export class MissingIndexedTextSnapshotsError extends Error {
	readonly missingRefs: ReadonlyArray<{
		docRef: number;
		path: string;
		generation: number;
	}>;

	constructor(
		missingRefs: ReadonlyArray<{
			docRef: number;
			path: string;
			generation: number;
		}>,
	) {
		super(
			`Missing indexed text snapshots for ${missingRefs.length} active document(s).`,
		);
		this.name = "MissingIndexedTextSnapshotsError";
		this.missingRefs = missingRefs;
	}
}

export class MissingResidentShardArtifactsError extends Error {
	readonly missingShards: ReadonlyArray<{
		shardId: string;
		generation: number;
		artifactOwner: string;
	}>;

	constructor(
		missingShards: ReadonlyArray<{
			shardId: string;
			generation: number;
			artifactOwner: string;
		}>,
	) {
		super(
			`Missing resident shard artifacts for ${missingShards.length} shard(s).`,
		);
		this.name = "MissingResidentShardArtifactsError";
		this.missingShards = missingShards;
	}
}

export async function loadCurrentActiveDocuments(params: {
	activeShard: ResidentShardDescriptor;
	residentShardArtifactLoader: CoverageLexicalV3ResidentShardArtifactLoader;
	indexedSnapshotReader: ActiveShardIndexedSnapshotReader;
}): Promise<readonly IndexedDocument[]> {
	if (params.activeShard.state !== "active") {
		throw new Error("loadCurrentActiveDocuments requires an active shard");
	}
	const activeResidentShard = await params.residentShardArtifactLoader.loadResidentShard(
		params.activeShard,
	);
	if (activeResidentShard == null) {
		throw new MissingResidentShardArtifactsError([
			{
				shardId: params.activeShard.shardId,
				generation: params.activeShard.generation,
				artifactOwner: params.activeShard.artifactOwner,
			},
		]);
	}
	const refs = extractResidentDocumentRefs(activeResidentShard.base);
	const requests = refs.map((ref) => ({ path: ref.path, generation: ref.generation }));
	const [textsByPath, metadataByPath] = await Promise.all([
		params.indexedSnapshotReader.readIndexedTextSnapshots(requests),
		params.indexedSnapshotReader.readIndexedMetadata(requests),
	]);
	const missingRefs: Array<{ docRef: number; path: string; generation: number }> = [];
	const documents = refs.flatMap((ref) => {
		const requestKey = buildIndexedSnapshotRequestKey(ref);
		const text = textsByPath.get(requestKey);
		if (text == null) {
			missingRefs.push(ref);
			return [];
		}
		const metadata = metadataByPath.get(requestKey);
		return [
			{
				docRef: ref.docRef,
				path: ref.path,
				generation: ref.generation,
				size: text.text.length,
				basename: basenameOf(ref.path),
				folder: folderOf(ref.path),
				content: text.text,
				aliases: metadata?.aliasesText ?? "",
				tags: metadata?.tagsText ?? "",
				headings: metadata?.headingsText ?? "",
			} satisfies IndexedDocument,
		];
	});
	if (missingRefs.length > 0) {
		throw new MissingIndexedTextSnapshotsError(missingRefs);
	}
	return documents;
}

function extractResidentDocumentRefs(
	base: ResidentBase,
): ReadonlyArray<{ docRef: number; path: string; generation: number }> {
	return Array.from({ length: base.docTable.docCount }, (_, docId) => ({
		docRef: base.docTable.docRefsByDocId[docId] ?? 0,
		path: readResidentString(base, base.docTable.pathStringIds[docId] ?? 0),
		generation: base.docTable.generationByDocId[docId] ?? 0,
	}));
}

function basenameOf(path: string): string {
	const fileName = path.split("/").pop() ?? path;
	return fileName.replace(/\.md$/i, "");
}

function folderOf(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash <= 0 ? "" : path.slice(0, lastSlash);
}
