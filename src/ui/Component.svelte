

<script lang="ts">
  export let queryText: string;
</script>

<div class="cs-searchbar">
  <!-- <span>My number is {queryText}!</span> -->
  <input bind:value={queryText} placeholder="Start your search..." />
  <div class="cs-search-results">
    <div class="cs-results-leftpane">
      <ul>

      </ul>
    </div>
    <div class="cs-result-rightpane"></div>
  </div>
</div>

<style>
</style>