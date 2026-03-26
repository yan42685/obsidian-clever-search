<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import type { SearchHistoryInput } from "./SearchHistoryInput.svelte";
	import SearchHistoryInputView from "./SearchHistoryInput.svelte";
	import type { PassageSearchHit } from "./passage-search-types";

	export let queryText = "";
	export let placeholder = "";
	export let results: PassageSearchHit[] = [];
	export let selectedResultIndex = -1;
	export let isSearching = false;
	export let emptyStateText = "No matched passages";
	export let loadingText = "Searching...";
	export let resultCountText = "";

	const dispatch = createEventDispatcher<{
		querychange: { queryText: string };
		submit: { queryText: string };
		selectresult: { hit: PassageSearchHit; index: number };
		hoverresult: { hit: PassageSearchHit; index: number };
		moveresult: { direction: "next" | "prev" };
	}>();

	let historyInputRef: SearchHistoryInput | null = null;

	$: derivedCountText =
		resultCountText ||
		(results.length > 0
			? `${Math.max(0, selectedResultIndex) + 1} / ${results.length}`
			: "");

	function getDisplayTitle(hit: PassageSearchHit): string {
		if (hit.title?.trim()) {
			return hit.title;
		}
		const normalized = hit.path.replace(/\\/g, "/");
		const segments = normalized.split("/");
		return segments[segments.length - 1] ?? normalized;
	}

	function getPathText(hit: PassageSearchHit): string {
		const parts: string[] = [hit.path];
		if (typeof hit.line === "number" && hit.line > 0) {
			const lineLabel =
				typeof hit.column === "number" && hit.column > 0
					? `L${hit.line}:${hit.column}`
					: `L${hit.line}`;
			parts.push(lineLabel);
		}
		return parts.join(" · ");
	}

	function getSnippetText(hit: PassageSearchHit): string {
		const headingPrefix = hit.heading?.trim() ? `${hit.heading} — ` : "";
		return `${headingPrefix}${hit.snippet}`;
	}

	function formatScore(score: number | undefined): string {
		if (typeof score !== "number" || Number.isNaN(score)) {
			return "";
		}
		return score.toFixed(3);
	}

	function selectResult(index: number): void {
		const hit = results[index];
		if (!hit) {
			return;
		}
		dispatch("selectresult", { hit, index });
	}

	function hoverResult(index: number): void {
		const hit = results[index];
		if (!hit) {
			return;
		}
		dispatch("hoverresult", { hit, index });
	}

	async function handlePanelKeydown(event: KeyboardEvent): Promise<void> {
		const key = event.key.toLowerCase();
		const isPrev =
			event.key === "ArrowUp" ||
			(event.ctrlKey && !event.altKey && !event.metaKey && key === "k");
		const isNext =
			event.key === "ArrowDown" ||
			(event.ctrlKey && !event.altKey && !event.metaKey && key === "j");

		if (isPrev || isNext) {
			const moved = await historyInputRef?.moveSelectionByHotkey?.(
				isPrev ? "prev" : "next",
			);
			if (moved) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			dispatch("moveresult", { direction: isPrev ? "prev" : "next" });
			return;
		}

		if (event.key === "Enter") {
			const accepted = historyInputRef?.acceptSelectedSuggestion?.();
			if (accepted) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			event.preventDefault();
			dispatch("submit", { queryText });
		}
	}

	function handleQueryChange(): void {
		dispatch("querychange", { queryText });
	}

	export function focusInput(): void {
		historyInputRef?.focusInput?.();
	}
</script>

<section class="passage-search-panel" on:keydown={handlePanelKeydown}>
	<div class="passage-search-header">
		<SearchHistoryInputView
			bind:this={historyInputRef}
			bind:queryText
			variant="omni"
			showMatchCount={results.length > 0}
			matchCountText={derivedCountText}
			placeholder={placeholder}
			on:querychange={handleQueryChange}
		/>
	</div>

	<div class="passage-search-results">
		{#if isSearching}
			<div class="passage-search-state">{loadingText}</div>
		{:else if results.length === 0}
			<div class="passage-search-state">{emptyStateText}</div>
		{:else}
			<ul class="passage-result-list">
				{#each results as hit, index}
					<li class:selected={index === selectedResultIndex} class="passage-result-item">
						<button
							type="button"
							class="passage-result-button"
							on:click={() => selectResult(index)}
							on:mouseenter={() => hoverResult(index)}
						>
							<div class="passage-file-item">
								<span class="passage-result-title">{getDisplayTitle(hit)}</span>
								{#if formatScore(hit.score)}
									<span class="passage-result-score">{formatScore(hit.score)}</span>
								{/if}
								<span class="passage-result-path">{getPathText(hit)}</span>
							</div>
							<div class="passage-result-snippet">{getSnippetText(hit)}</div>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.passage-search-panel {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		width: 100%;
		min-width: 0;
		height: 100%;
		min-height: 0;
		color: var(--text-normal);
	}

	.passage-search-header {
		position: sticky;
		top: 0;
		z-index: 3;
		padding-top: 0.1rem;
		background: linear-gradient(
			to bottom,
			var(--background-primary, transparent) 0%,
			var(--background-primary, transparent) 72%,
			transparent 100%
		);
	}

	.passage-search-results {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
	}

	.passage-search-state {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 12rem;
		padding: 1rem;
		box-sizing: border-box;
		color: var(--text-muted);
		font-size: 0.95rem;
		text-align: center;
		border: 1px dashed var(--background-modifier-border, rgba(255, 255, 255, 0.08));
		border-radius: 10px;
		background: var(--background-secondary, rgba(255, 255, 255, 0.02));
	}

	.passage-result-list {
		width: 100%;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.passage-result-item {
		flex: none;
		width: 100%;
		min-width: 0;
		margin: 0 0 0.4rem;
		padding: 0;
	}

	.passage-result-item:last-child {
		margin-bottom: 0;
	}

	.passage-result-button {
		position: relative;
		display: flex !important;
		flex-direction: column;
		align-items: flex-start;
		justify-content: flex-start;
		flex: none;
		width: 100%;
		height: auto !important;
		min-height: unset !important;
		max-height: none !important;
		min-width: 0;
		padding: 0.7em 0.8em;
		box-sizing: border-box;
		text-align: left;
		white-space: normal !important;
		color: inherit;
		background-color: var(--cs-pane-bgc, #20202066);
		border: 1px solid var(--background-modifier-border, rgba(255, 255, 255, 0.08));
		border-radius: 8px;
		box-shadow: none;
		cursor: pointer;
	}

	.passage-result-button:hover,
	.passage-result-item.selected .passage-result-button {
		background-color: var(--cs-item-selected-color, rgba(85, 85, 85, 0.35));
	}

	.passage-file-item {
		display: block;
		width: 100%;
		min-width: 0;
		padding-right: 4.9em;
		box-sizing: border-box;
	}

	.passage-result-title,
	.passage-result-path {
		display: block;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.passage-result-title {
		margin-top: -0.05em;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-normal);
	}

	.passage-result-score {
		position: absolute;
		top: 0.82em;
		right: 0.9em;
		font-family: var(--font-monospace);
		font-size: 0.8em;
		line-height: 1.2;
		color: var(--cs-secondary-font-color, #a29c9c);
	}

	.passage-result-path {
		margin-top: 0.1rem;
		font-size: 0.82rem;
		line-height: 1.35;
		color: var(--cs-secondary-font-color, #a29c9c);
	}

	.passage-result-snippet {
		display: -webkit-box;
		width: 100%;
		min-width: 0;
		margin-top: 0.42rem;
		overflow: hidden;
		color: var(--text-normal);
		font-size: 0.9rem;
		line-height: 1.42;
		text-overflow: ellipsis;
		white-space: normal;
		word-break: break-word;
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
	}
</style>
