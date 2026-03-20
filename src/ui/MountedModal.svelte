<script lang="ts">
	import { HTML_4_SPACES, NULL_NUMBER } from "src/globals/constants";
	import { EventEnum } from "src/globals/enums";
	import {
		FileItem,
		FileSubItem,
		LineItem,
		SearchResult,
		SearchType,
	} from "src/globals/search-types";
	import { SearchService } from "src/services/obsidian/search-service";
	import { SearchHistoryService } from "src/services/obsidian/user-data/search-history-service";
	import { ViewType } from "src/services/obsidian/view-registry";
	import { eventBus, type EventCallback } from "src/utils/event-bus";
	import { logger } from "src/utils/logger";
	import { TO_BE_IMPL, getInstance } from "src/utils/my-lib";
	import { onDestroy, tick } from "svelte";
	import { debounce } from "throttle-debounce";
	import SearchHistoryInput from "./SearchHistoryInput.svelte";
	import { ViewHelper } from "./view-helper";

	const searchService: SearchService = getInstance(SearchService);
	const searchHistoryService = getInstance(SearchHistoryService);
	const viewHelper = getInstance(ViewHelper);

	export let uiType: "modal" | "floatingWindow";
	export let onConfirmExternal: () => void;
	export let searchType: SearchType;
	export let isHybrid: boolean = false; // hybrid BM25+vector search
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

	$: matchCountText = `${currItemIndex + 1} / ${searchResult.items.length}`;

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
				if (!isHybrid) {
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
	const handleHybridInputDebounced = debounce(400, () => handleInputAsync());

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
			await updateItemAsync(0);
			return;
		}

		let nextResult: SearchResult;
		if (searchType === SearchType.IN_FILE) {
			nextResult = await searchService.searchInFile(currentQueryText);
		} else if (searchType === SearchType.IN_VAULT) {
			if (isHybrid) {
				nextResult = await searchService.searchInVaultHybrid(
					currentQueryText,
				);
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
		cachedResult.set(currentQueryText, searchResult);
		await updateItemAsync(0);
	}

	function handleInput() {
		if (searchType === SearchType.IN_VAULT && isHybrid) {
			handleHybridInputDebounced();
			return;
		}
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
		await updateItemAsync(
			Math.min(currItemIndex + 1, searchResult.items.length - 1),
		);
		if (uiType === "floatingWindow") {
			await handleConfirm(null, false);
		}
	}

	// Select the previous search result
	async function handlePrevItem() {
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

	function handleInsertFileLink() {
		viewHelper.insertFileLinkToActiveMarkdown(currFileItem?.path);
	}

	function formatScore(score?: number): string {
		if (score === undefined || Number.isNaN(score)) {
			return "";
		}
		return score.toFixed(3);
	}

	// ===================================================
	onDestroy(() => {
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
			bind:queryText
			{matchCountText}
			on:querychange={handleInput}
		/>
		<div class="result-items">
			<!-- ul used to keep button positioning stable when the outer container scrolls -->
			<ul>
				{#each searchResult.items as item, index}
					<button
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
							<span class="file-item">
								<span class="filename"
									>{@html item.basename +
										HTML_4_SPACES +
										(item.extension === "md"
											? ""
											: item.extension)}</span
								>
								<span class="file-folder-path"
									>{item.folderPath}</span
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
					{#if currFileItem && currFileItem.viewType === ViewType.MARKDOWN}
						<ul>
							{#each currFileSubItems as subItem, index}
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
											>score {formatScore(subItem.score)}</span
										>
									{/if}
									<span class="subitem-snippet">
										{@html viewHelper.purifyHTML(
											subItem.snippet ?? subItem.text,
										)}
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
		margin-top: 2.4em;
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}

	:global(.search-container mark) {
		background-color: var(--cs-highlight-bgc, rgba(219, 204, 149, 0.9));
		color: var(--cs-highlight-char-color, #111);
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
		height: calc(70vh - 2.4em);
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

	.result-items ul button:hover,
	.result-items ul button.selected {
		background-color: var(--cs-item-selected-color, rgba(85, 85, 85, 0.35));
	}

	.result-items ul button .line-item,
	.result-items ul button .file-item {
		text-wrap: wrap;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-items ul button .file-item {
		-webkit-line-clamp: 6;
	}

	.result-items ul button .file-item span.filename {
		margin-top: -0.2em;
		display: block;
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

	.right-pane {
		background-color: var(--cs-pane-bgc, #20202066);
		border-radius: 6px;
		height: calc(73.97vh - 2.4em);
		width: 60%;
	}

	.right-pane button {
		white-space: pre-wrap;
	}

	.right-pane .preview-container {
		margin: 0.7em 0 0 0.7em;
		height: calc(72.5vh - 2.4em);
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

	.right-pane .preview-container :global(span.matched-line) {
		display: inline-block;
		width: 100%;
	}

	.right-pane .preview-container :global(span.matched-line.highlight-bg) {
		background-color: var(--cs-hint-char-color, #468eeb33);
	}
</style>
