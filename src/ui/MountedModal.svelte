<script lang="ts">
	import { HTML_4_SPACES, NULL_NUMBER } from "src/globals/constants";
	import { EventEnum } from "src/globals/enums";
	import { OuterSetting } from "src/globals/plugin-setting";
	import {
		type HybridSearchMode,
		FileItem,
		FileSubItem,
		LineItem,
		SearchResult,
		SearchType,
	} from "src/globals/search-types";
	import { SearchService } from "src/services/obsidian/search-service";
	import { t, type LocaleKey } from "src/services/obsidian/translations/locale-helper";
	import { SearchHistoryService } from "src/services/obsidian/user-data/search-history-service";
	import { ViewType } from "src/services/obsidian/view-registry";
	import { eventBus, type EventCallback } from "src/utils/event-bus";
	import { logger } from "src/utils/logger";
	import { TO_BE_IMPL, getInstance, isDevEnvironment } from "src/utils/my-lib";
	import { onDestroy, tick } from "svelte";
	import { debounce } from "throttle-debounce";
	import {
		AutoHybridFallbackController,
		createHiddenHybridFreshnessNoticeState,
		getMountedModalFileItemScore,
		HybridFreshnessNoticeController,
		HybridQuerySessionController,
		type HybridFreshnessNoticeState,
		usesDirectFileSubItems,
	} from "./mounted-modal-helper";
	import SearchHistoryInput from "./SearchHistoryInput.svelte";
	import { ViewHelper } from "./view-helper";

	const searchService: SearchService = getInstance(SearchService);
	const searchHistoryService = getInstance(SearchHistoryService);
	const setting = getInstance(OuterSetting);
	const viewHelper = getInstance(ViewHelper);

	export let uiType: "modal" | "floatingWindow";
	export let onConfirmExternal: () => void;
	export let searchType: SearchType;
	export let isHybrid: boolean = false; // hybrid dense + lexical search
	export let hybridMode: HybridSearchMode = "default";
	export let queryText: string;

	const cachedResult = new Map<string, SearchResult>(); // remove the unnecessary latency when backspacing
	let searchResult: SearchResult = new SearchResult("", []);
	let currItemIndex = NULL_NUMBER;
	let currContext = ""; // for previewing in-file search

	let currFileItem: FileItem | null = null; // for previewing in-vault search
	let currFileSubItems: FileSubItem[] = []; // for markdown viewType
	let currFilePreviewContent: any = undefined; // for non-markdown viewType
	let currSubItemIndex = NULL_NUMBER;
	let latestSearchRequestId = 0;
	let historyInputRef: any;
	let hybridFreshnessNotice: HybridFreshnessNoticeState =
		createHiddenHybridFreshnessNoticeState();

	function shouldCacheAutoHybridFallbackResult(result: SearchResult): boolean {
		return result.hybridSearchOutcome === "success" && result.items.length > 0;
	}

	const autoHybridFallback = new AutoHybridFallbackController({
		searchService,
		setting,
		searchType,
		isHybrid,
		getLatestRequestId: () => latestSearchRequestId,
		getCurrentQueryText: () => queryText,
		onResultApplied: async (query, result) => {
			searchResult = result;
			if (shouldCacheAutoHybridFallbackResult(result)) {
				cachedResult.set(query, result);
			} else {
				cachedResult.delete(query);
			}
			hybridFreshnessNoticeController.syncFromResult(result);
			await updateItemAsync(0);
		},
	});

	const hybridFreshnessNoticeController = new HybridFreshnessNoticeController({
		getSearchType: () => searchType,
		getIsHybrid: () => isHybrid,
		onNoticeChange: (state) => {
			hybridFreshnessNotice = state;
		},
	});
	const hybridQuerySessionController = new HybridQuerySessionController({
		searchService,
		getSearchType: () => searchType,
		getIsHybrid: () => isHybrid,
		getHybridMode: () => hybridMode,
		getCurrentQueryText: () => queryText,
		getCachedResult: (query) => cachedResult.get(query),
		setCachedResult: (query, result) => {
			cachedResult.set(query, result);
		},
		onResultApplied: async (_query, result) => {
			searchResult = result;
			hybridFreshnessNoticeController.syncFromResult(result);
			await updateItemAsync(0);
		},
	});

		$: matchCountText = `${currItemIndex + 1} / ${searchResult.items.length}`;

	function hasHybridEmbeddingIncomplete(result: SearchResult): boolean {
		return result.hasHybridAvailabilityReason("embedding_incomplete");
	}

	function getInVaultResultNoticeText(): string | null {
		if (searchType !== SearchType.IN_VAULT) {
			return null;
		}
		const notice = searchService.getHybridFallbackNotice(searchResult);
		if (notice.message) {
			return notice.message;
		}
		if (notice.key) {
			return t(notice.key);
		}
		return null;
	}

	// TODO: use virtual list rather than rendering all buttons

	// updates focused content and selected file index
	async function updateItemAsync(index: number): Promise<void> {
		// wait until all dynamic elements are mounted and rendered
		await tick();
		const items = searchResult.items;
		if (index >= 0 && index < items.length) {
			currItemIndex = index;
			if (searchType === SearchType.IN_FILE) {
				const item = items[index] as LineItem;
				currContext = item.context;
			} else if (searchType === SearchType.IN_VAULT) {
				currFileItem = items[index] as FileItem;

				// hybrid search returns subItems directly; lexical fetches on demand
				if (!usesDirectFileSubItems(currFileItem)) {
					currFileItem.subItems = await searchService.getFileSubItems(
						queryText,
						currFileItem,
					);
				}
				currFileSubItems = currFileItem.subItems;
				currSubItemIndex =
					currFileSubItems.length > 0 ? 0 : NULL_NUMBER;
				await tick(); // wait until subItems are rendered by svelte
				viewHelper.scrollTo(
					"start",
					currFileSubItems[currSubItemIndex],
					"instant",
				);
			} else {
				throw Error(`unsupported search type: ${searchType}`);
			}
			await tick();
			viewHelper.scrollTo("center", items[index], "smooth");
		} else {
			currContext = "";
			currFileItem = null;
			currFileSubItems = [];
			currItemIndex = NULL_NUMBER;
			currSubItemIndex = NULL_NUMBER;
		}
	}

	// handle input changes
	const handleInputDebounced = debounce(100, () => handleInputAsync());

	async function handleInputAsync() {
		const requestId = ++latestSearchRequestId;
		const currentQueryText = queryText;

		if (cachedResult.has(currentQueryText)) {
			if (
				requestId !== latestSearchRequestId ||
				currentQueryText !== queryText
			) {
				return;
			}
			searchResult = cachedResult.get(currentQueryText) as SearchResult;
			searchService.notifyHybridFallback(searchResult);
			hybridFreshnessNoticeController.syncFromResult(searchResult);
			await updateItemAsync(0);
			if (
				searchType === SearchType.IN_VAULT &&
				!isHybrid &&
				searchResult.items.length === 0 &&
				!hasHybridEmbeddingIncomplete(searchResult)
			) {
				autoHybridFallback.schedule(currentQueryText, requestId);
			} else {
				autoHybridFallback.clear();
			}
			return;
		}

		let nextResult: SearchResult;
		if (searchType === SearchType.IN_FILE) {
			nextResult = await searchService.searchInFile(currentQueryText);
		} else if (searchType === SearchType.IN_VAULT) {
			if (isHybrid) {
				nextResult =
					hybridMode === "lexical-lane"
						? await searchService.searchInVaultHybridLexicalLane(
							currentQueryText,
						)
						: await searchService.searchInVaultHybrid(currentQueryText);
			} else {
				nextResult = await searchService.searchInVault(currentQueryText);
			}
		} else {
			throw Error(TO_BE_IMPL);
		}

		if (
			requestId !== latestSearchRequestId ||
			currentQueryText !== queryText
		) {
			return;
		}

		searchResult = nextResult;
		hybridFreshnessNoticeController.syncFromResult(nextResult);
		cachedResult.set(currentQueryText, searchResult);
		await updateItemAsync(0);

		if (
			searchType === SearchType.IN_VAULT &&
			!isHybrid &&
			nextResult.items.length === 0 &&
			!hasHybridEmbeddingIncomplete(nextResult)
		) {
			autoHybridFallback.schedule(currentQueryText, requestId);
		} else {
			autoHybridFallback.clear();
		}
	}

	function handleInput() {
		if (searchType === SearchType.IN_VAULT && isHybrid) {
			hybridQuerySessionController.handleInput(queryText);
			return;
		}
		hybridQuerySessionController.clear();
		handleInputDebounced();
	}

	// handle result click
	async function handleItemClick(index: number) {
		await updateItemAsync(index);
		if (uiType === "floatingWindow") {
			await handleConfirm(null, false);
		}
	}

	// select the next search result
	async function handleNextItem() {
		if (await historyInputRef?.moveSelectionByHotkey?.("prev")) {
			return;
		}
		await updateItemAsync(
			Math.min(currItemIndex + 1, searchResult.items.length - 1),
		);
		if (uiType === "floatingWindow") {
			await handleConfirm(null, false);
		}
	}

	// Select the previous search result
	async function handlePrevItem() {
		if (await historyInputRef?.moveSelectionByHotkey?.("next")) {
			return;
		}
		await updateItemAsync(Math.max(currItemIndex - 1, 0));
		if (uiType === "floatingWindow") {
			await handleConfirm(null, false);
		}
	}

	function handleSubItemClick(index: number) {
		currSubItemIndex = index;
	}

	function handleNextSubItem() {
		currSubItemIndex = viewHelper.updateSubItemIndex(
			currFileSubItems,
			currSubItemIndex,
			"next",
		);
	}

	function handlePrevSubItem() {
		currSubItemIndex = viewHelper.updateSubItemIndex(
			currFileSubItems,
			currSubItemIndex,
			"prev",
		);
	}

	async function handleConfirm(event: Event | null, inBackground: boolean) {
		event?.preventDefault();
		if (!inBackground && !event && historyInputRef?.acceptSelectedSuggestion?.()) {
			return;
		}
		const selectedItem = searchResult.items[currItemIndex];
		await viewHelper.handleConfirmAsync(
			inBackground ? () => {} : onConfirmExternal,
			searchResult.sourcePath,
			searchType,
			selectedItem,
			currSubItemIndex,
			queryText,
		);
		await searchHistoryService.recordQuery(queryText);
	}

	async function handleConfirmInBackground() {
		await handleConfirm(null, true);
	}

	export function consumeEscape(): boolean {
		return historyInputRef?.consumeEscape?.() ?? false;
	}

	function handleToggleHistorySuggestions() {
		historyInputRef?.toggleSuggestionsByHotkey?.();
	}

	function handleInsertFileLink() {
		viewHelper.insertFileLinkToActiveMarkdown(currFileItem?.path);
	}

	function formatScore(score?: number): string {
		if (score === undefined || Number.isNaN(score)) {
			return "";
		}
		return score.toFixed(3);
	}

	function getFileItemScore(item: FileItem): number | undefined {
		return getMountedModalFileItemScore(item);
	}

	function getStructuredSnippetSegments(subItem: FileSubItem) {
		return viewHelper.getStructuredSnippetSegments(subItem);
	}

	function getSubItemScoreLabel(): string {
		return isDevEnvironment ? "coverage score" : "score";
	}

	function getFileExtensionText(item: FileItem): string {
		return item.extension === "md" ? "" : item.extension;
	}

	function escapeHtml(text: string): string {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function getFileNameHtml(item: FileItem): string {
		return viewHelper.purifyHTML(
			viewHelper.renderHighlightedText(
				item.basename,
				item.basenameHighlightRanges ?? [],
				item.basenameWeakHighlightRanges ?? [],
			) +
				HTML_4_SPACES +
				escapeHtml(getFileExtensionText(item)),
		);
	}

	function getFolderPathHtml(item: FileItem): string {
		return viewHelper.purifyHTML(
			viewHelper.renderHighlightedText(
				item.folderPath,
				item.folderHighlightRanges ?? [],
				item.folderWeakHighlightRanges ?? [],
			),
		);
	}

	// ===================================================
	onDestroy(() => {
		autoHybridFallback.clear();
		hybridQuerySessionController.clear();
		hybridFreshnessNoticeController.clear();
		logger.trace("mounted element has been destroyed.");
	});

	// NOTE: onMount() won't be triggered and I wonder why
	function listenEvent(event: EventEnum, callback: EventCallback) {
		eventBus.on(event, callback);
		onDestroy(() => {
			eventBus.off(event, callback);
		});
	}
	if (uiType === "floatingWindow") {
		listenEvent(EventEnum.NEXT_ITEM_FLOATING_WINDOW, handleNextItem);
		listenEvent(EventEnum.PREV_ITEM_FLOATING_WINDOW, handlePrevItem);
	} else {
		listenEvent(EventEnum.NEXT_ITEM, handleNextItem);
		listenEvent(EventEnum.PREV_ITEM, handlePrevItem);
		listenEvent(EventEnum.NEXT_SUB_ITEM, handleNextSubItem);
		listenEvent(EventEnum.PREV_SUB_ITEM, handlePrevSubItem);
		listenEvent(EventEnum.CONFIRM_ITEM, handleConfirm);
		listenEvent(
			EventEnum.TOGGLE_HISTORY_SUGGESTIONS,
			handleToggleHistorySuggestions,
		);
		listenEvent(
			EventEnum.CONFIRM_ITEM_IN_BACKGROUND,
			handleConfirmInBackground,
		);
		listenEvent(EventEnum.INSERT_FILE_LINK, handleInsertFileLink);
	}
	viewHelper.focusInput();
	handleInputAsync();
</script>

<div class="search-container">
	<div class="left-pane">
		<SearchHistoryInput
			bind:this={historyInputRef}
			bind:queryText
			{matchCountText}
			on:querychange={handleInput}
		/>
		<div class="result-items">
			<!-- ul used to keep button positioning stable when the outer container scrolls -->
			<ul>
				{#each searchResult.items as item, index}
					<button
						class:file-item-button={item instanceof FileItem}
						class:selected={index === currItemIndex}
						bind:this={item.element}
						on:click={() => {
							handleItemClick(index);
							if (uiType === "floatingWindow") {
								handleConfirm(null, false);
							}
						}}
						on:contextmenu={async (e) => {
							await handleItemClick(index);
							await handleConfirm(e, e.ctrlKey);
						}}
						on:dblclick={async (e) => {
							await handleItemClick(index);
							await handleConfirm(e, e.ctrlKey);
						}}
					>
						{#if item instanceof LineItem}
							<span class="line-item"
								>{@html viewHelper.purifyHTML(item.line.text)}</span
							>
						{:else if item instanceof FileItem}
							{#if getFileItemScore(item) !== undefined}
								<span class="file-item-score"
									>{formatScore(getFileItemScore(item))}</span
								>
							{/if}
							<span class="file-item">
								<span class="filename"
									>{@html getFileNameHtml(item)}</span
								>
								<span class="file-folder-path"
									>{@html getFolderPathHtml(item)}</span
								>
							</span>
						{/if}
					</button>
				{/each}
			</ul>
		</div>
	</div>
	{#if uiType !== "floatingWindow"}
		<div class="right-pane">
			<div class="preview-container">
				{#if searchType === SearchType.IN_FILE}
					{#if currContext}
						<p
							on:contextmenu={(e) => handleConfirm(e, e.ctrlKey)}
							on:dblclick={(e) => handleConfirm(e, e.ctrlKey)}
						>
							{@html viewHelper.purifyHTML(currContext)}
						</p>
					{/if}
				{:else if searchType === SearchType.IN_VAULT}
					{#if hybridFreshnessNotice.visible}
						<div class="hybrid-freshness-banner">
							<p class="hybrid-freshness-banner-message">
								{hybridFreshnessNotice.message}
							</p>
						</div>
					{/if}
					{#if getInVaultResultNoticeText()}
						<div class="hybrid-fallback-failure">
							<span class="hybrid-fallback-failure-detail">
								{getInVaultResultNoticeText()}
							</span>
						</div>
					{/if}
					{#if hasHybridEmbeddingIncomplete(searchResult)}
							<div class="hybrid-fallback-failure">
								<span class="hybrid-fallback-failure-detail">
									{t("hybridModal.embeddingIncompleteFallback.title")}
								</span>
								<span class="hybrid-fallback-failure-detail hybrid-fallback-failure-detail-secondary">
									{t("hybridModal.embeddingIncompleteFallback.desc")}
								</span>
							</div>
					{/if}
					{#if currFileItem && currFileItem.viewType === ViewType.MARKDOWN}
						<ul>
							{#each currFileSubItems as subItem, index}
								{@const structuredSegments = getStructuredSnippetSegments(subItem)}
								<button
									on:click={() => handleSubItemClick(index)}
									on:contextmenu={(e) => {
										currSubItemIndex = index;
										handleConfirm(e, e.ctrlKey);
									}}
									on:dblclick={(e) => {
										currSubItemIndex = index;
										handleConfirm(e, e.ctrlKey);
									}}
									bind:this={subItem.element}
									class:selected={index === currSubItemIndex}
									class="file-sub-item"
								>
									{#if subItem.score !== undefined}
										<span class="subitem-score"
											>{getSubItemScoreLabel()} {formatScore(subItem.score)}</span
										>
									{/if}
									<span class="subitem-snippet">
										{#if structuredSegments}
											{#each structuredSegments as segment}
												{#if segment.style === "strong"}
													<strong class="cs-search-match">{segment.text}</strong>
												{:else if segment.style === "weak"}
													<span class="cs-search-match-weak">{segment.text}</span>
												{:else}
													{segment.text}
												{/if}
											{/each}
										{:else}
											{@html viewHelper.purifyHTML(
												subItem.snippet ?? subItem.text,
											)}
										{/if}
									</span>
								</button>
							{/each}
						</ul>
					{:else}
						<span>
							{viewHelper.showNoResult()}
						</span>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	div,
	button {
		user-select: text;
	}

	.search-container {
		display: flex;
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}

	:global(.search-container .cs-search-match) {
		font-weight: 700;
		color: var(
			--cs-highlight-char-color,
			var(--text-accent, var(--text-normal))
		);
	}

	:global(.search-container .cs-search-match-weak) {
		font-weight: 600;
		color: var(
			--cs-highlight-char-color,
			var(--text-accent, var(--text-normal))
		);
		text-decoration-line: underline;
		text-decoration-style: dashed;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.12em;
	}

	:global(.search-container mark) {
		background: transparent;
		color: var(
			--cs-highlight-char-color,
			var(--text-accent, var(--text-normal))
		);
		font-weight: 700;
		padding: 0;
	}

	.left-pane {
		display: flex;
		flex-direction: column;
		align-items: left;
		width: 27.5vw;
	}

	.result-items {
		display: flex;
		flex-direction: column;
		height: 70vh;
		margin-top: 0.15em;
		overflow-y: auto;
	}

	.result-items ul {
		padding: 0 0.5em 0 0;
		margin-bottom: 0;
		width: 97%;
		overflow-x: hidden;
	}

	.result-items ul button {
		align-items: center;
		justify-content: left;
		padding: 0.65em;
		margin: 0.5em 0 0 0.15em;
		width: 25.35vw;
		height: fit-content;
		text-align: left;
		background-color: var(--cs-pane-bgc, #20202066);
		border-radius: 4px;
		cursor: pointer;
	}

	.result-items ul button.file-item-button {
		position: relative;
	}

	.result-items ul button:hover,
	.result-items ul button.selected {
		background-color: var(--cs-item-selected-color, rgba(85, 85, 85, 0.35));
	}

	.result-items ul button .line-item,
	.result-items ul button .file-item {
		text-wrap: wrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-items ul button .line-item {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
	}

	.result-items ul button .file-item {
		display: block;
		padding-right: 4.6em;
	}

	.result-items ul button .file-item span.filename {
		margin-top: -0.2em;
		display: block;
	}

	.result-items ul button span.file-item-score {
		position: absolute;
		top: 0.62em;
		right: 0.85em;
		font-family: var(--font-monospace);
		font-size: 0.8em;
		line-height: 1.2;
		color: var(--cs-secondary-font-color, #a29c9c);
	}

	.result-items ul button .file-item span.file-folder-path {
		color: var(--cs-secondary-font-color, #a29c9c);
		display: block;
	}

	.file-sub-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3em;
	}

	.file-sub-item .subitem-score {
		font-family: var(--font-monospace);
		font-size: 0.82em;
		color: var(--cs-secondary-font-color, #a29c9c);
	}

	.file-sub-item .subitem-snippet {
		display: block;
		width: 100%;
	}

	.hybrid-fallback-failure {
		padding-right: 0.7em;
		color: var(--text-normal);
		margin-bottom: 0.75em;
	}

	.hybrid-freshness-banner {
		padding: 0.8em 0.9em;
		margin: 0 0.7em 0.85em 0;
		border-radius: 8px;
		background:
			linear-gradient(135deg, rgba(186, 145, 62, 0.2), rgba(71, 110, 130, 0.16));
		border: 1px solid rgba(186, 145, 62, 0.28);
	}

	.hybrid-freshness-banner-message {
		margin: 0;
		color: var(--cs-secondary-font-color, #a29c9c);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.hybrid-fallback-failure-detail {
		color: var(--cs-secondary-font-color, #a29c9c);
		margin-bottom: 0;
	}

	.hybrid-fallback-failure-detail {
		display: block;
	}

	.hybrid-fallback-failure-detail-secondary {
		margin-top: -0.73em;
	}

	.right-pane {
		background-color: var(--cs-pane-bgc, #20202066);
		border-radius: 6px;
		height: 73.97vh;
		width: 60%;
	}

	.right-pane button {
		white-space: pre-wrap;
	}

	.right-pane .preview-container {
		margin: 0.7em 0 0 0.7em;
		height: 72.5vh;
		overflow-y: auto;
	}

	.right-pane .preview-container p,
	.right-pane .preview-container ul {
		margin: 0;
		padding: 0;
		overflow-x: hidden;
	}

	.right-pane .preview-container p {
		width: 39.7vw;
	}

	.right-pane .preview-container ul button.file-sub-item {
		text-wrap: wrap;
		display: block;
		text-overflow: ellipsis;
		justify-content: left;
		margin-bottom: 1em;
		height: fit-content;
		width: 39.2vw;
		text-align: left;
		background-color: var(--cs-pane-bgc, #20202066);
		border-radius: 4px;
		font-size: medium;
	}

	.right-pane .preview-container ul button.file-sub-item.selected {
		background-color: var(--cs-item-selected-color, rgba(85, 85, 85, 0.35));
	}

</style>
