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

	function refreshResults(resetIndex = false): void {
		if (mode === "quickCommand") {
			results = autocompleteService.getQuickCommandSuggestions(queryText, 24);
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
		if (mode === "quickCommand") {
			if (!isCommandAvailable(candidate.openLinkText)) {
				refreshResults(true);
				return;
			}
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

	function isCommandAvailable(commandId: string): boolean {
		return Boolean(
			(app as App & {
				commands?: {
					commands?: Record<string, unknown>;
				};
			}).commands?.commands?.[commandId],
		);
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
			case "quickCommand":
				return "autocompleteSource.quickCommand";
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
			entry.kind !== "quickCommand" &&
			entry.path.length > 0 &&
			entry.primaryText !== entry.path
		);
	}

	function getEmptyStateText(): string {
		if (mode === "quickCommand") {
			return queryText.trim().length === 0
				? t("quickSwitch.quickCommand.emptyState.idle")
				: t("quickSwitch.quickCommand.emptyState.search");
		}
		return queryText.trim().length === 0
			? t("quickSwitch.emptyState.idle")
			: t("quickSwitch.emptyState.search");
	}

	function getPlaceholderText(): string {
		return mode === "quickCommand"
			? t("quickSwitch.placeholder.quickCommand")
			: t("quickSwitch.placeholder.navigation");
	}

	function getFooterText(): string {
		return mode === "quickCommand"
			? t("quickSwitch.footer.quickCommand")
			: t("quickSwitch.footer.navigation");
	}

	function shouldShowKind(entry: SearchAutocompleteCandidate): boolean {
		return !(mode === "quickCommand" && entry.kind === "quickCommand");
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
							class:selected={index === selectedResultIndex}
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
		padding: 1rem 0.9rem 0.8rem;
		overflow: visible;
	}

	:global(.cs-modal.cs-quickswitch-modal.cs-quick-command-modal) {
		width: min(50rem, 66vw);
		max-width: 66vw;
	}

	.quickswitch-shell {
		--cs-highlight-char-color-fallback: #6a9ba8;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		width: 100%;
		min-width: 0;
		height: 100%;
		min-height: 0;
	}

	:global(.theme-dark) .quickswitch-shell {
		--cs-highlight-char-color-fallback: #5a93a2;
	}

	.quickswitch-header {
		flex: none;
	}

	.quickswitch-results {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding-right: 0.1rem;
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
		border-radius: 12px;
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
		margin: 0 0 0.12rem;
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
		min-height: 3.35rem;
		padding: 0.58rem 0.8rem 0.68rem;
		box-sizing: border-box;
		text-align: left;
		color: inherit;
		background-color: transparent !important;
		border: none;
		border-radius: 12px;
		box-shadow: none;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.quickswitch-result-button:hover,
	.quickswitch-result-button.selected,
	.quickswitch-result-item.selected .quickswitch-result-button {
		background-color: var(
			--background-modifier-hover,
			var(--cs-item-selected-color, rgba(85, 85, 85, 0.2))
		) !important;
	}

	.quickswitch-result-kind {
		flex: none;
		margin-top: 0.1rem;
		padding: 0;
		font-size: 0.72rem;
		line-height: 1.25;
		color: var(--cs-secondary-font-color, #a29c9c);
		white-space: nowrap;
	}

	.quickswitch-match {
		font-weight: 800;
		color: var(
			--cs-highlight-char-color,
			var(--cs-highlight-char-color-fallback)
		) !important;
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
		gap: 0.18rem;
		width: 100%;
		min-width: 0;
		overflow: visible;
	}

	.quickswitch-result-title-row {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		min-width: 0;
	}

	.quickswitch-result-title {
		display: block;
		flex: 1 1 0;
		min-width: 0;
		white-space: normal;
		line-height: 1.35;
		font-size: 1rem;
		font-weight: 400;
		overflow-wrap: anywhere;
	}

	.quickswitch-result-path,
	.quickswitch-result-secondary {
		display: block;
		width: 100%;
		white-space: normal;
		font-size: 0.79rem;
		line-height: 1.4;
		color: var(--cs-secondary-font-color, #a29c9c);
		overflow-wrap: anywhere;
		word-break: break-word;
	}
</style>
