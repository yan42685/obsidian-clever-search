<script lang="ts">
	import { MarkdownView, type App, type EditorPosition } from "obsidian";
	import { EventEnum } from "src/globals/event-enum";
	import {
		InFileItem,
		InVaultItem,
		SearchResult,
		SearchType,
	} from "src/globals/search-types";
	import { PrivateApi } from "src/services/obsidian/private-api";
	import { SearchHelper } from "src/services/search/search-helper";
	import { eventBus, type EventCallback } from "src/utils/event-bus";
	import { getInstance } from "src/utils/my-lib";
	import { onDestroy, tick } from "svelte";
	import { container } from "tsyringe";
	import type { SearchModal } from "./search-modal";

	const searchHelper: SearchHelper = container.resolve(SearchHelper);

	export let app: App;
	export let modal: SearchModal;
	export let searchType: SearchType;
	export let queryText: string;
	const DEFAULT_RESULT = new SearchResult(SearchType.NONE, "", []);
	let searchResult: SearchResult = DEFAULT_RESULT;
	let currItemIndex = -1;
	let currContext = ""; // for previewing in-file search
	let currSubItemIndex = -1;
	let currSubItems: string[] = []; // for previewing in-vault search
	let inputEl: HTMLElement;

	$: matchCountText = `${currItemIndex + 1} / ${searchResult.items.length}`;

	// Updates focused content and selected file index
	function updateItem(index: number): void {
		const items = searchResult.items;
		if (index >= 0 && index < items.length) {
			if (searchType === SearchType.IN_FILE) {
				const item = items[index] as InFileItem;
				currContext = item.context;
				currItemIndex = index;
			} else {
				throw Error("unsupported result type: " + typeof searchResult);
			}
		} else {
			currContext = "";
			currItemIndex = -1;
		}
	}

	// Handle input changes
	async function handleInput() {
		if (searchType === SearchType.IN_FILE) {
			searchResult = await searchHelper.searchInFile(queryText);
			updateItem(0);
			// wait until all dynamic elements are mounted and rendered
			await tick();
			searchResult.items.forEach((x) => {
				const item = x as InFileItem;
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
			searchResult = await searchHelper.searchInVault(queryText);

		}
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

	function handleConfirm() {
		modal.close();
		// 对应的command name是Focus on last note
		getInstance(PrivateApi).executeCommandById("editor:focus");

		if (searchType === SearchType.IN_FILE) {
			const selectedItem = searchResult.items[
				currItemIndex
			] as InFileItem;
			if (selectedItem) {
				// move the cursor and view to a specific line and column in the editor.
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					const cursorPos: EditorPosition = {
						line: selectedItem.line.row,
						ch: selectedItem.line.col,
					};
					view.editor.setCursor(cursorPos);
					view.editor.scrollIntoView(
						{
							from: cursorPos,
							to: cursorPos,
						},
						true,
					);
				}
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
	listenEvent(EventEnum.CONFIRM_ITEM, handleConfirm);
	handleInput();
</script>

<div class="search-container">
	<div class="left-pane">
		<div class="search-bar" data-match-count={matchCountText}>
			<!-- svelte-ignore a11y-autofocus -->
			<input
				bind:value={queryText}
				bind:this={inputEl}
				on:input={handleInput}
				on:blur={() => setTimeout(() => inputEl.focus(), 1)}
				autofocus
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
						{#if item instanceof InFileItem}
							<span class="line-item">{@html item.line.text}</span
							>
						{:else if item instanceof InVaultItem}
							<span class="file-basename">{item.basename}</span>
							<span class="file-extension">{item.extension}</span>
							<span class="file-folder-path"
								>{item.folderPath}</span
							>
						{/if}
					</button>
				{/each}
			</ul>
		</div>
	</div>
	<div class="right-pane">
		{#if currContext}
			<div class="preview-container">
				{#if searchType === SearchType.IN_FILE}
					<p>{@html currContext}</p>
				{:else if searchType === SearchType.IN_VAULT}
					<ul>
						{#each currSubItems as subItem, index}
							<button>
								{@html subItem}
							</button>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
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

	.right-pane .preview-container p {
		margin: 0;
	}

	.right-pane .preview-container :global(span.target-line) {
		display: inline-block;
		width: 100%;
		background-color: var(--cs-hint-char-color, #468eeb33);
	}
</style>
