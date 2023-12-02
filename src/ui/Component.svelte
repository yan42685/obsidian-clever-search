<script lang="ts">
  import { onMount } from "svelte";
  import { container } from "tsyringe";
  import { SearchService } from "../search-service";

  const searchService: SearchService = container.resolve(SearchService);

  export let queryText: string;
  let searchResults: any[] = [];
  let selectedFileIndex = 0;
  let focusedFileContent = "";

  // Function to update the focused content and selected file index
  function updateFocusedContent(index) {
    focusedFileContent = searchResults[index].content;
    selectedFileIndex = index;
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  async function handleInput() {
    const result = await searchService.search(queryText);
    if (result && result.hits && result.hits.hits) {
      searchResults = result.hits.hits.map((hit: any) => ({
        fileName: hit._source.title,
        content: hit._source.content,
      }));
      if (searchResults.length > 0) {
        updateFocusedContent(0);
      }
    } else {
      searchResults = [];
      focusedFileContent = "";
    }
  }

  function handleResultClick(index) {
    updateFocusedContent(index);
  }

  function handleKeyDown(event) {
    if (event.ctrlKey && searchResults.length > 0) {
      if (event.key === 'j') {
        selectedFileIndex = (selectedFileIndex + 1) % searchResults.length;
        updateFocusedContent(selectedFileIndex);
        event.preventDefault();
      } else if (event.key === 'k') {
        selectedFileIndex = (selectedFileIndex - 1 + searchResults.length) % searchResults.length;
        updateFocusedContent(selectedFileIndex);
        event.preventDefault();
      }
    }
  }
</script>

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
    flex: 1;
    margin-right: 10px;
  }
  .cs-results-leftpane button {
    display: block;
    padding: 10px;
    width: 100%;
    text-align: left;
    background: #222;
    border: none;
    border-radius: 4px;
    color: #ddd;
    margin-bottom: 5px;
    cursor: pointer;
    transition: background-color 0.3s;
  }
  .cs-results-leftpane button:hover, .cs-results-leftpane button.selected {
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
      {#each searchResults as result, index}
        <button
          class:selected={index === selectedFileIndex}
          on:click={() => handleResultClick(index)}
        >
          {result.fileName}
        </button>
      {/each}
    </ul>
  </div>
  <div class="cs-result-rightpane">
    {#if focusedFileContent}
      <p>{focusedFileContent}</p>
    {/if}
  </div>
</div>
