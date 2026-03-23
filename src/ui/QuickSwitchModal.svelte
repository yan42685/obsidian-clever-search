<script lang="ts">
	import { onMount, tick } from "svelte";
	import { SearchHistoryService } from "src/services/obsidian/user-data/search-history-service";
	import { getInstance } from "src/utils/my-lib";
	import PassageSearchPanel from "./PassageSearchPanel.svelte";
	import { getMockPassageSearchHits } from "./mock-passage-search-data";
	import type { PassageSearchHit } from "./passage-search-types";

	const searchHistoryService = getInstance(SearchHistoryService);

	let panelRef: PassageSearchPanel | null = null;
	let queryText = "";
	let selectedResultIndex = 0;
	let results: PassageSearchHit[] = getMockPassageSearchHits("");

	$: if (selectedResultIndex >= results.length) {
		selectedResultIndex = results.length > 0 ? 0 : -1;
	}

	function refreshResults(resetIndex = false): void {
		results = getMockPassageSearchHits(queryText);
		if (resetIndex) {
			selectedResultIndex = results.length > 0 ? 0 : -1;
		} else if (results.length === 0) {
			selectedResultIndex = -1;
		}
	}

	function moveSelectedResult(direction: "next" | "prev"): void {
		if (results.length === 0) {
			selectedResultIndex = -1;
			return;
		}
		if (selectedResultIndex < 0) {
			selectedResultIndex = direction === "next" ? 0 : results.length - 1;
			return;
		}
		selectedResultIndex =
			direction === "next"
				? (selectedResultIndex + 1) % results.length
				: (selectedResultIndex - 1 + results.length) % results.length;
	}

	async function handleSubmit(): Promise<void> {
		await searchHistoryService.recordQuery(queryText);
	}

	onMount(async () => {
		refreshResults(true);
		await tick();
		panelRef?.focusInput?.();
	});
</script>

<div class="quickswitch-shell">
	<PassageSearchPanel
		bind:this={panelRef}
		bind:queryText
		placeholder="QuickSwitch..."
		{results}
		{selectedResultIndex}
		resultCountText={results.length > 0 ? `${selectedResultIndex + 1} / ${results.length}` : ""}
		emptyStateText="No mock passages matched."
		loadingText="Loading mock passages..."
		on:querychange={() => {
			refreshResults(true);
		}}
		on:submit={() => {
			void handleSubmit();
		}}
		on:moveresult={(event) => {
			moveSelectedResult(event.detail.direction);
		}}
		on:selectresult={(event) => {
			selectedResultIndex = event.detail.index;
		}}
		on:hoverresult={(event) => {
			selectedResultIndex = event.detail.index;
		}}
	/>

	<div class="quickswitch-footer">
		<span>Mock preview · hit-level cards</span>
		<span>Ctrl+J / Ctrl+K move history or results</span>
	</div>
</div>

<style>
	.quickswitch-shell {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		width: min(56rem, 86vw);
		min-height: 26rem;
		padding: 0.35rem 0.25rem 0.1rem;
		box-sizing: border-box;
	}

	.quickswitch-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		font-size: 0.76rem;
		color: var(--text-muted);
	}
</style>
