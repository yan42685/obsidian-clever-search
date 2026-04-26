import {
	loadReadableResidentShardArtifacts,
	type CoverageLexicalV3ResidentShardArtifactLoader,
} from "./artifact-loader";
import { planStartupRegistrySafety } from "./compact";
import type { CoverageLexicalV3Engine } from "./engine";
import type { ResidentIndexView } from "./layout/types";
import { isReadableShardState } from "./shards";
import type { CoverageLexicalV3ProductionStores } from "./stores";

export type CoverageLexicalV3BootstrapResult = Readonly<{
	loaded: boolean;
	reason: "loaded" | "empty_registry" | "startup_safety_failed" | "missing_resident_shard";
	loadedShardIds: readonly string[];
	fallbackRebuildReason?: string;
}>;

export async function bootstrapCoverageLexicalV3Engine(params: {
	engine: CoverageLexicalV3Engine;
	stores: CoverageLexicalV3ProductionStores;
	residentShardArtifactLoader: CoverageLexicalV3ResidentShardArtifactLoader;
}): Promise<CoverageLexicalV3BootstrapResult> {
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
