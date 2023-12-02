<script lang="ts">
	import { container } from "tsyringe";
	import { SearchService } from "../search-service";
// 确保路径正确
	import { PluginManager } from "src/plugin-manager";
	import { onMount } from "svelte";

 console.log(111);
	const pluginManager: PluginManager = container.resolve(PluginManager);
  console.log(pluginManager);
	const searchService: SearchService = container.resolve(SearchService);
 console.log(222);
	export let queryText: string;
	let searchResults: any[] = [];

	onMount(async () => {
		// 如果需要在组件加载时执行搜索，可以在这里调用
	});

	async function handleInput() {
		const result = await searchService.search(queryText);
		if (result && result.hits && result.hits.hits) {
			searchResults = result.hits.hits.map((hit: any) => ({
				fileName: hit._source.title,
				content: hit._source.content,
			}));
		} else {
			searchResults = [];
		}
	}

	let focusedFileContent = "";

	function handleResultClick(file: any) {
		focusedFileContent = file.content;
	}
</script>

<div class="cs-searchbar">
	<input
		bind:value={queryText}
		on:input={handleInput}
		placeholder="Start your search..."
	/>
	<div class="cs-search-results">
		<div class="cs-results-leftpane">
			<ul>
				{#each searchResults as result}
					{#each searchResults as result}
						<li>
							<button
								on:click={() => handleResultClick(result)}
								on:keydown={(e) =>
									e.key === "Enter" &&
									handleResultClick(result)}
							>
								{result.fileName}
							</button>
						</li>
					{/each}
				{/each}
			</ul>
		</div>
		<div class="cs-result-rightpane">
			{#if focusedFileContent}
				<p>{focusedFileContent}</p>
			{/if}
		</div>
	</div>
</div>
