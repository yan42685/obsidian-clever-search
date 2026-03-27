import type { IndexedDocument, MatchedFile } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	SerializedFileSearchIndex,
} from "../file-search-engine";
import { buildCoverageLexicalPlan } from "./coverage-lexical-planner";
import { rankCoverageLexicalResults } from "./coverage-lexical-ranker";

@singleton()
export class CoverageLexicalFileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = false;

	private delegate: FileSearchEngine | null = null;

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		if (!Array.isArray(data)) {
			logger.warn(
				"coverage-lexical currently supports rebuild from live documents only",
			);
			this.clearIndex();
			return false;
		}
		return this.getDelegate().reIndexAll(data);
	}

	clearIndex(): void {
		this.getDelegate().clearIndex();
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		await this.getDelegate().addDocuments(documents);
	}

	deleteDocuments(paths: string[]): void {
		this.getDelegate().deleteDocuments(paths);
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		const results = await this.getDelegate().searchFiles(request);
		const plan = buildCoverageLexicalPlan(
			request.queryText,
			results[0]?.queryTerms ?? [],
		);
		return this.rankWithCoveragePlan(request, results, plan);
	}

	serialize(): SerializedFileSearchIndex | null {
		return null;
	}

	estimateIndexBytes(): number | null {
		const estimatedBytes = this.getDelegate().estimateIndexBytes?.();
		if (
			typeof estimatedBytes === "number" &&
			Number.isFinite(estimatedBytes) &&
			estimatedBytes >= 0
		) {
			return estimatedBytes;
		}
		const serialized = this.getDelegate().serialize();
		if (!serialized) {
			return null;
		}
		if (
			typeof serialized === "object" &&
			serialized !== null &&
			"data" in serialized &&
			serialized.data instanceof ArrayBuffer
		) {
			return serialized.data.byteLength;
		}
		return Buffer.byteLength(JSON.stringify(serialized), "utf8");
	}

	getIndexBreakdown(): Record<string, unknown> | null {
		return this.getDelegate().getIndexBreakdown?.() ?? null;
	}

	private rankWithCoveragePlan(
		request: FileSearchRequest,
		results: MatchedFile[],
		plan: ReturnType<typeof buildCoverageLexicalPlan>,
	): MatchedFile[] {
		if (results.length <= 1 || shouldSkipCoverageRerank(request, results)) {
			return results;
		}
		return rankCoverageLexicalResults(results, plan);
	}

	private getDelegate(): FileSearchEngine {
		if (this.delegate) {
			return this.delegate;
		}
		const {
			CustomFileSearchEngine,
		} = require("../file-search-engine") as typeof import("../file-search-engine");
		this.delegate = getInstance(CustomFileSearchEngine);
		return this.delegate;
	}
}

function shouldSkipCoverageRerank(
	request: FileSearchRequest,
	results: readonly MatchedFile[],
): boolean {
	if (!request.isPrefixMatch) {
		return false;
	}
	const queryTerms = results[0]?.queryTerms ?? [];
	const shortPrefixFamilyCount = queryTerms.filter((term) => term.length <= 3).length;
	return shortPrefixFamilyCount >= 2;
}
