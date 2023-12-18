<script lang="ts">
	import { MarkdownView, type App, type EditorPosition } from "obsidian";
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
	let currItemIndex = -1;
	let currContext = "";

	$: matchCountText = `${currItemIndex + 1} / ${searchResult.items.length}`;

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
			currItemIndex = -1;
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
		// BUG: 最新的obsidian.d.ts没有app.commands了
		const deprecatedApp = app as any;
		// 对应的command name是Focus on last note
		deprecatedApp.commands.executeCommandById("editor:focus");

		if (searchResult.type === SearchType.IN_FILE) {
			const selectedItem = searchResult.items[
				currItemIndex
			] as InFileItem;
			if (selectedItem) {
				// 将焦点移至编辑器的特定行和列
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
	listenEvent(EventEnum.CONFIRM_ITEM, handleConfirmItem);
</script>

<div class="search-container">
	<div class="left-pane">
		<div class="search-bar" data-match-count={matchCountText}>
			<!-- svelte-ignore a11y-autofocus -->
			<input bind:value={queryText} on:input={handleInput} autofocus />
		</div>
		<div class="result-items">
			<ul>
				{#each searchResult.items as item, index}
					<button
						class:selected={index === currItemIndex}
						bind:this={item.element}
						on:click={(event) => {
							event.preventDefault();
							handleResultClick(index);
						}}
					>
						<span>
							{#if item instanceof InFileItem}
								{@html item.line.text}
							{/if}
						</span>
					</button>
				{/each}
			</ul>
		</div>
	</div>
	<div class="right-pane">
		{#if currContext}
			<div class="context-container">
				<p>{@html currContext}</p>
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
		background-color: rgba(219, 204, 149, 0.9);
		color: #111;
	}

	.left-pane {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 40%;
	}
	.search-bar {
		position: sticky; /* 固定位置 */
		top: 0; /* 顶部对齐 */
		left: 0; /* 左侧对齐 */
		background: rgba(0, 0, 0, 0);
		padding-bottom: 15px;
		border-radius: 5px;
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
		color: grey;
	}
	.search-bar input {
		position: relative;
		width: 100%;
		padding: 8px 12px;
		border: none;
		border-radius: 4px;
		background: #222;
		/* Refined gradient box-shadow with a more subtle effect */
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.18),
			0 2px 3px rgba(0, 0, 0, 0.26);
	}

	.result-items {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		margin-top: 1em;
	}

	.result-items button {
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
		background: #222;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: background-color 0.01s;
	}

	.result-items button:hover,
	.result-items button.selected {
		background-color: #555;
	}

	.result-items ul {
		list-style: none; /* 移除默认的列表样式 */
		padding: 0 0.5em 0 0;
		margin: 0.2em 0 0 0;
		width: 90%;
		height: 45vw;
		overflow-y: auto;
		overflow-x: hidden;
		justify-content: left;
	}

	/* wrap the matched line up to 3 lines and show ... if it still overflows */
	.result-items ul span {
		text-wrap: wrap;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.right-pane {
		width: 60%;
		border-radius: 4px;
	}
	.right-pane .context-container {
		background: #222;
		overflow-y: auto;
		height: 47vw;
		width: 100%;
	}

	.right-pane p {
		padding: 18px;
		margin: 0;
		overflow-wrap: break-word;
	}

	.right-pane .context-container :global(span.target-line) {
		display: inline-block;
		background-color: #468eeb33;
	}
</style>
