<script lang="ts">
  import type { Card } from "../types";
  import Badge from "./Badge.svelte";
	import CardInspector from "./Inspector/CardInspector.svelte";

	export let card: Card;

	let inspectorVisible: boolean = false;

	function showCardInspector() {
		inspectorVisible = true;
	}
</script>

<div class="bg-primary rounded-lg px-4 py-2 cursor-pointer hover:bg-gray-200 border transition-colors select-none" on:click={showCardInspector} on:keydown={showCardInspector}>
	<div class="mb-2 flex flex-row flex-wrap gap-2">
		{#each card.tags as tag}
			<Badge>{tag.name}</Badge>
		{/each}
	</div>
	<div class="w-full">
		<h2 class="text-base font-medium text-gray-500">{card.title}</h2>
		<p class="text-sm text-gray-400 font-normal">{card.description}</p>
	</div>
</div>
<CardInspector bind:visible={inspectorVisible} bind:card={card}></CardInspector>