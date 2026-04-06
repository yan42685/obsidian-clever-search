<script lang="ts">
	import { App } from "obsidian";
	import { tick } from "svelte";
	import { OuterSetting } from "src/globals/plugin-setting";
	import { PrivateApi } from "src/services/obsidian/private-api";
	import { t } from "src/services/obsidian/translations/locale-helper";
	import {
		type SearchAutocompleteMode,
		SearchAutocompleteService,
		type SearchAutocompleteCandidate,
		type SearchAutocompleteSection,
		type SearchAutocompleteSource,
	} from "src/services/obsidian/user-data/search-autocomplete-service";
	import { SearchHistoryService } from "src/services/obsidian/user-data/search-history-service";
	import { getInstance } from "src/utils/my-lib";
	import type { SearchHistoryInput } from "./SearchHistoryInput.svelte";
	import SearchHistoryInputView from "./SearchHistoryInput.svelte";

	const app = getInstance(App);
	const privateApi = getInstance(PrivateApi);
	const searchHistoryService = getInstance(SearchHistoryService);
	const autocompleteService = getInstance(SearchAutocompleteService);

	export let requestClose: () => void = () => {};
	export let mode: SearchAutocompleteMode = "navigation";
	const PAGE_JUMP = 6;

	let inputRef: SearchHistoryInput | null = null;
	let queryText = "";
	let results: SearchAutocompleteCandidate[] = [];
	let selectedResultIndex = -1;
	let resultButtons: Array<HTMLButtonElement | null> = [];

	function getSetting(): OuterSetting {
		return getInstance(OuterSetting);
	}

	export async function activate(): Promise<void> {
		refreshResults(true);
		await tick();
		inputRef?.focusInput?.();
	}

	$: if (selectedResultIndex >= results.length) {
		selectedResultIndex = results.length > 0 ? 0 : -1;
	}

	$: if (selectedResultIndex >= 0) {
		void scrollSelectedIntoView();
	}

	function getRecentCommandFallbackResults(
		limit: number,
	): SearchAutocompleteCandidate[] {
		return searchHistoryService.getRecentCommandSelections(limit).map((entry) => ({
			id: "recent-command-fallback:" + entry.openLinkText,
			kind: "command",
			section: "recent-targets",
			insertText: entry.primaryText,
			primaryText: entry.primaryText,
			secondaryText: entry.secondaryText,
			path: entry.path,
			openLinkText: entry.openLinkText,
			positions: [],
			pathPositions: [],
			secondaryPositions: [],
			score: entry.timestamp,
			confidence: "medium",
		}));
	}

	function refreshResults(resetIndex = false): void {
		if (mode === "command") {
			results =
				queryText.trim().length === 0
					? getRecentCommandFallbackResults(24)
					: autocompleteService.getCommandSuggestions(queryText, 24);
		} else {
			results = autocompleteService.getNavigationSuggestions(queryText, 24);
		}
		resultButtons = [];
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

	function moveSelectedResultTo(index: number): void {
		if (results.length === 0) {
			selectedResultIndex = -1;
			return;
		}
		selectedResultIndex = Math.min(Math.max(index, 0), results.length - 1);
	}

	function moveSelectedResultByPage(direction: "up" | "down"): void {
		if (results.length === 0) {
			selectedResultIndex = -1;
			return;
		}
		const fallbackIndex = direction === "down" ? 0 : results.length - 1;
		const baseIndex = selectedResultIndex >= 0 ? selectedResultIndex : fallbackIndex;
		const delta = direction === "down" ? PAGE_JUMP : -PAGE_JUMP;
		moveSelectedResultTo(baseIndex + delta);
	}

	async function openResult(index = selectedResultIndex): Promise<void> {
		const candidate = results[index];
		if (!candidate?.openLinkText) {
			return;
		}
		if (mode === "command") {
			await searchHistoryService.recordNavigationSelection(queryText, {
				path: candidate.path,
				primaryText: candidate.primaryText,
				secondaryText: candidate.secondaryText,
				kind: candidate.kind,
				openLinkText: candidate.openLinkText,
			});
			privateApi.executeCommandById(candidate.openLinkText);
			requestClose();
			return;
		}
		if (queryText.trim().length > 0) {
			await searchHistoryService.recordQuery(queryText);
		}
		await searchHistoryService.recordNavigationSelection(queryText, {
			path: candidate.path,
			primaryText: candidate.primaryText,
			secondaryText: candidate.secondaryText,
			kind: candidate.kind,
			openLinkText: candidate.openLinkText,
		});
		await app.workspace.openLinkText(
			candidate.openLinkText,
			"",
			getSetting().ui.openInNewPane,
		);
		requestClose();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.isComposing) {
			return;
		}
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
			if (selectedResultIndex >= 0) {
				void openResult();
				return;
			}
			if (results.length === 1 && results[0]?.confidence === "high") {
				void openResult(0);
			}
			return;
		}

		if (event.key === "Home") {
			event.preventDefault();
			event.stopPropagation();
			moveSelectedResultTo(0);
			return;
		}

		if (event.key === "End") {
			event.preventDefault();
			event.stopPropagation();
			moveSelectedResultTo(results.length - 1);
			return;
		}

		if (event.key === "PageUp") {
			event.preventDefault();
			event.stopPropagation();
			moveSelectedResultByPage("up");
			return;
		}

		if (event.key === "PageDown") {
			event.preventDefault();
			event.stopPropagation();
			moveSelectedResultByPage("down");
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
			case "command":
				return "autocompleteSource.command";
		}
	}

	function getSectionLabel(section: SearchAutocompleteSection): string {
		switch (section) {
			case "recent-targets":
				return t("quickSwitch.section.recentTargets");
			case "recent-files":
				return t("quickSwitch.section.recentFiles");
			case "matches":
				return "";
		}
	}

	function shouldShowSectionHeader(index: number): boolean {
		if (queryText.trim().length === 0) {
			return false;
		}
		return index === 0 || results[index - 1]?.section !== results[index]?.section;
	}

	function shouldShowPath(entry: SearchAutocompleteCandidate): boolean {
		return (
			entry.kind !== "command" &&
			entry.path.length > 0 &&
			entry.primaryText !== entry.path
		);
	}

	function getEmptyStateText(): string {
		if (mode === "command") {
			return queryText.trim().length === 0
				? t("quickSwitch.command.emptyState.idle")
				: t("quickSwitch.command.emptyState.search");
		}
		return queryText.trim().length === 0
			? t("quickSwitch.emptyState.idle")
			: t("quickSwitch.emptyState.search");
	}

	function getPlaceholderText(): string {
		return mode === "command"
			? t("quickSwitch.placeholder.command")
			: t("quickSwitch.placeholder.navigation");
	}

	function getFooterText(): string {
		return mode === "command"
			? t("quickSwitch.footer.command")
			: t("quickSwitch.footer.navigation");
	}

	function shouldShowKind(entry: SearchAutocompleteCandidate): boolean {
		return !(mode === "command" && entry.kind === "command");
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

	async function scrollSelectedIntoView(): Promise<void> {
		await tick();
		resultButtons[selectedResultIndex]?.scrollIntoView({ block: "nearest" });
	}

</script>

<div class="quickswitch-shell" on:keydown={handleKeydown}>
	<div class="quickswitch-header">
		<SearchHistoryInputView
			bind:this={inputRef}
			bind:queryText
			variant="omni"
			completionMode="plain"
			showMatchCount={results.length > 0}
			matchCountText={results.length > 0 ? `${Math.max(0, selectedResultIndex) + 1} / ${results.length}` : ""}
			placeholder={getPlaceholderText()}
			on:querychange={() => {
				refreshResults(true);
			}}
		/>
	</div>

	<div class="quickswitch-results">
		{#if results.length === 0}
			<div class="quickswitch-empty">{getEmptyStateText()}</div>
		{:else}
			<ul class="quickswitch-result-list">
				{#each results as entry, index}
					{#if shouldShowSectionHeader(index)}
						<li class="quickswitch-section">{getSectionLabel(entry.section)}</li>
					{/if}
					<li class:selected={index === selectedResultIndex} class="quickswitch-result-item">
						<button
							type="button"
							class="quickswitch-result-button"
							bind:this={resultButtons[index]}
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
									{#if shouldShowKind(entry)}
									<span class="quickswitch-result-kind">{t(getSourceLabelKey(entry.kind))}</span>
								{/if}
								</div>
								{#if shouldShowPath(entry)}
									<span class="quickswitch-result-path">
										{#each getHighlightParts(entry.path, entry.pathPositions) as part}
											{#if part.matched}
												<strong class="quickswitch-match">{part.text}</strong>
											{:else}
												<span>{part.text}</span>
											{/if}
										{/each}
									</span>
								{/if}
								{#if entry.secondaryText}
									<span class="quickswitch-result-secondary">
										{#each getHighlightParts(entry.secondaryText, entry.secondaryPositions) as part}
											{#if part.matched}
												<strong class="quickswitch-match">{part.text}</strong>
											{:else}
												<span>{part.text}</span>
											{/if}
										{/each}
									</span>
								{/if}
							</div>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="quickswitch-footer">
		<span>{getFooterText()}</span>
		<span>{t("quickSwitch.footer.keys")}</span>
	</div>
</div>
<style>
	:global(.cs-modal.cs-quickswitch-modal) {
		width: min(50rem, 66vw);
		max-width: 66vw;
		height: min(78vh, 48rem);
		padding: 1.05rem 0.95rem 0.85rem;
		overflow: visible;
	}

	:global(.cs-modal.cs-quickswitch-modal.cs-command-switch-modal) {
		width: min(50rem, 66vw);
		max-width: 66vw;
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
		padding-right: 0.15rem;
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

	.quickswitch-section {
		margin: 0.75rem 0 0.35rem;
		padding: 0 0.35rem;
		font-size: 0.74rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--text-muted);
		text-transform: uppercase;
	}

	.quickswitch-section:first-child {
		margin-top: 0;
	}

	.quickswitch-result-item {
		display: block;
		margin: 0 0 0.34rem;
	}

	.quickswitch-result-item:last-child {
		margin-bottom: 0;
	}

	.quickswitch-result-button {
		display: flex;
		align-items: stretch;
		width: 100%;
		min-width: 0;
		height: auto;
		min-height: 3.52rem;
		padding: 0.53rem 0.85rem 0.86rem;
		box-sizing: border-box;
		text-align: left;
		color: inherit;
		background-color: var(--cs-pane-bgc, #20202066);
		border: 1px solid var(--background-modifier-border, rgba(255, 255, 255, 0.08));
		border-radius: 10px;
		box-shadow: none;
		cursor: pointer;
	}

	.quickswitch-result-button:hover,
	.quickswitch-result-item.selected .quickswitch-result-button {
		background-color: var(--cs-item-selected-color, rgba(85, 85, 85, 0.35));
	}

	.quickswitch-result-kind {
		flex: none;
		margin-top: 0.05rem;
		padding: 0.08rem 0.38rem;
		font-size: 0.62rem;
		line-height: 1.2;
		color: var(--cs-secondary-font-color, #a29c9c);
		background-color: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 999px;
		white-space: nowrap;
	}

	.quickswitch-match {
		font-weight: 800;
		color: var(--text-accent, var(--text-normal));
		text-decoration: none;
	}

	.quickswitch-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		min-width: 0;
		flex-wrap: wrap;
		font-size: 0.76rem;
		color: var(--text-muted);
	}


	.quickswitch-result-copy {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		justify-content: center;
		gap: 0.24rem;
		width: 100%;
		min-width: 0;
		overflow: visible;
	}

	.quickswitch-result-title-row {
		display: flex;
		align-items: start;
		gap: 0.7rem;
		min-width: 0;
	}

	.quickswitch-result-title {
		display: block;
		flex: 1 1 0;
		min-width: 0;
		white-space: normal;
		line-height: 1.4;
		font-size: 0.95rem;
		font-weight: 400;
		overflow-wrap: anywhere;
	}

	.quickswitch-result-path,
	.quickswitch-result-secondary {
		display: block;
		width: 100%;
		white-space: normal;
		font-size: 0.78rem;
		line-height: 1.4;
		color: var(--cs-secondary-font-color, #a29c9c);
		overflow-wrap: anywhere;
		word-break: break-word;
	}
</style>
