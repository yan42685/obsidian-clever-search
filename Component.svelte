<script lang="ts">
  export let queryText: string;
</script>

<div class="number">
  <span>My number is {queryText}!</span>
</div>

<style>
  .number {
    color: red;
  }
</style>