<script lang="ts">
	import { OuterSetting, type SearchHistoryEntry } from "src/globals/plugin-setting";
	import { SearchHistoryService } from "src/services/obsidian/user-data/search-history-service";
	import { getInstance } from "src/utils/my-lib";
	import { createEventDispatcher, tick } from "svelte";

	const searchHistoryService = getInstance(SearchHistoryService);
	const setting = getInstance(OuterSetting);
	const dispatch = createEventDispatcher<{
		querychange: void;
	}>();

	export let queryText: string;
	export let matchCountText: string;

	let historySuggestions: SearchHistoryEntry[] = [];
	let currHistoryIndex = -1;
	let isHistoryDropdownOpen = false;
	let ghostSuggestion: SearchHistoryEntry | null = null;
	let searchInputEl: HTMLInputElement;
	let suggestionsEl: HTMLUListElement;

	$: displayedHistorySuggestions = [...historySuggestions].reverse();
	$: ghostSuffix = getGhostSuffix();

	function updateSuggestionsState() {
		ghostSuggestion = setting.searchHistory.enableGhostCompletion
			? searchHistoryService.getSuggestions(queryText, 1)[0] ?? null
			: null;

		historySuggestions = setting.searchHistory.showSuggestions
			? searchHistoryService.getSuggestions(queryText)
			: [];
		isHistoryDropdownOpen = historySuggestions.length > 0;
		currHistoryIndex = isHistoryDropdownOpen ? 0 : -1;

		if (isHistoryDropdownOpen) {
			void scrollSuggestionsToBottom();
		}
	}

	function closeHistorySuggestions() {
		historySuggestions = [];
		currHistoryIndex = -1;
		isHistoryDropdownOpen = false;
	}

	function moveHistorySelection(direction: "next" | "prev") {
		if (!isHistoryDropdownOpen || historySuggestions.length === 0) {
			return;
		}

		if (currHistoryIndex < 0) {
			currHistoryIndex =
				direction === "next" ? 0 : historySuggestions.length - 1;
			return;
		}

		if (direction === "next") {
			currHistoryIndex = (currHistoryIndex + 1) % historySuggestions.length;
		} else {
			currHistoryIndex =
				(currHistoryIndex - 1 + historySuggestions.length) %
				historySuggestions.length;
		}
	}

	function notifyQueryChanged() {
		dispatch("querychange");
	}

	function acceptSuggestion(query: string) {
		queryText = query;
		closeHistorySuggestions();
		updateSuggestionsState();
		notifyQueryChanged();
		searchInputEl?.focus();
	}

	function getSelectedSuggestion(): SearchHistoryEntry | null {
		if (!isHistoryDropdownOpen || historySuggestions.length === 0) {
			return null;
		}
		return historySuggestions[currHistoryIndex] ?? historySuggestions[0] ?? null;
	}

	function handleInput() {
		updateSuggestionsState();
		notifyQueryChanged();
	}

	function handleFocus() {
		updateSuggestionsState();
	}

	function handleBlur() {
		setTimeout(() => closeHistorySuggestions(), 100);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Tab" && isHistoryDropdownOpen) {
			const selectedHistory = getSelectedSuggestion();
			if (!selectedHistory) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			acceptSuggestion(selectedHistory.queryText);
			return;
		}

		if (event.key === "Tab" && ghostSuffix && ghostSuggestion) {
			event.preventDefault();
			event.stopPropagation();
			acceptSuggestion(ghostSuggestion.queryText);
			return;
		}

		if (!isHistoryDropdownOpen || historySuggestions.length === 0) {
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			event.stopPropagation();
			moveHistorySelection("prev");
			void scrollSelectedSuggestionIntoView();
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			event.stopPropagation();
			moveHistorySelection("next");
			void scrollSelectedSuggestionIntoView();
			return;
		}

		if (event.key === "Enter") {
			const selectedHistory = getSelectedSuggestion();
			if (!selectedHistory) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			acceptSuggestion(selectedHistory.queryText);
			return;
		}

		if (event.key === "Escape") {
			closeHistorySuggestions();
		}
	}

	function getGhostSuffix(): string {
		if (!ghostSuggestion || queryText.length === 0) {
			return "";
		}
		if (
			!ghostSuggestion.queryText
				.toLocaleLowerCase()
				.startsWith(queryText.toLocaleLowerCase())
		) {
			return "";
		}
		if (ghostSuggestion.queryText.length <= queryText.length) {
			return "";
		}
		return ghostSuggestion.queryText.slice(queryText.length);
	}

	function getOriginalIndex(displayIndex: number): number {
		return historySuggestions.length - 1 - displayIndex;
	}

	export function isSuggestionsActive(): boolean {
		return isHistoryDropdownOpen;
	}

	export async function moveSelectionByHotkey(
		direction: "next" | "prev",
	): Promise<boolean> {
		if (!isHistoryDropdownOpen || historySuggestions.length === 0) {
			return false;
		}
		moveHistorySelection(direction);
		await scrollSelectedSuggestionIntoView();
		return true;
	}

	export function acceptSelectedSuggestion(): boolean {
		const selectedHistory = getSelectedSuggestion();
		if (!selectedHistory) {
			return false;
		}
		acceptSuggestion(selectedHistory.queryText);
		return true;
	}

	async function scrollSuggestionsToBottom() {
		await tick();
		if (suggestionsEl) {
			suggestionsEl.scrollTop = suggestionsEl.scrollHeight;
		}
	}

	async function scrollSelectedSuggestionIntoView() {
		await tick();
		const selectedEl = suggestionsEl?.querySelector(
			".history-suggestion.selected",
		) as HTMLElement | null;
		selectedEl?.scrollIntoView({
			block: "nearest",
		});
	}
</script>

<div class="search-bar" data-match-count={matchCountText}>
	<div class="input-shell">
		{#if ghostSuffix}
			<div class="ghost-completion" aria-hidden="true">
				<span class="ghost-prefix">{queryText}</span>
				<span class="ghost-suffix">{ghostSuffix}</span>
			</div>
		{/if}
		<input
			id="cs-search-input"
			bind:this={searchInputEl}
			bind:value={queryText}
			on:blur={handleBlur}
			on:focus={handleFocus}
			on:input={handleInput}
			on:keydown={handleKeydown}
		/>
	</div>
	{#if isHistoryDropdownOpen}
		<ul bind:this={suggestionsEl} class="history-suggestions">
			{#each displayedHistorySuggestions as entry, index}
				<button
					class:selected={getOriginalIndex(index) === currHistoryIndex}
					class="history-suggestion"
					on:mousedown|preventDefault={() => {
						acceptSuggestion(entry.queryText);
					}}
					on:mouseenter={() => {
						currHistoryIndex = getOriginalIndex(index);
					}}
				>
					<span class="history-query">{entry.queryText}</span>
					{#if (entry.count ?? 1) > 1}
						<span class="history-count">{entry.count}</span>
					{/if}
				</button>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.search-bar {
		position: sticky;
		top: -0.2em;
		left: 0;
		z-index: 2;
		width: 97%;
		height: 30px;
	}

	.search-bar::after {
		content: attr(data-match-count);
		position: absolute;
		right: 0.6em;
		top: 1.4em;
		font-size: 0.8em;
		transform: translateY(-50%);
		color: var(--cs-hint-char-color, grey);
	}

	.search-bar .input-shell {
		position: relative;
		width: 100%;
		border-radius: 10px;
		background-color: var(--cs-search-bar-bgc, #20202066);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.07),
			0 2px 3px rgba(0, 0, 0, 0.1);
	}

	.search-bar .ghost-completion {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		padding: 8px 12px;
		overflow: hidden;
		pointer-events: none;
		white-space: nowrap;
	}

	.search-bar .ghost-prefix {
		visibility: hidden;
	}

	.search-bar .ghost-suffix {
		color: var(--cs-secondary-font-color, #a29c9c);
	}

	.search-bar input {
		position: relative;
		z-index: 1;
		width: 100%;
		padding: 8px 12px;
		border: none;
		border-radius: 10px;
		background-color: transparent;
		box-shadow: none;
	}

	.search-bar .history-suggestions {
		position: absolute;
		bottom: calc(100% + 0.45em);
		left: 0;
		z-index: 3;
		width: calc(100% + 0.2em);
		box-sizing: border-box;
		max-height: calc(4 * 1.9em + 3 * 0.06em + 0.24em);
		padding: 0.12em 0.18em;
		margin: 0;
		list-style: none;
		overflow-y: auto;
		background-color: var(--cs-pane-bgc, #202020dd);
		border-radius: 8px;
		box-shadow:
			0 8px 24px rgba(0, 0, 0, 0.12),
			0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.search-bar .history-suggestions .history-suggestion {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		height: 1.9em;
		box-sizing: border-box;
		padding: 0 0.44em;
		margin: 0 0 0.06em 0;
		text-align: left;
		line-height: 1.15;
		background-color: transparent;
		border-radius: 6px;
		cursor: pointer;
	}

	.search-bar .history-suggestions .history-suggestion:last-child {
		margin-bottom: 0;
	}

	.search-bar .history-suggestions .history-suggestion:hover,
	.search-bar .history-suggestions .history-suggestion.selected {
		background-color: var(--cs-item-selected-color, rgba(85, 85, 85, 0.35));
	}

	.search-bar .history-suggestions .history-query {
		font-size: 0.9em;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.search-bar .history-suggestions .history-count {
		flex-shrink: 0;
		margin-left: 0.5em;
		font-size: 0.74em;
		line-height: 1.2;
		color: var(--cs-secondary-font-color, #a29c9c);
	}
</style>
