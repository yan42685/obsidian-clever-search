import {
	loadReadableResidentShardArtifacts,
	type CoverageLexicalV3ResidentShardArtifactLoader,
} from "./artifact-loader";
import { planStartupRegistrySafety } from "./compact";
import type { CoverageLexicalV3Engine } from "./engine";
import type { ResidentIndexView } from "./layout/types";
import type { ActiveOverlayJournalStore } from "./active-overlay-journal";
import type { V3DocumentTokenizer } from "./query";
import { isReadableShardState } from "./shards";
import {
	restoreCoverageLexicalV3Snapshot,
	type CoverageLexicalV3SnapshotStore,
} from "./snapshot";
import type { CoverageLexicalV3ProductionStores } from "./stores";

export type CoverageLexicalV3BootstrapResult = Readonly<{
	loaded: boolean;
	reason:
		| "loaded"
		| "loaded_snapshot"
		| "empty_registry"
		| "startup_safety_failed"
		| "missing_resident_shard";
	loadedShardIds: readonly string[];
	fallbackRebuildReason?: string;
	snapshotId?: string;
}>;

export async function bootstrapCoverageLexicalV3Engine(params: {
	engine: CoverageLexicalV3Engine;
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactLoader: CoverageLexicalV3ResidentShardArtifactLoader;
	snapshotStore?: CoverageLexicalV3SnapshotStore;
	overlayJournalStore?: ActiveOverlayJournalStore;
	tokenizeDocumentText?: V3DocumentTokenizer;
}): Promise<CoverageLexicalV3BootstrapResult> {
	if (params.snapshotStore != null && params.overlayJournalStore != null) {
		const snapshotRestore = await restoreCoverageLexicalV3Snapshot({
			snapshotStore: params.snapshotStore,
			engine: params.engine,
			stores: params.stores,
			residentShardArtifactLoader: params.residentShardArtifactLoader,
			overlayJournalStore: params.overlayJournalStore,
			tokenizeDocumentText: params.tokenizeDocumentText,
		});
		if (snapshotRestore.restored) {
			return {
				loaded: true,
				reason: "loaded_snapshot",
				loadedShardIds: snapshotRestore.loadedShardIds,
				snapshotId: snapshotRestore.snapshotId,
			};
		}
	}
	const registry = await params.stores.shardRegistry.loadRegistry();
	if (registry.length === 0) {
		return {
			loaded: false,
			reason: "empty_registry",
			loadedShardIds: [],
		};
	}
	const safetyAction = planStartupRegistrySafety(registry);
	if (safetyAction.type === "fallback_rebuild") {
		return {
			loaded: false,
			reason: "startup_safety_failed",
			loadedShardIds: [],
			fallbackRebuildReason: safetyAction.reason,
		};
	}
	const readableRegistry = registry.filter((descriptor) =>
		isReadableShardState(descriptor.state),
	);
	const readableShards = await loadReadableResidentShardArtifacts({
		registry: readableRegistry,
		loader: params.residentShardArtifactLoader,
	});
	if (readableShards.length !== readableRegistry.length) {
		return {
			loaded: false,
			reason: "missing_resident_shard",
			loadedShardIds: readableShards.map((shard) => shard.shardId),
		};
	}
	params.engine.loadResidentIndexView({
		version: 1,
		shards: readableShards,
		shardRegistry: readableRegistry,
	} satisfies ResidentIndexView);
	params.engine.loadShardInvalidations(await params.stores.invalidations.loadInvalidations());
	return {
		loaded: true,
		reason: "loaded",
		loadedShardIds: readableShards.map((shard) => shard.shardId),
	};
}
