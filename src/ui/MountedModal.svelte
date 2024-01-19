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
	import { ViewType } from "src/services/obsidian/view-registry";
	import { eventBus, type EventCallback } from "src/utils/event-bus";
	import { logger } from "src/utils/logger";
	import {
		TO_BE_IMPL,
		getInstance,
		isDevEnvironment,
	} from "src/utils/my-lib";
	import { onDestroy, tick } from "svelte";
	import { debounce } from "throttle-debounce";
	import { ViewHelper } from "./view-helper";

	const searchService: SearchService = getInstance(SearchService);
	const viewHelper = getInstance(ViewHelper);

	export let uiType: "modal" | "floatingWindow";
	export let onConfirmExternal: () => void;
	export let searchType: SearchType;
	export let queryText: string;
	const cachedResult = new Map<string, SearchResult>(); // remove the unnecessary latency when backspacing
	let searchResult: SearchResult = new SearchResult("", []);
	let currItemIndex = NULL_NUMBER;
	let currContext = ""; // for previewing in-file search

	let currFileItem: FileItem | null = null; // for previewing in-vault search
	let currFileSubItems: FileSubItem[] = []; // for markdown viewType
	let currFilePreviewContent: any = undefined; // for non-markdown viewType
	let currSubItemIndex = NULL_NUMBER;

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
				// this result also can be cached if necessary in the future
				currFileItem.subItems = await searchService.getFileSubItems(
					queryText,
					currFileItem,
				);
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
		if (cachedResult.has(queryText)) {
			searchResult = cachedResult.get(queryText) as SearchResult;
			await updateItemAsync(0);
			return;
		}
		if (searchType === SearchType.IN_FILE) {
			// searchResult = await searchService.deprecatedSearchInFile(queryText);
			searchResult = await searchService.searchInFile(queryText);
			// searchResult.items.forEach((x) => {
			// 	const item = x as LineItem;
			// 	console.log(item.line.text);
			// 	if (item.element) {
			// 		MarkdownRenderer.render(
			// 			app,
			// 			item.line.text,
			// 			item.element,
			// 			searchResult.currPath,
			// 			new Component(),
			// 		);
			// 	}
			// });
		} else if (searchType === SearchType.IN_VAULT) {
			searchResult = await searchService.searchInVault(queryText);
		} else {
			throw Error(TO_BE_IMPL);
		}
		cachedResult.set(queryText, searchResult);
		await updateItemAsync(0);
	}

	// handle result click
	async function handleItemClick(index: number) {
		await updateItemAsync(index);
	}

	// select the next search result
	async function handleNextItem() {
		await updateItemAsync(
			Math.min(currItemIndex + 1, searchResult.items.length - 1),
		);
		if (uiType === "floatingWindow") {
			handleConfirm(null);
		}
	}

	// Select the previous search result
	async function handlePrevItem() {
		await updateItemAsync(Math.max(currItemIndex - 1, 0));
		if (uiType === "floatingWindow") {
			handleConfirm(null);
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

	async function handleConfirm(event: Event | null) {
		event?.preventDefault();
		const selectedItem = searchResult.items[currItemIndex];
		await viewHelper.handleConfirmAsync(
			onConfirmExternal,
			searchResult.sourcePath,
			searchType,
			selectedItem,
			currSubItemIndex,
		);
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
	}
	viewHelper.focusInput();
	handleInputAsync();
</script>

<div class="search-container">
	<div class="left-pane">
		<div class="search-bar" data-match-count={matchCountText}>
			<input
				id="cs-search-input"
				bind:value={queryText}
				on:input={handleInputDebounced}
			/>
		</div>
		<div class="result-items">
			<!-- ul 用来保证button位置不受外层div是否出现滚轮而影响 -->
			<ul>
				{#each searchResult.items as item, index}
					<button
						class:selected={index === currItemIndex}
						bind:this={item.element}
						on:click={(event) => {
							handleItemClick(index);
							if (uiType === "floatingWindow") {
								handleConfirm(null);
							}
						}}
						on:contextmenu={async (e) => {
							await handleItemClick(index);
							await handleConfirm(e);
						}}
					>
						{#if item instanceof LineItem}
							<span class="line-item">{@html item.line.text}</span
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
						<p on:contextmenu={(e) => handleConfirm(e)}>
							{@html currContext}
						</p>
					{/if}
				{:else if searchType === SearchType.IN_VAULT}
					{#if currFileItem && currFileItem.viewType === ViewType.MARKDOWN}
						<ul>
							{#each currFileSubItems as subItem, index}
								<button
									on:click={(event) =>
										handleSubItemClick(index)}
									on:contextmenu={(e) => {
										currSubItemIndex = index;
										handleConfirm(e);
									}}
									bind:this={subItem.element}
									class:selected={index === currSubItemIndex}
									class="file-sub-item"
								>
									{@html subItem.text}
								</button>
							{/each}
						</ul>
					{:else}
						<span>
							{isDevEnvironment
								? "no result or to be impl"
								: "no matched content"}
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
		white-space: pre-wrap; /* 保证空格和换行符在渲染html时不被压缩掉 */
		overflow-wrap: break-word; /* long text won't be hidden if overflow: hidden is set */
	}

	/* 所有在 .search-container 类内部的 mark 元素都会被选中并应用样式，而不影响其他地方的 mark 元素。
	 * 想要插件内部全局生效，就写在源码最外面的style.css里 */
	:global(.search-container mark) {
		background-color: var(--cs-highlight-bgc, rgba(219, 204, 149, 0.9));
		color: var(--cs-highlight-char-color, #111);
	}

	.left-pane {
		display: flex;
		flex-direction: column;
		align-items: left;
		/* width: 40%; */
		width: 27.5vw;
	}
	.search-bar {
		position: sticky; /* 固定位置 */
		top: -0.2em;
		left: 0;
		width: 97%;
		height: 30px;
	}
	/* 似乎不能在input上面放伪元素 */
	.search-bar::after {
		content: attr(data-match-count);
		position: absolute;
		right: 0.6em;
		top: 1.4em;
		font-size: 0.8em;
		transform: translateY(-50%);
		color: var(--cs-hint-char-color, grey);
	}
	.search-bar input {
		width: 100%;
		padding: 8px 12px;
		border: none;
		border-radius: 10px;
		background-color: var(--cs-search-bar-bgc, #20202066);
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.07),
			0 2px 3px rgba(0, 0, 0, 0.1);
	}

	.result-items {
		display: flex;
		flex-direction: column;
		height: 70vh;
		margin-top: 0.15em;
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
		/* width: 100%; */
		width: 25.35vw;
		height: fit-content;
		/* max-height: 5.5em; */
		text-align: left;
		background-color: var(--cs-pane-bgc, #20202066);
		border-radius: 4px;
		cursor: pointer;
	}

	.result-items ul button:hover,
	.result-items ul button.selected {
		background-color: var(--cs-item-selected-color, rgba(85, 85, 85, 0.35));
	}

	/* wrap the matched line up to 3 lines and show ... if it still overflows */
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
		-webkit-line-clamp: 6; /* overwrite the previous rule */
	}

	.result-items ul button .file-item span.filename {
		margin-top: -0.2em;
		display: block;
	}

	.result-items ul button .file-item span.file-folder-path {
		color: var(--cs-secondary-font-color, #a29c9c);
		display: block;
	}
	.right-pane {
		background-color: var(--cs-pane-bgc, #20202066);
		border-radius: 6px;
		height: 73.97vh;
		width: 60%;
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

	.right-pane .preview-container :global(span.matched-line) {
		display: inline-block;
		width: 100%;
	}

	.right-pane .preview-container :global(span.matched-line.highlight-bg) {
		background-color: var(--cs-hint-char-color, #468eeb33);
	}
</style>
