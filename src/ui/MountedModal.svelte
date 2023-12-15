<script lang="ts">
	import { InFileResult, type SearchResult } from "src/entities/search-types";
	import { SearchHelper } from "src/search-helper";
	import { eventBus } from "src/utils/event-bus";
	import { EventEnum } from "src/utils/event-enum";
	import { onDestroy } from "svelte";
	import { container } from "tsyringe";

	// const searchService: SearchService = container.resolve(SearchService);
	// 这是一个异步方法
	// searchService.testProcedure();

	const searchHelper: SearchHelper = container.resolve(SearchHelper);


	export let queryText: string;
	let searchResult: SearchResult = { path: "", count: 0 };
	let currItemIndex = 0;
	let currContext = "";

	// Updates focused content and selected file index
	function updateItem(index: number): void {
		if (searchResult instanceof InFileResult) {
			if (index >= 0 && index < searchResult.count) {
				currContext = searchResult.items[index].context;
				currItemIndex = index;
			}
		} else {
			throw Error("unsupported result type: " + typeof searchResult);
		}
	}

	// Handle input changes
	async function handleInput() {
		searchResult = await searchHelper.search(queryText);
		updateItem(0);
	}

	// Handle result click
	function handleResultClick(index: number): void {
		updateItem(index);
	}

	// Select the next search result
	function selectNextResult() {
		updateItem(Math.min(currItemIndex + 1, searchResult.count - 1));
	}

	// Select the previous search result
	function selectPreviousResult() {
		updateItem(Math.max(currItemIndex - 1, 0));
	}

	// ===================================================
	// onMount() 方法不会被触发，换一个自定义方法在初始化时调用
	function init() {
		eventBus.on(EventEnum.NEXT_ITEM, selectNextResult);
		eventBus.on(EventEnum.PREV_ITEM, selectPreviousResult);
	}
	init();

	onDestroy(() => {
		eventBus.off(EventEnum.NEXT_ITEM, selectNextResult);
		eventBus.off(EventEnum.PREV_ITEM, selectPreviousResult);
	});
</script>

<div class="cs-searchbar">
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
			{#if searchResult instanceof InFileResult}
				{#each searchResult.items as result, index}
					<button
						class:selected={index === currItemIndex}
						on:click={() => handleResultClick(index)}
					>
						{result.line.text}
					</button>
				{/each}
			{/if}
		</ul>
	</div>
	<div class="cs-result-rightpane">
		{#if currContext}
			<p>{currContext}</p>
		{/if}
	</div>
</div>

<style>
	.cs-searchbar {
		background: #333;
		padding: 10px;
		border-radius: 5px;
		color: white;
	}
	.cs-searchbar input {
		width: 100%;
		padding: 8px 12px;
		border: 2px solid #555;
		border-radius: 4px;
		color: #ddd;
		background: #222;
	}
	.cs-search-results {
		display: flex;
		margin-top: 10px;
	}
	.cs-results-leftpane {
		display: flex;
		flex-direction: column; /* Stack children vertically */
		/* Center children vertically */
		/* justify-content: center;  */
		/* Center children horizontally */
		align-items: center;
		flex: 1;
		margin-right: 10px;
	}

	/* 如果你希望ul标签也居中，可能需要添加以下样式 */
	.cs-results-leftpane ul {
		list-style: none; /* 移除默认的列表样式 */
		padding: 0; /* 移除默认的内边距 */
		width: 100%; /* 如果需要，设置一个宽度 */
		max-width: 300px; /* 限制最大宽度，根据需要调整 */
	}

	/* 调整按钮样式以响应居中布局 */
	.cs-results-leftpane button {
		display: block;
		padding: 10px;
		width: 100%; /* 按钮宽度与ul一致 */
		text-align: center; /* 文本居中 */
		background: #222;
		border: none;
		border-radius: 4px;
		color: #ddd;
		margin-bottom: 5px;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.cs-results-leftpane button:hover,
	.cs-results-leftpane button.selected {
		background-color: #555;
	}

	.cs-result-rightpane {
		flex: 3;
		background: #222;
		padding: 15px;
		border-radius: 4px;
		color: #ddd;
	}

	p {
		white-space: pre-wrap;
	}
</style>
