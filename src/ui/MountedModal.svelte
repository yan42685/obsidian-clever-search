<script lang="ts">
	import { NULL_NUMBER } from "src/globals/constants";
	import { EventEnum } from "src/globals/enums";
	import {
		FileItem,
		FileSubItem,
		LineItem,
		SearchResult,
		SearchType,
	} from "src/globals/search-types";
	import { SearchService } from "src/services/obsidian/search-service";
	import { eventBus, type EventCallback } from "src/utils/event-bus";
	import { FileType } from "src/utils/file-util";
	import { logger } from "src/utils/logger";
	import { getInstance } from "src/utils/my-lib";
	import { onDestroy, tick } from "svelte";
	import type { SearchModal } from "./search-modal";
	import { ViewHelper } from "./view-helper";

	const searchService: SearchService = getInstance(SearchService);
	const viewHelper = getInstance(ViewHelper);

	export let modal: SearchModal;
	export let searchType: SearchType;
	export let queryText: string;
	const DEFAULT_RESULT = new SearchResult("", []);
	let searchResult: SearchResult = DEFAULT_RESULT;
	let currItemIndex = NULL_NUMBER;
	let currContext = ""; // for previewing in-file search

	let currFileItem: FileItem | null = null; // for previewing in-vault search
	let currFileSubItems: FileSubItem[] = []; // for plaintext filetype
	let currFilePreviewContent: any = undefined; // for non-plaintext filetype
	let currSubItemIndex = NULL_NUMBER;
	let inputEl: HTMLElement;

	$: matchCountText = `${currItemIndex + 1} / ${searchResult.items.length}`;

	// Updates focused content and selected file index
	function updateItem(index: number): void {
		const items = searchResult.items;
		if (index >= 0 && index < items.length) {
			currItemIndex = index;
			if (searchType === SearchType.IN_FILE) {
				const item = items[index] as LineItem;
				currContext = item.context;
			} else if (searchType === SearchType.IN_VAULT) {
				currFileItem = items[index] as FileItem;
				currFileSubItems = currFileItem.subItems;
				currSubItemIndex = index;
			} else {
				throw Error(`unsupported search type: ${searchType}`);
			}
		} else {
			currContext = "";
			currFileItem = null;
			currFileSubItems = [];
			currItemIndex = NULL_NUMBER;
		}
	}

	// Handle input changes
	async function handleInput() {
		if (searchType === SearchType.IN_FILE) {
			// searchResult = await searchService.deprecatedSearchInFile(queryText);
			searchResult = await searchService.searchInFile(queryText);
			searchResult.items.forEach((x) => {
				const item = x as LineItem;
				// console.log(item.line.text);
				// if (item.element) {
				// 	MarkdownRenderer.render(
				// 		app,
				// 		item.line.text,
				// 		item.element,
				// 		searchResult.currPath,
				// 		new Component(),
				// 	);
				// }
			});
		} else if (searchType === SearchType.IN_VAULT) {
			searchResult = await searchService.searchInVault(queryText);
		}
		updateItem(0);
		// wait until all dynamic elements are mounted and rendered
		await tick();
	}

	// Handle result click
	function handleItemClick(index: number): void {
		updateItem(index);
	}

	// Select the next search result
	function handleNextItem() {
		updateItem(Math.min(currItemIndex + 1, searchResult.items.length - 1));
	}

	// Select the previous search result
	function handlePrevItem() {
		updateItem(Math.max(currItemIndex - 1, 0));
	}

	function handleNextSubItem() {

		currSubItemIndex = viewHelper.updateSubItemIndex(
			currSubItemIndex,
			currFileSubItems.length - 1,
			"next",
		);
		logger.info(`currSubItemIndex; ${currSubItemIndex}`)
	}

	function handlePrevSubItem() {

		currSubItemIndex = viewHelper.updateSubItemIndex(
			currSubItemIndex,
			currFileSubItems.length - 1,
			"prev",
		);
	}

	function handleConfirm() {
		modal.close();
		if (searchType === SearchType.IN_FILE) {
			const selectedItem = searchResult.items[currItemIndex] as LineItem;
			if (selectedItem) {
				viewHelper.jumpInFile(
					selectedItem.line.row,
					selectedItem.line.col,
				);
			}
		} else {
			throw Error("unsupported search type");
		}
	}

	// ===================================================
	// NOTE: onMount() 方法不会被触发
	function listenEvent(event: EventEnum, callback: EventCallback) {
		eventBus.on(event, callback);
		onDestroy(() => eventBus.off(event, callback));
	}

	listenEvent(EventEnum.NEXT_ITEM, handleNextItem);
	listenEvent(EventEnum.PREV_ITEM, handlePrevItem);
	listenEvent(EventEnum.NEXT_SUB_ITEM, handleNextSubItem);
	listenEvent(EventEnum.PREV_SUB_ITEM, handlePrevSubItem);
	listenEvent(EventEnum.CONFIRM_ITEM, handleConfirm);
	handleInput();
</script>

<div class="search-container">
	<div class="left-pane">
		<div class="search-bar" data-match-count={matchCountText}>
			<input
				bind:value={queryText}
				bind:this={inputEl}
				on:input={handleInput}
				on:blur={() => setTimeout(() => inputEl.focus(), 1)}
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
							event.preventDefault();
							handleItemClick(index);
						}}
					>
						{#if item instanceof LineItem}
							<span class="line-item">{@html item.line.text}</span
							>
						{:else if item instanceof FileItem}
							<div class="file-item">
								<span class="file-basename"
									>{item.basename}</span
								>
								<span class="file-extension"
									>{item.extension}</span
								>
								<span class="file-folder-path"
									>{item.folderPath}</span
								>
							</div>
						{/if}
					</button>
				{/each}
			</ul>
		</div>
	</div>
	<div class="right-pane">
		<div class="preview-container">
			{#if searchType === SearchType.IN_FILE}
				{#if currContext}
					<p>{@html currContext}</p>
				{/if}
			{:else if searchType === SearchType.IN_VAULT}
				{#if currFileItem && currFileItem.fileType === FileType.PLAIN_TEXT}
					<ul>
						{#each currFileSubItems as subItem, index}
							<button
								class:selected={index === currSubItemIndex}
								class="file-sub-item"
							>
								{@html subItem.text}
							</button>
						{/each}
					</ul>
				{:else}
					<span> no result or to be impl</span>
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.search-container {
		display: flex;
		margin-top: 10px;
		/* 保证空格和换行符在渲染html时不被压缩掉 */
		white-space: pre-wrap;
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
		align-items: center;
		width: 40%;
	}
	.search-bar {
		position: sticky; /* 固定位置 */
		top: 0;
		left: 0;
		padding-bottom: 15px;
		width: 90%;
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
			0 2px 4px rgba(0, 0, 0, 0.18),
			0 2px 3px rgba(0, 0, 0, 0.26);
	}

	.result-items {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		height: 67.3vh;
		margin-top: 1em;
	}

	.result-items ul {
		list-style: none; /* 移除默认的列表样式 */
		padding: 0 0.5em 0 0;
		margin: 0.2em 0 0 0;
		width: 90%;
		/* height: 36vw; */
		overflow-y: auto;
		overflow-x: hidden;
		justify-content: left;
	}

	.result-items ul button {
		display: flex;
		align-items: center;
		justify-content: left;
		padding: 0.65em;
		margin-bottom: 0.5em;
		/* width: 100%; */
		width: 23vw;
		height: fit-content;
		/* max-height: 5.5em; */
		text-align: left;
		background-color: var(--cs-pane-bgc, #20202066);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: background-color 0.01s;
	}

	.result-items ul button:hover,
	.result-items ul button.selected {
		background-color: var(--cs-item-selected-color, #555);
	}

	/* wrap the matched line up to 3 lines and show ... if it still overflows */
	.result-items ul button span.line-item {
		text-wrap: wrap;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-items ul button span.file-basename {
	}

	.result-items ul button span.file-extension {
	}
	.result-items ul button span.file-folder-path {
		display: block;
	}
	.right-pane {
		background-color: var(--cs-pane-bgc, #20202066);
		border-radius: 6px;
		height: 72.8vh;
		width: 60%;
	}
	.right-pane .preview-container {
		margin: 0.7em 0.5em 0.7em 0.7em;
		height: 70vh;
		overflow-wrap: break-word;
		overflow-y: auto;
	}
	.right-pane .preview-container p,
	.right-pane .preview-container ul {
		margin: 0;
		padding: 0;
	}
	/* TODO: highlight current subitem */
	.right-pane .preview-container ul button.file-sub-item {
		text-wrap: wrap;
		display: block;
		text-overflow: ellipsis;
		justify-content: left;
		margin-bottom: 1em;
		height: fit-content;
		text-align: left;
		background-color: var(--cs-pane-bgc, #20202066);
		border-radius: 4px;
		font-size: medium;
	}

	.right-pane .preview-container ul button.file-sub-item.selected {
		background-color: var(
			--cs-item-selected-color,
			#555
		); /* 选中时的背景色 */
		color: white; /* 选中时的文字颜色 */
		border-radius: 4px; /* 圆角 */
	}

	.right-pane .preview-container :global(span.matched-line) {
		display: inline-block;
		width: 100%;
		background-color: var(--cs-hint-char-color, #468eeb33);
	}
</style>
