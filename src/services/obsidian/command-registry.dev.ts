import type { App, Command } from "obsidian";
import { SearchType } from "src/globals/search-types";
import { FloatingWindowManager } from "src/ui/floating-window";
import { SearchModal } from "src/ui/search-modal";
import { getInstance } from "src/utils/my-lib";
import { DataManager } from "./user-data/data-manager";
import { MyNotice } from "./transformed-api";

type DevCommandRegistryContext = {
	app: App;
	addCommand: (command: Command) => void;
	runWhenSearchSearchable: (callback: () => void | Promise<void>) => void;
};

export async function registerDevCommands(
	context: DevCommandRegistryContext,
): Promise<void> {
	context.addCommand({
		id: "cs-in-file-search-floating-window",
		name: "In file search - floating window",
		callback: () => getInstance(FloatingWindowManager).toggle("inFile"),
	});

	context.addCommand({
		id: "clever-search-triggerTest",
		name: "clever-search-triggerTest",
		callback: async () => {
			const { devTest } = await import("src/dev-test");
			await devTest();
		},
	});

	context.addCommand({
		id: "cs-hybrid-search",
		name: "Hybrid search (dense + lexical lane) [dev]",
		callback: () =>
			context.runWhenSearchSearchable(() =>
				new SearchModal(context.app, SearchType.IN_VAULT, true).open(),
			),
	});

	context.addCommand({
		id: "cs-hybrid-search-lexical-lane",
		name: "Hybrid search (lexical lane) [dev]",
		callback: () =>
			context.runWhenSearchSearchable(() =>
				new SearchModal(
					context.app,
					SearchType.IN_VAULT,
					true,
					undefined,
					"lexical-lane",
				).open(),
			),
	});

	context.addCommand({
		id: "cs-dev-file-read-benchmark",
		name: "Benchmark file read paths [dev]",
		callback: async () => {
			const { DevFileReadBenchmark } = await import("./dev-file-read-benchmark");
			await getInstance(DevFileReadBenchmark).run();
		},
	});

	context.addCommand({
		id: "cs-dev-big-corpus-file-read-benchmark",
		name: "Benchmark big corpus read paths [dev]",
		callback: async () => {
			const { DevFileReadBenchmark } = await import("./dev-file-read-benchmark");
			await getInstance(DevFileReadBenchmark).runBigCorpus();
		},
	});

	context.addCommand({
		id: "cs-dev-search-bootstrap-summary",
		name: "Show search bootstrap summary [dev]",
		callback: () => {
			const dataManager = getInstance(DataManager);
			const metrics = dataManager.getSearchBootstrapMetrics();
			if (!metrics) {
				new MyNotice("Search bootstrap metrics are unavailable.", 4000);
				return;
			}
			const summary =
				`Search bootstrap: lexical ${dataManager.getLexicalBootstrapState()} ` +
				`(restore ${metrics.lexical.restoreMs ?? 0} ms, heal ${metrics.lexical.healMs ?? 0} ms), ` +
				`hybrid ${dataManager.getHybridBootstrapState()} ` +
				`(restore ${metrics.hybrid.restoreMs ?? 0} ms, heal ${metrics.hybrid.healMs ?? 0} ms), ` +
				`searchable ${metrics.searchableMs ?? 0} ms, ` +
				`commit ${metrics.commitMs ?? 0} ms, ` +
				`commitPending ${metrics.commitPending ? "yes" : "no"}, ` +
				`commitFailed ${metrics.commitFailed ? "yes" : "no"}.`;
			console.log("[clever-search]", summary, metrics);
			new MyNotice(summary, 5000);
		},
	});
}
