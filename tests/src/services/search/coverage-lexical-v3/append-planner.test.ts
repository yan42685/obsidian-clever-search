import type { IndexedDocument } from "src/globals/search-types";
import {
	estimateDocumentSourceBytes,
	planActiveShardAppend,
} from "src/services/search/coverage-lexical-v3/append-planner";
import type { ResidentShardDescriptor } from "src/services/search/coverage-lexical-v3/shards";

function activeShard(overrides: Partial<ResidentShardDescriptor> = {}): ResidentShardDescriptor {
	return {
		shardId: overrides.shardId ?? "active-1",
		generation: overrides.generation ?? 1,
		state: overrides.state ?? "active",
		sourceBytes: overrides.sourceBytes ?? 0,
		docCount: overrides.docCount ?? 0,
		createdOrder: overrides.createdOrder ?? 1,
		artifactOwner: overrides.artifactOwner ?? overrides.shardId ?? "active-1",
	};
}

function doc(
	path: string,
	content: string,
	docRef: number,
	generation: number,
): IndexedDocument {
	return {
		path,
		basename: path.replace(/\.md$/, ""),
		folder: "notes",
		content,
		docRef,
		generation,
	};
}

describe("coverage lexical v3 active shard append planner", () => {
	test("plans append plus superseded invalidation without sealing", () => {
		const document = doc("new.md", "hello world", 7, 2);
		const plan = planActiveShardAppend(
			activeShard({ sourceBytes: 100, docCount: 1 }),
			[
				{
					document,
					previousVersion: {
						shardId: "sealed-1",
						shardGeneration: 1,
						docRef: 7,
						docGeneration: 1,
					},
				},
			],
			{ sealSourceBytes: 1024 * 1024, now: 10 },
		);

		expect(plan.shouldSealBeforeAppend).toBe(false);
		expect(plan.appendTargetShardId).toBe("active-1");
		expect(plan.appendDocuments).toEqual([document]);
		expect(plan.invalidationEntries).toEqual([
			{
				shardId: "sealed-1",
				shardGeneration: 1,
				docRef: 7,
				docGeneration: 1,
				reason: "superseded",
				createdAt: 10,
			},
		]);
		expect(plan.nextActiveShard.sourceBytes).toBe(100 + estimateDocumentSourceBytes(document));
	});

	test("uses persisted size before scanning content bytes", () => {
		const document = {
			...doc("sized.md", "x".repeat(10_000), 10, 1),
			size: 123,
		};

		expect(estimateDocumentSourceBytes(document)).toBeLessThan(10_000);
		expect(estimateDocumentSourceBytes(document)).toBeGreaterThan(123);
	});

	test("plans delete invalidation without appending a document", () => {
		const plan = planActiveShardAppend(
			activeShard({ sourceBytes: 100, docCount: 1 }),
			[
				{
					document: doc("deleted.md", "deleted", 8, 1),
					deleted: true,
					previousVersion: {
						shardId: "sealed-2",
						shardGeneration: 1,
						docRef: 8,
						docGeneration: 1,
					},
				},
			],
			{ sealSourceBytes: 1024 * 1024, now: 11 },
		);

		expect(plan.appendDocuments).toHaveLength(0);
		expect(plan.invalidationEntries[0]?.reason).toBe("deleted");
		expect(plan.nextActiveShard.sourceBytes).toBe(100);
		expect(plan.nextActiveShard.docCount).toBe(1);
	});

	test("seals current active shard before append when the batch crosses threshold", () => {
		const document = doc("large.md", "x".repeat(200), 9, 1);
		const plan = planActiveShardAppend(
			activeShard({ sourceBytes: 900, docCount: 3, createdOrder: 4 }),
			[{ document }],
			{
				sealSourceBytes: 1000,
				nextShardId: "active-5",
				nextCreatedOrder: 5,
			},
		);

		expect(plan.shouldSealBeforeAppend).toBe(true);
		expect(plan.sealedActiveShard).toMatchObject({
			shardId: "active-1",
			state: "sealing",
		});
		expect(plan.appendTargetShardId).toBe("active-5");
		expect(plan.nextActiveShard).toMatchObject({
			shardId: "active-5",
			state: "active",
			docCount: 1,
			createdOrder: 5,
		});
	});
});
