<script lang="ts">
	import { MarkdownView, type App } from "obsidian";
	import {
		InFileItem,
		SearchResult,
		SearchType,
	} from "src/entities/search-types";
	import { SearchHelper } from "src/search-helper";
	import { eventBus, type EventCallback } from "src/utils/event-bus";
	import { EventEnum } from "src/utils/event-enum";
	import { onDestroy, tick } from "svelte";
	import { container } from "tsyringe";
	import type { SearchModal } from "./search-modal";

	// const searchService: SearchService = container.resolve(SearchService);
	// 这是一个异步方法
	// searchService.testProcedure();

	const searchHelper: SearchHelper = container.resolve(SearchHelper);

	export let app: App;
	export let modal: SearchModal;
	export let queryText: string;
	const DEFAULT_RESULT = new SearchResult(SearchType.NONE, "", []);
	let searchResult: SearchResult = DEFAULT_RESULT;
	let currItemIndex = 0;
	let currContext = "";

	// Updates focused content and selected file index
	function updateItem(index: number): void {
		const items = searchResult.items;
		if (index >= 0 && index < items.length) {
			if (searchResult.type === SearchType.IN_FILE) {
				const item = items[index] as InFileItem;
				currContext = item.context;
				currItemIndex = index;
			} else {
				throw Error("unsupported result type: " + typeof searchResult);
			}
		} else {
			currContext = "";
		}
	}

	// Handle input changes
	async function handleInput() {
		searchResult = await searchHelper.search(queryText);
		updateItem(0);
		// wait until all dynamic elements are mounted and rendered
		await tick();
		if (searchResult.type === SearchType.IN_FILE) {
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
		}
	}

	// Handle result click
	function handleResultClick(index: number): void {
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

	function handleConfirmItem() {
		modal.close();

		if (searchResult.type === SearchType.IN_FILE) {
			const selectedItem = searchResult.items[
				currItemIndex
			] as InFileItem;
			if (selectedItem) {
				// 将焦点移至编辑器的特定行和列
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					const row = selectedItem.line.row;
					const col = selectedItem.line.col;
					view.editor.setCursor(row, col);
					view.editor.scrollIntoView({
						from: { line: row - 10, ch: 0 },
						to: { line: row + 10, ch: 0 },
					});
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
	listenEvent(EventEnum.CONFIRM_ITEM, handleConfirmItem);
</script>

<div class="cs-searchbar">
	<!-- svelte-ignore a11y-autofocus -->
	<input
		bind:value={queryText}
		on:input={handleInput}
		placeholder="Start your search..."
		autofocus
	/>
</div>
<div class="cs-search-results">
	<div class="cs-results-leftpane">
		<ul>
			{#each searchResult.items as item, index}
				<button
					class:selected={index === currItemIndex}
					bind:this={item.element}
					on:click={() => handleResultClick(index)}
				>
					{#if item instanceof InFileItem}
						{@html item.line.text}
					{/if}
				</button>
			{/each}
		</ul>
	</div>
	<div class="cs-result-rightpane">
		{#if currContext}
			<p>{@html currContext}</p>
		{/if}
	</div>
</div>

<style>
	.cs-searchbar {
		background: rgba(0, 0, 0, 0);
		padding: 10px;
		margin-left: 1em;
		border-radius: 5px;
		color: white;
	}
	.cs-searchbar input {
		width: 100%;
		padding: 8px 12px;
		border: none;
		border-radius: 4px;
		color: #ddd;
		background: #222;
		/* Refined gradient box-shadow with a more subtle effect */
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.18),
			0 2px 3px rgba(0, 0, 0, 0.26);
	}

	.cs-search-results {
		display: flex;
		margin-top: 10px;
	}
	.cs-results-leftpane {
		display: flex;
		flex-direction: column; /* Stack children vertically */
		align-items: center;
		flex: 0 0 40%;
		margin-right: 10px;
	}

	.cs-results-leftpane ul {
		list-style: none; /* 移除默认的列表样式 */
		padding: 0; /* 移除默认的内边距 */
		width: 100%; /* 如果需要，设置一个宽度 */
		max-width: 300px; /* 限制最大宽度，根据需要调整 */
		/* overflow: scroll; */
	}

	/* 调整按钮样式以响应居中布局 */
	.cs-results-leftpane button {
		display: flex;
		justify-content: left;
		align-items: center;
		overflow: hidden;
		padding: 10px;
		width: 100%; /* 按钮宽度与ul一致 */
		text-align: center; /* 文本居中 */
		background: #222;
		border: none;
		border-radius: 4px;
		color: #ddd;
		margin-bottom: 5px;
		cursor: pointer;
		transition: background-color 0.01s;
	}

	.cs-results-leftpane button:hover,
	.cs-results-leftpane button.selected {
		background-color: #555;
	}

	.cs-result-rightpane {
		flex: 0 0 60%;
		background: #222;
		width: fit-content;
		height: fit-content;
		border-radius: 4px;
		color: #ddd;
	}

	.cs-result-rightpane p {
		padding: 18px;
		margin: 0;
		white-space: pre-wrap;
	}
</style>
