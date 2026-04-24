import type {
	FileItemFreshnessReason,
	FileItemFreshnessState,
	FileItemSnapshotSource,
} from "src/globals/search-types";
import type { LocaleKey } from "src/services/obsidian/translations/locale-helper";

export type HybridFileItemFreshnessInput = Readonly<{
	state?: FileItemFreshnessState;
	reason?: FileItemFreshnessReason;
	snapshotGeneration?: number;
	snapshotSource?: FileItemSnapshotSource;
	nativeSubItemsReady?: boolean;
}>;

export type ResolvedHybridFileItemFreshness = Readonly<{
	state: FileItemFreshnessState;
	reason: FileItemFreshnessReason;
	snapshotGeneration?: number;
	snapshotSource: FileItemSnapshotSource;
	nativeSubItemsReady: boolean;
	bannerKey: LocaleKey | null;
	bannerMessage: string | null;
}>;

export function resolveHybridFileItemFreshness(
	input: HybridFileItemFreshnessInput | null | undefined,
): ResolvedHybridFileItemFreshness {
	if (!input) {
		return buildLexicalOnlyFreshness("shadow_missing");
	}

	if (input.state === "lexical_only") {
		return buildLexicalOnlyFreshness(input.reason ?? "shadow_missing", {
			snapshotGeneration: input.snapshotGeneration,
		});
	}

	if (input.snapshotSource === "shadow") {
		const reason =
			input.reason === "embedding_wait_interval"
				? "embedding_wait_interval"
				: "embedding_updating";
		return {
			state: "stale_grace",
			reason,
			snapshotGeneration: input.snapshotGeneration,
			snapshotSource: "shadow",
			nativeSubItemsReady: false,
			bannerKey:
				reason === "embedding_wait_interval"
					? "hybridNotice.fileEmbeddingWaitInterval"
					: "hybridNotice.fileEmbeddingUpdating",
			bannerMessage: null,
		};
	}

	if (input.snapshotSource === "live" || input.snapshotSource === "indexed") {
		return {
			state: "fresh",
			reason: "none",
			snapshotGeneration: input.snapshotGeneration,
			snapshotSource: input.snapshotSource,
			nativeSubItemsReady: input.nativeSubItemsReady ?? false,
			bannerKey: null,
			bannerMessage: null,
		};
	}

	return buildLexicalOnlyFreshness(input.reason ?? "shadow_missing", {
		snapshotGeneration: input.snapshotGeneration,
	});
}

export function buildLexicalOnlyFreshness(
	reason: FileItemFreshnessReason = "shadow_missing",
	options: Readonly<{ snapshotGeneration?: number }> = {},
): ResolvedHybridFileItemFreshness {
	return {
		state: "lexical_only",
		reason,
		snapshotGeneration: options.snapshotGeneration,
		snapshotSource: "live",
		nativeSubItemsReady: true,
		bannerKey: null,
		bannerMessage: null,
	};
}
