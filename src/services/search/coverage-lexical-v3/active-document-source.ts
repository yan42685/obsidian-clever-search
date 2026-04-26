import type { IndexedDocument } from "src/globals/search-types";
import type {
	IndexedMetadataSnapshot,
	IndexedTextSnapshot,
} from "src/services/search/shared/file-snapshot-store";
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
		return [];
	}
	const refs = extractResidentDocumentRefs(activeResidentShard.base);
	const requests = refs.map((ref) => ({ path: ref.path, generation: ref.generation }));
	const [textsByPath, metadataByPath] = await Promise.all([
		params.indexedSnapshotReader.readIndexedTextSnapshots(requests),
		params.indexedSnapshotReader.readIndexedMetadata(requests),
	]);
	return refs.flatMap((ref) => {
		const text = textsByPath.get(ref.path);
		if (text == null) {
			return [];
		}
		const metadata = metadataByPath.get(ref.path);
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
