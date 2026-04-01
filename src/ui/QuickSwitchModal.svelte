<script lang="ts">
	import { App } from "obsidian";
	import { onMount, tick } from "svelte";
	import { OuterSetting } from "src/globals/plugin-setting";
	import { t } from "src/services/obsidian/translations/locale-helper";
	import {
		SearchAutocompleteService,
		type SearchAutocompleteCandidate,
		type SearchAutocompleteSource,
	} from "src/services/obsidian/user-data/search-autocomplete-service";
	import { SearchHistoryService } from "src/services/obsidian/user-data/search-history-service";
	import { getInstance } from "src/utils/my-lib";
	import SearchHistoryInput from "./SearchHistoryInput.svelte";

	const app = getInstance(App);
	const setting = getInstance(OuterSetting);
	const searchHistoryService = getInstance(SearchHistoryService);
	const autocompleteService = getInstance(SearchAutocompleteService);

	export let requestClose: () => void = () => {};

	let inputRef: SearchHistoryInput | null = null;
	let queryText = "";
	let results: SearchAutocompleteCandidate[] = [];
	let selectedResultIndex = -1;

	$: if (selectedResultIndex >= results.length) {
		selectedResultIndex = results.length > 0 ? 0 : -1;
	}

	function refreshResults(resetIndex = false): void {
		results = autocompleteService.getNavigationSuggestions(queryText, 24);
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

	async function openResult(index = selectedResultIndex): Promise<void> {
		const candidate = results[index];
		if (!candidate?.path) {
			return;
		}
		if (queryText.trim().length > 0) {
			await searchHistoryService.recordQuery(queryText);
		}
		await app.workspace.openLinkText(candidate.path, "", setting.ui.openInNewPane);
		requestClose();
	}

	function handleKeydown(event: KeyboardEvent): void {
		const key = event.key.toLowerCase();
		const isPrev =
			event.key === "ArrowUp" ||
			(event.ctrlKey && !event.altKey && !event.metaKey && key === "k");
		const isNext =
			event.key === "ArrowDown" ||
			(event.ctrlKey && !event.altKey && !event.metaKey && key === "j");

		if (isPrev || isNext) {
			event.preventDefault();
			event.stopPropagation();
			moveSelectedResult(isPrev ? "prev" : "next");
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			void openResult();
		}
	}

	function getSourceLabelKey(kind: SearchAutocompleteSource): string {
		switch (kind) {
			case "file":
				return "autocompleteSource.file";
			case "alias":
				return "autocompleteSource.alias";
			case "heading":
				return "autocompleteSource.heading";
			case "path":
				return "autocompleteSource.path";
			case "recent":
				return "autocompleteSource.recent";
		}
	}

	function getHighlightParts(
		text: string,
		positions: number[],
	): Array<{ text: string; matched: boolean }> {
		if (positions.length === 0) {
			return [{ text, matched: false }];
		}

		const positionSet = new Set(positions);
		const segments: Array<{ text: string; matched: boolean }> = [];
		let buffer = "";
		let isMatched = positionSet.has(0);

		for (let index = 0; index < text.length; index++) {
			const nextMatched = positionSet.has(index);
			if (index === 0) {
				isMatched = nextMatched;
			}

			if (nextMatched !== isMatched) {
				if (buffer.length > 0) {
					segments.push({ text: buffer, matched: isMatched });
				}
				buffer = "";
				isMatched = nextMatched;
			}
			buffer += text[index];
		}

		if (buffer.length > 0) {
			segments.push({ text: buffer, matched: isMatched });
		}

		return segments;
	}

	onMount(async () => {
		refreshResults(true);
		await tick();
		inputRef?.focusInput?.();
	});
</script>

<div class="quickswitch-shell" on:keydown={handleKeydown}>
	<div class="quickswitch-header">
		<SearchHistoryInput
			bind:this={inputRef}
			bind:queryText
			variant="omni"
			completionMode="plain"
			showMatchCount={results.length > 0}
			matchCountText={results.length > 0 ? `${Math.max(0, selectedResultIndex) + 1} / ${results.length}` : ""}
			placeholder="QuickSwitch..."
			on:querychange={() => {
				refreshResults(true);
			}}
		/>
	</div>

	<div class="quickswitch-results">
		{#if results.length === 0}
			<div class="quickswitch-empty">No navigation results matched.</div>
		{:else}
			<ul class="quickswitch-result-list">
				{#each results as entry, index}
					<li class:selected={index === selectedResultIndex} class="quickswitch-result-item">
						<button
							type="button"
							class="quickswitch-result-button"
							on:click={() => {
								selectedResultIndex = index;
								void openResult(index);
							}}
							on:mouseenter={() => {
								selectedResultIndex = index;
							}}
						>
							<div class="quickswitch-result-copy">
								<div class="quickswitch-result-title-row">
									<span class="quickswitch-result-title">
										{#each getHighlightParts(entry.primaryText, entry.positions) as part}
											{#if part.matched}
												<strong class="quickswitch-match">{part.text}</strong>
											{:else}
												<span>{part.text}</span>
											{/if}
										{/each}
									</span>
									<span class="quickswitch-result-kind">{t(getSourceLabelKey(entry.kind))}</span>
								</div>
								<span class="quickswitch-result-path">{entry.path}</span>
								{#if entry.secondaryText && entry.secondaryText !== entry.path}
									<span class="quickswitch-result-secondary">{entry.secondaryText}</span>
								{/if}
							</div>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="quickswitch-footer">
		<span>Navigation candidates for QuickSwitch</span>
		<span>Ctrl+J / Ctrl+K move results</span>
	</div>
</div>

<style>
	:global(.cs-modal.cs-quickswitch-modal) {
		width: min(58rem, 90vw);
		max-width: 90vw;
		height: min(78vh, 48rem);
		padding: 1.05rem 0.95rem 0.85rem;
		overflow: hidden;
	}

	.quickswitch-shell {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		width: 100%;
		min-width: 0;
		height: 100%;
		min-height: 0;
	}

	.quickswitch-header {
		flex: none;
	}

	.quickswitch-results {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
	}

	.quickswitch-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 10rem;
		padding: 1rem;
		box-sizing: border-box;
		color: var(--text-muted);
		text-align: center;
		border: 1px dashed var(--background-modifier-border, rgba(255, 255, 255, 0.08));
		border-radius: 10px;
		background: var(--background-secondary, rgba(255, 255, 255, 0.02));
	}

	.quickswitch-result-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.quickswitch-result-item {
		margin: 0 0 0.26rem;
	}

	.quickswitch-result-item:last-child {
		margin-bottom: 0;
	}

	.quickswitch-result-button {
		display: flex;
		width: 100%;
		padding: 0.52rem 0.72rem;
		box-sizing: border-box;
		text-align: left;
		color: inherit;
		background-color: var(--cs-pane-bgc, #20202066);
		border: 1px solid var(--background-modifier-border, rgba(255, 255, 255, 0.08));
		border-radius: 8px;
		box-shadow: none;
		cursor: pointer;
	}

	.quickswitch-result-button:hover,
	.quickswitch-result-item.selected .quickswitch-result-button {
		background-color: var(--cs-item-selected-color, rgba(85, 85, 85, 0.35));
	}

	.quickswitch-result-copy {
		display: flex;
		flex-direction: column;
		gap: 0.16rem;
		width: 100%;
		min-width: 0;
	}

	.quickswitch-result-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
		min-width: 0;
	}

	.quickswitch-result-title {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.quickswitch-result-kind {
		flex: none;
		padding: 0.06rem 0.34rem;
		font-size: 0.62rem;
		line-height: 1.2;
		color: var(--cs-secondary-font-color, #a29c9c);
		background-color: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 999px;
		white-space: nowrap;
	}

	.quickswitch-result-path,
	.quickswitch-result-secondary {
		display: block;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.78rem;
		line-height: 1.25;
		color: var(--cs-secondary-font-color, #a29c9c);
	}

	.quickswitch-match {
		font-weight: 700;
	}

	.quickswitch-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		min-width: 0;
		font-size: 0.76rem;
		color: var(--text-muted);
	}
</style>