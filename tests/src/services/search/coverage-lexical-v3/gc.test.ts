import { runCoverageLexicalV3StorageGc } from "src/services/search/coverage-lexical-v3/gc";

class MemoryTable<Row extends { id?: string; snapshotId?: string; jobId?: string }> {
	rows = new Map<string, Row>();

	constructor(rows: readonly Row[] = [], private readonly keyOf: (row: Row) => string) {
		for (const row of rows) {
			this.rows.set(keyOf(row), row);
		}
	}

	async toArray(): Promise<Row[]> {
		return [...this.rows.values()];
	}

	async delete(key: string): Promise<void> {
		this.rows.delete(key);
	}
}

describe("coverage lexical v3 storage gc", () => {
	test("removes orphan artifacts stale overlay entries invalidations and compact temp artifacts", async () => {
		const residentShardArtifacts = new MemoryTable(
			[
				{ id: "active-1@1", shardId: "active-1", generation: 1, artifactOwner: "active-1", base: {}, createdAt: 1 },
				{ id: "orphan@1", shardId: "orphan", generation: 1, artifactOwner: "orphan", base: {}, createdAt: 1 },
			],
			(row) => row.id!,
		);
		const snapshotManifests = new MemoryTable(
			[
				{
					snapshotId: "snapshot-1",
					schemaVersion: 1,
					createdAt: 1,
					registryGeneration: 1,
					shardDescriptors: [
						{
							shardId: "active-1",
							generation: 1,
							state: "active",
							sourceBytes: 10,
							docCount: 1,
							createdOrder: 1,
							artifactOwner: "active-1",
						},
					],
					activeShardId: "active-1",
					overlayIncluded: true,
					artifactRefs: [{ shardId: "active-1", generation: 1, artifactOwner: "active-1" }],
					overlayJournalRefs: [{ entryId: "active-1@1:1", activeShardId: "active-1", activeShardGeneration: 1, sequence: 1 }],
					invalidationCount: 1,
					status: "committed",
				},
				{ snapshotId: "building", status: "building", createdAt: 2 },
			],
			(row) => row.snapshotId!,
		);
		const shardRegistry = new MemoryTable(
			[
				{
					shardId: "active-1",
					generation: 1,
					state: "active",
					sourceBytes: 10,
					docCount: 1,
					createdOrder: 1,
					artifactOwner: "active-1",
				},
			],
			(row: any) => row.shardId,
		);
		const activeOverlayJournal = new MemoryTable(
			[
				{ id: "active-1@1:1", activeShardId: "active-1", activeShardGeneration: 1, sequence: 1, operation: "append", sourceBytes: 1, createdAt: 1 },
				{ id: "active-1@1:2", activeShardId: "active-1", activeShardGeneration: 1, sequence: 2, operation: "append", sourceBytes: 1, createdAt: 2 },
				{ id: "old-active@1:1", activeShardId: "old-active", activeShardGeneration: 1, sequence: 1, operation: "append", sourceBytes: 1, createdAt: 1 },
			],
			(row) => row.id!,
		);
		const invalidations = new MemoryTable(
			[
				{ id: "active", shardId: "active-1", shardGeneration: 1, docRef: 1, docGeneration: 1, reason: "superseded", createdAt: 1 },
				{ id: "old", shardId: "old-active", shardGeneration: 1, docRef: 1, docGeneration: 1, reason: "deleted", createdAt: 1 },
			],
			(row) => row.id!,
		);
		const compactJobs = new MemoryTable<any>([], (row) => row.jobId!);
		const compactTempArtifacts = new MemoryTable(
			[
				{
					jobId: "orphan-job",
					outputShardId: "sealed-2",
					outputDescriptor: {
						shardId: "sealed-2",
						generation: 1,
						state: "sealed",
						sourceBytes: 1,
						docCount: 1,
						createdOrder: 1,
						artifactOwner: "sealed-2",
					},
					shard: {},
					createdAt: 1,
				},
			],
			(row) => row.jobId!,
		);
		const lexicalBodyEvidence = new MemoryTable(
			[
				{ id: "active-overlay-evidence", shardId: "active-1:overlay", shardGeneration: 1 },
				{ id: "old-overlay-evidence", shardId: "old-active:overlay", shardGeneration: 1 },
			],
			(row) => row.id!,
		);

		const result = await runCoverageLexicalV3StorageGc({
			tables: {
				residentShardArtifacts: residentShardArtifacts as any,
				snapshotManifests: snapshotManifests as any,
				shardRegistry: shardRegistry as any,
				activeOverlayJournal: activeOverlayJournal as any,
				invalidations: invalidations as any,
				compactJobs: compactJobs as any,
				compactTempArtifacts: compactTempArtifacts as any,
				lexicalBodyEvidence: lexicalBodyEvidence as any,
			},
		});

		expect(result).toMatchObject({
			orphanArtifactRowsRemoved: 1,
			snapshotManifestsRemoved: 1,
			overlayEntriesRemoved: 1,
			invalidationsRemoved: 1,
			compactTempArtifactsRemoved: 1,
			coldEvidenceRowsRemoved: 1,
		});
		expect([...residentShardArtifacts.rows.keys()]).toEqual(["active-1@1"]);
		expect([...activeOverlayJournal.rows.keys()]).toEqual([
			"active-1@1:1",
			"active-1@1:2",
		]);
		expect([...lexicalBodyEvidence.rows.keys()]).toEqual(["active-overlay-evidence"]);
	});
});
