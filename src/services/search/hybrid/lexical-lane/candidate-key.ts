import type {
	HybridLexicalLaneBlockCandidate,
	HybridLexicalLaneDisplayCandidate,
} from "./contracts";

type HybridLexicalLaneSnapshotCandidate = Pick<
	HybridLexicalLaneBlockCandidate | HybridLexicalLaneDisplayCandidate,
	"filePath" | "snapshotGeneration" | "snapshotSource"
>;

export function isSameHybridLexicalLaneSnapshot(
	left: HybridLexicalLaneSnapshotCandidate,
	right: HybridLexicalLaneSnapshotCandidate,
): boolean {
	return (
		left.filePath === right.filePath &&
		left.snapshotGeneration === right.snapshotGeneration &&
		(left.snapshotSource ?? "live") === (right.snapshotSource ?? "live")
	);
}

export function buildHybridLexicalLaneSnapshotKey(
	candidate: HybridLexicalLaneSnapshotCandidate,
): string {
	return [
		candidate.filePath,
		candidate.snapshotGeneration ?? "live",
		candidate.snapshotSource ?? "live",
	].join("\u001f");
}
