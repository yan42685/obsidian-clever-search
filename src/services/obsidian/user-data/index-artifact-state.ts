export type IndexArtifactEngine = "lexical" | "hybrid";

export type IndexArtifactName = "snapshot" | "bm25" | "hnsw";

export type IndexArtifactStateRow = {
  id: string;
  engine: IndexArtifactEngine;
  artifact: IndexArtifactName;
  dirtyAt: number;
  reason?: string | null;
};

export function buildIndexArtifactStateId(
  engine: IndexArtifactEngine,
  artifact: IndexArtifactName,
): string {
  return `${engine}:${artifact}`;
}