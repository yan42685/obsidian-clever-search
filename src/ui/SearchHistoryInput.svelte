<script lang="ts">
	import { OuterSetting, type SearchHistoryEntry } from "src/globals/plugin-setting";
	import {
		SearchHistoryService,
		type SearchHistorySuggestion,
	} from "src/services/obsidian/user-data/search-history-service";
	import { t } from "src/services/obsidian/translations/locale-helper";
	import {
		shouldSuppressAutoGhostCompletionForQuery,
		shouldSuppressAutoSuggestionsForQuery,
	} from "src/ui/search-history-auto-suppression";
	import { shouldHideSingleRedundantSuggestion } from "src/ui/search-history-suggestion-visibility";
	import { getInstance } from "src/utils/my-lib";
	import { createEventDispatcher, tick } from "svelte";

	const searchHistoryService = getInstance(SearchHistoryService);
	const setting = getInstance(OuterSetting);
	const dispatch = createEventDispatcher<{
		querychange: void;
	}>();

	export let queryText: string;
	export let matchCountText: string;
	export let placeholder = "";
	export let variant: "default" | "omni" = "default";
	export let showMatchCount = true;
	export let completionMode: "history" | "plain" = "history";

	type HighlightPart = {
		text: string;
		matched: boolean;
	};
	const RECENT_SELECTION_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;
	const MAX_RECENT_BADGES = 3;

	let historySuggestions: SearchHistorySuggestion[] = [];
	let currHistoryIndex = -1;
	let isHistoryDropdownOpen = false;
	let ghostSuggestion: SearchHistoryEntry | null = null;
	let suppressSuggestionsOnce = false;
	let isCaretAtEnd = true;
	let isInputFocused = false;
	let isComposing = false;
	let manualSuggestionsOpen = false;
	let suppressAutoSuggestions = false;
	let suppressAutoGhostCompletion = false;
	let lastAcceptedQuery = "";
	let lastDismissedSuggestionQuery = "";
	let searchInputEl: HTMLInputElement;
	let suggestionsEl: HTMLUListElement;
	let editableQueryText = "";
	let normalizedQueryText = "";
	let ghostSuffix = "";
	let recentSuggestionQueries = new Set<string>();

	$: editableQueryText = normalizeEditableText(queryText);
	$: normalizedQueryText = editableQueryText.trim();
	$: ghostSuffix = getGhostSuffix(ghostSuggestion, editableQueryText);
	$: recentSuggestionQueries = getRecentSuggestionQueries(historySuggestions);
	$: if (completionMode === "plain") {
		ghostSuggestion = null;
		closeHistorySuggestions();
	}
	$: if (searchInputEl) {
		if (searchInputEl.value !== editableQueryText) {
			searchInputEl.value = editableQueryText;
		}
	}

	function isHistoryCompletionEnabled(): boolean {
		return completionMode === "history" && searchHistoryService.isEnabled();
	}

	function updateSuggestionsState() {
		const prevSelectedQuery = getSelectedSuggestion()?.queryText ?? null;
		clearAutoSuppressionsIfNeeded();
		if (suppressSuggestionsOnce) {
			ghostSuggestion = null;
			closeHistorySuggestions();
			suppressSuggestionsOnce = false;
			return;
		}

		if (!isHistoryCompletionEnabled()) {
			ghostSuggestion = null;
			closeHistorySuggestions();
			return;
		}

		const nextGhostSuggestion =
			setting.searchHistory.enableGhostCompletion &&
			!suppressAutoGhostCompletion &&
			isInputFocused &&
			isCaretAtEnd &&
			!isComposing
				? searchHistoryService.getGhostSuggestion(queryText)
				: null;
		ghostSuggestion = nextGhostSuggestion;

		const shouldShowSuggestions =
			manualSuggestionsOpen ||
			(setting.searchHistory.showSuggestions && !suppressAutoSuggestions);

		const rawSuggestions = shouldShowSuggestions
			? searchHistoryService.getCandidateSuggestions(queryText)
			: [];
		historySuggestions = prioritizeGhostSuggestion(
			rawSuggestions,
			nextGhostSuggestion,
			normalizedQueryText,
		);
		if (
			shouldHideSingleRedundantSuggestion(
				historySuggestions,
				nextGhostSuggestion,
				manualSuggestionsOpen,
			)
		) {
			closeHistorySuggestions();
			return;
		}
		isHistoryDropdownOpen = historySuggestions.length > 0;
		if (!isHistoryDropdownOpen) {
			manualSuggestionsOpen = false;
			currHistoryIndex = -1;
			return;
		}

		if (prevSelectedQuery) {
			const preservedIndex = historySuggestions.findIndex(
				(entry) => entry.queryText === prevSelectedQuery,
			);
			if (preservedIndex >= 0) {
				currHistoryIndex = preservedIndex;
				return;
			}
		}

		currHistoryIndex = 0;
	}

	function closeHistorySuggestions() {
		historySuggestions = [];
		currHistoryIndex = -1;
		isHistoryDropdownOpen = false;
		manualSuggestionsOpen = false;
	}

	function dismissSuggestionsForCurrentQuery() {
		lastDismissedSuggestionQuery = normalizedQueryText;
		suppressAutoSuggestions = true;
		closeHistorySuggestions();
	}

	export function consumeEscape(): boolean {
		if (!isHistoryDropdownOpen) {
			return false;
		}
		dismissSuggestionsForCurrentQuery();
		return true;
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
			return;
		}

		currHistoryIndex =
			(currHistoryIndex - 1 + historySuggestions.length) %
			historySuggestions.length;
	}

	function notifyQueryChanged() {
		dispatch("querychange");
	}

	function acceptSuggestion(query: string) {
		void searchHistoryService.recordSuggestionSelection(query);
		queryText = query;
		lastAcceptedQuery = normalizeEditableText(query).trim();
		suppressAutoSuggestions = true;
		suppressAutoGhostCompletion = true;
		syncEditableText(true);
		suppressSuggestionsOnce = true;
		closeHistorySuggestions();
		updateSuggestionsState();
		notifyQueryChanged();
		searchInputEl?.focus();
	}

	function getSelectedSuggestion(): SearchHistorySuggestion | null {
		if (!isHistoryDropdownOpen || historySuggestions.length === 0) {
			return null;
		}
		return historySuggestions[currHistoryIndex] ?? historySuggestions[0] ?? null;
	}

	function handleInput() {
		queryText = normalizeEditableText(searchInputEl?.value ?? "");
		syncEditableText();
		updateCaretState();
		updateSuggestionsState();
		notifyQueryChanged();
	}

	function handleFocus() {
		isInputFocused = true;
		updateCaretState();
		updateSuggestionsState();
	}

	function handleBlur() {
		isInputFocused = false;
		isCaretAtEnd = false;
		setTimeout(() => closeHistorySuggestions(), 100);
	}

	async function removeSuggestion(query: string) {
		await searchHistoryService.removeQuery(query);
		updateSuggestionsState();
		searchInputEl?.focus();
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

		if (!isHistoryDropdownOpen && event.key === "Tab" && ghostSuffix && ghostSuggestion) {
			event.preventDefault();
			event.stopPropagation();
			acceptSuggestion(ghostSuggestion.queryText);
			return;
		}

		if (event.key === "Escape" && consumeEscape()) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		if (event.key === "Delete" && isHistoryDropdownOpen) {
			const selectedHistory = getSelectedSuggestion();
			if (selectedHistory) {
				event.preventDefault();
				event.stopPropagation();
				void removeSuggestion(selectedHistory.queryText);
				return;
			}
		}

		if (event.key === "Enter") {
			if (isHistoryDropdownOpen && historySuggestions.length > 0) {
				const selectedHistory = getSelectedSuggestion();
				if (!selectedHistory) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				acceptSuggestion(selectedHistory.queryText);
				return;
			}
			event.preventDefault();
			return;
		}
	}

	function handleSelectionChange() {
		updateCaretState();
		updateSuggestionsState();
	}

	function handleCompositionStart() {
		isComposing = true;
		ghostSuggestion = null;
	}

	function handleCompositionEnd() {
		isComposing = false;
		handleInput();
	}

	function getGhostSuffix(
		suggestion: SearchHistoryEntry | null,
		rawQueryText: string,
	): string {
		if (!suggestion || rawQueryText.trim().length === 0) {
			return "";
		}

		const normalizedSuggestion = normalizeEditableText(suggestion.queryText);
		if (
			!normalizedSuggestion
				.toLocaleLowerCase()
				.startsWith(rawQueryText.toLocaleLowerCase())
		) {
			return "";
		}
		if (normalizedSuggestion.length <= rawQueryText.length) {
			return "";
		}
		return normalizedSuggestion.slice(rawQueryText.length);
	}

	function normalizeEditableText(text: string): string {
		return text.replace(/\u00a0/g, " ").replace(/\r?\n/g, "");
	}

	function clearAutoSuppressionsIfNeeded() {
		suppressAutoSuggestions = shouldSuppressAutoSuggestionsForQuery(
			normalizedQueryText,
			lastAcceptedQuery,
			lastDismissedSuggestionQuery,
		);
		suppressAutoGhostCompletion = shouldSuppressAutoGhostCompletionForQuery(
			normalizedQueryText,
			lastAcceptedQuery,
		);
		if (normalizedQueryText !== lastDismissedSuggestionQuery) {
			lastDismissedSuggestionQuery = "";
		}
	}

	function updateCaretState() {
		isCaretAtEnd = isCaretAtEndInElement(searchInputEl);
	}

	function syncEditableText(moveCaretToEnd = false) {
		if (!searchInputEl) {
			return;
		}

		const normalizedText = normalizeEditableText(queryText);
		if (searchInputEl.value !== normalizedText) {
			searchInputEl.value = normalizedText;
		}

		if (moveCaretToEnd) {
			placeCaretAtEnd();
		}
	}

	function placeCaretAtEnd() {
		if (!searchInputEl) {
			return;
		}
		const end = searchInputEl.value.length;
		searchInputEl.setSelectionRange(end, end);
	}

	function isCaretAtEndInElement(element: HTMLInputElement | undefined): boolean {
		if (!element) {
			return false;
		}
		if (document.activeElement !== element) {
			return false;
		}
		const selectionStart = element.selectionStart;
		const selectionEnd = element.selectionEnd;
		if (selectionStart === null || selectionEnd === null) {
			return false;
		}
		if (selectionStart !== selectionEnd) {
			return false;
		}
		return selectionEnd >= normalizeEditableText(element.value).length;
	}

	function prioritizeGhostSuggestion(
		suggestions: SearchHistorySuggestion[],
		prioritizedSuggestion: SearchHistoryEntry | null,
		normalizedQuery: string,
	): SearchHistorySuggestion[] {
		if (!prioritizedSuggestion) {
			return suggestions;
		}

		const prioritizedQuery = prioritizedSuggestion.queryText.trim().toLocaleLowerCase();
		const remainingSuggestions = suggestions.filter(
			(entry) => entry.queryText.trim().toLocaleLowerCase() !== prioritizedQuery,
		);

		return [
			toPrioritySuggestion(prioritizedSuggestion, normalizedQuery),
			...remainingSuggestions,
		];
	}

	function toPrioritySuggestion(
		entry: SearchHistoryEntry,
		normalizedQuery: string,
	): SearchHistorySuggestion {
		return {
			...entry,
			positions: Array.from(
				{ length: Math.min(normalizedQuery.length, entry.queryText.length) },
				(_, index) => index,
			),
			fuzzyScore: 1,
			historyScore: 1,
			compositeScore: Number.MAX_SAFE_INTEGER,
		};
	}

	function getRecentSuggestionQueries(
		suggestions: SearchHistorySuggestion[],
	): Set<string> {
		const cutoff = Date.now() - RECENT_SELECTION_WINDOW_MS;
		return new Set(
			suggestions
				.filter((entry) => (entry.selectionTimestamp ?? 0) >= cutoff)
				.sort(
					(left, right) =>
						(right.selectionTimestamp ?? 0) - (left.selectionTimestamp ?? 0),
				)
				.slice(0, MAX_RECENT_BADGES)
				.map((entry) => entry.queryText),
		);
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

	export function toggleSuggestionsByHotkey(): boolean {
		if (!isHistoryCompletionEnabled() || normalizedQueryText.length === 0) {
			return false;
		}

		if (isHistoryDropdownOpen) {
			dismissSuggestionsForCurrentQuery();
			return true;
		}

		manualSuggestionsOpen = true;
		updateSuggestionsState();
		searchInputEl?.focus();
		return isHistoryDropdownOpen;
	}

	export function acceptSelectedSuggestion(): boolean {
		const selectedHistory = getSelectedSuggestion();
		if (!selectedHistory) {
			return false;
		}
		acceptSuggestion(selectedHistory.queryText);
		return true;
	}

	export function focusInput(): void {
		searchInputEl?.focus();
		placeCaretAtEnd();
	}

	async function scrollSelectedSuggestionIntoView() {
		await tick();
		const selectedEl = suggestionsEl?.querySelector(
			".history-suggestion-item.selected",
		) as HTMLElement | null;
		selectedEl?.scrollIntoView({ block: "nearest" });
	}

	function getHighlightParts(
		text: string,
		positions: number[],
	): HighlightPart[] {
		if (positions.length === 0) {
			return [{ text, matched: false }];
		}

		const positionSet = new Set(positions);
		const segments: HighlightPart[] = [];
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
</script>

<div
	class="search-bar"
	class:omni-variant={variant === "omni"}
	class:has-match-count={showMatchCount && !!matchCountText}
>
	<div class="history-input-shell">
		<div class="history-input-overlay" aria-hidden="true">
			{#if !editableQueryText && !ghostSuffix && placeholder}
				<span class="history-placeholder">{placeholder}</span>
			{:else if ghostSuffix}
				<span class="history-input-spacer">{editableQueryText}</span>
			{/if}
			{#if ghostSuffix}
				<span class="history-input-ghost">{ghostSuffix}</span>
			{/if}
		</div>
		<input
			id="cs-search-input"
			bind:this={searchInputEl}
			class="history-editable"
			type="text"
			value={editableQueryText}
			aria-autocomplete={completionMode === "history" ? "both" : "none"}
			autocomplete="off"
			autocapitalize="off"
			autocorrect="off"
			spellcheck="false"
			tabindex="0"
			on:blur={handleBlur}
			on:compositionend={handleCompositionEnd}
			on:compositionstart={handleCompositionStart}
			on:focus={handleFocus}
			on:input={handleInput}
			on:keydown={handleKeydown}
			on:keyup={handleSelectionChange}
			on:click={handleSelectionChange}
			on:mouseup={handleSelectionChange}
			on:select={handleSelectionChange}
		/>
		{#if showMatchCount && matchCountText}
			<span class="history-match-count-badge" aria-hidden="true">
				{matchCountText}
			</span>
		{/if}
	</div>
	{#if isHistoryDropdownOpen}
		<div class="history-suggestions-anchor">
			<ul bind:this={suggestionsEl} class="history-suggestions">
				{#each historySuggestions as entry, index}
					<li
						class:selected={index === currHistoryIndex}
						class="history-suggestion-item"
						on:mouseenter={() => {
							currHistoryIndex = index;
						}}
					>
						<button
							class="history-suggestion-main"
							on:mousedown|preventDefault={() => {
								acceptSuggestion(entry.queryText);
							}}
						>
							<span class="history-query">
								{#each getHighlightParts(entry.queryText, entry.positions) as part}
									{#if part.matched}
										<strong class="history-match">{part.text}</strong>
									{:else}
										<span>{part.text}</span>
									{/if}
								{/each}
							</span>
							{#if recentSuggestionQueries.has(entry.queryText)}
								<span class="history-recent">{t("Recent")}</span>
							{/if}
							{#if (entry.count ?? 1) > 1}
								<span class="history-count">{entry.count}</span>
							{/if}
						</button>
						<button
							class="history-delete"
							aria-label={`Delete history entry ${entry.queryText}`}
							on:mousedown|preventDefault|stopPropagation={() => {
								void removeSuggestion(entry.queryText);
							}}
						>
							x
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.search-bar {
		--cs-history-row-height: 1.58em;
		--cs-history-row-gap: 0.02em;
		--cs-history-dropdown-offset: 0.04em;
		--cs-history-right-slot: 0px;
		position: sticky;
		top: -0.2em;
		left: 0;
		z-index: 2;
		width: 97%;
		height: 30px;
	}

	.search-bar.has-match-count {
		--cs-history-right-slot: 3.8rem;
	}

	.history-input-shell {
		position: absolute;
		inset: 0;
		isolation: isolate;
		border-radius: 10px;
		background-color: var(--cs-search-bar-bgc, var(--modal-background, var(--background-primary, #20202066)));
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.07),
			0 2px 3px rgba(0, 0, 0, 0.1);
	}

	.history-input-overlay {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		padding: 8px calc(12px + var(--cs-history-right-slot)) 8px 12px;
		box-sizing: border-box;
		overflow: hidden;
		pointer-events: none;
		white-space: pre;
		font: inherit;
		line-height: inherit;
		letter-spacing: inherit;
	}

	.history-placeholder {
		flex: none;
		color: var(--text-muted);
		font: inherit;
		line-height: inherit;
		letter-spacing: inherit;
		white-space: pre;
	}

	.history-input-spacer {
		flex: none;
		visibility: hidden;
		font: inherit;
		line-height: inherit;
		letter-spacing: inherit;
		white-space: pre;
	}

	.history-editable {
		position: absolute;
		inset: 0;
		z-index: 2;
		width: 100%;
		height: 100%;
		padding: 8px calc(12px + var(--cs-history-right-slot)) 8px 12px;
		box-sizing: border-box;
		color: var(--text-normal);
		-webkit-text-fill-color: var(--text-normal);
		-webkit-appearance: none;
		appearance: none;
		outline: none;
		border: none;
		background: transparent;
		background-image: none;
		box-shadow: none;
		white-space: pre;
		overflow: hidden;
		text-overflow: clip;
		font: inherit;
		line-height: inherit;
		letter-spacing: inherit;
		caret-color: var(--text-normal);
		cursor: text;
	}

	.history-match-count-badge {
		position: absolute;
		top: 50%;
		right: 12px;
		z-index: 3;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		font-size: 0.8em;
		color: var(--cs-hint-char-color, grey);
		transform: translateY(-50%);
		pointer-events: none;
	}

	.history-input-ghost {
		flex: none;
		font: inherit;
		line-height: inherit;
		letter-spacing: inherit;
		font-weight: inherit;
		color: var(--cs-secondary-font-color, #a29c9c);
		opacity: 0.55;
		white-space: pre;
	}

	.history-suggestions-anchor {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 4;
		width: 100%;
		transform: translateY(
			calc(-100% - var(--cs-history-dropdown-offset))
		);
	}

	.history-suggestions {
		display: flex;
		flex-direction: column-reverse;
		max-height: calc(
			4 * var(--cs-history-row-height) + 3 * var(--cs-history-row-gap) + 0.04em
		);
		box-sizing: border-box;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		background-color: var(--cs-pane-bgc, #202020dd);
		border-radius: 8px;
		box-shadow:
			0 8px 24px rgba(0, 0, 0, 0.12),
			0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.history-suggestion-item {
		display: flex;
		align-items: center;
		gap: 0.08em;
		height: var(--cs-history-row-height);
		margin: 0;
		padding: 0;
	}

	.history-suggestion-item + .history-suggestion-item {
		margin-top: var(--cs-history-row-gap);
	}

	.history-suggestion-item.selected,
	.history-suggestion-item:hover {
		background-color: var(--cs-item-selected-color, rgba(85, 85, 85, 0.35));
	}

	.history-suggestion-main {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex: 1 1 auto;
		height: var(--cs-history-row-height);
		margin: 0;
		padding: 0 0 0 12px;
		box-sizing: border-box;
		text-align: left;
		line-height: 1.15;
		font: inherit;
		color: inherit;
		background: transparent;
		border: none;
		border-radius: 6px;
		box-shadow: none;
		cursor: pointer;
	}

	.history-delete {
		flex: none;
		width: 1.3em;
		height: 1.3em;
		margin-right: 0.18em;
		padding: 0;
		line-height: 1;
		font: inherit;
		color: var(--cs-secondary-font-color, #a29c9c);
		background: transparent;
		border: none;
		border-radius: 999px;
		cursor: pointer;
	}

	.history-delete:hover {
		background-color: rgba(255, 255, 255, 0.08);
		color: var(--text-normal);
	}

	.history-query {
		font-size: 0.9em;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-match {
		font-weight: 700;
	}

	.history-count {
		flex: none;
		margin-left: 0.5em;
		font-size: 0.74em;
		color: var(--cs-secondary-font-color, #a29c9c);
	}

	.history-recent {
		flex: none;
		margin-left: 0.45em;
		padding: 0.02em 0.42em;
		font-size: 0.64em;
		line-height: 1.35;
		color: var(--cs-secondary-font-color, #a29c9c);
		background-color: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 999px;
		text-transform: lowercase;
	}

	.search-bar.omni-variant {
		position: relative;
		top: auto;
		left: auto;
		width: 100%;
		height: 2.75rem;
	}

	.search-bar.omni-variant.has-match-count {
		--cs-history-right-slot: 4.4rem;
	}

	.search-bar.omni-variant .history-input-shell {
		border-radius: 10px;
		background-color: var(--cs-search-bar-bgc, var(--modal-background, var(--background-primary, #1f1f1f)));
		border: 1px solid var(--background-modifier-border, rgba(0, 0, 0, 0.12));
		box-shadow: none !important;
		outline: none;
		background-image: none;
		overflow: hidden;
	}

	.search-bar.omni-variant .history-input-shell:focus-within {
		border-color: var(--background-modifier-border, rgba(0, 0, 0, 0.12));
		box-shadow: none !important;
		outline: none;
	}

	.search-bar.omni-variant .history-input-overlay,
	.search-bar.omni-variant .history-editable {
		padding: 0.8rem calc(0.95rem + var(--cs-history-right-slot)) 0.8rem 0.95rem;
	}

	.search-bar.omni-variant .history-editable {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
		background: transparent !important;
	}

	.search-bar.omni-variant .history-match-count-badge {
		right: 0.95rem;
		font-size: 0.88rem;
	}

	.search-bar.omni-variant .history-suggestions-anchor {
		top: calc(100% + 0.35rem);
		transform: none;
	}

	.search-bar.omni-variant .history-suggestions {
		flex-direction: column;
		max-height: calc(
			4 * var(--cs-history-row-height) + 3 * var(--cs-history-row-gap) + 0.2rem
		);
		background-color: var(--background-primary, #1f1f1f);
		border: 1px solid var(--background-modifier-border, rgba(255, 255, 255, 0.08));
	}
</style>
