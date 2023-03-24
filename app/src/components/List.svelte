<script lang="ts">
	import { flip } from "svelte/animate";
	import { dndzone } from "svelte-dnd-action";
	import Card from "./Card.svelte";
	import type { List } from "../types";

	export let list: List;
	export let onDrop: (items: any) => void;

	const flipDurationMs = 150;
	function handleDndConsider(e: Event & { detail: { items: any }}) {
		list.cards = e.detail.items;
	}
	function handleDndFinalize(e: Event & { detail: { items: any }}) {
		onDrop(e.detail.items);
	}

	async function addCard() {
		const response = await fetch("/api/cards", {
			method: "PUT",
			body: JSON.stringify({
				title: "New Card",
				description: "This is a demo card!",
				tags: [],
				additional: [],
				list_uid: list.uid,
			}),
		}).then((response) => response.json());

		if (response.success == true) {
			list.cards.push({
				title: "New Card",
				description: "This is a demo card!",
				tags: [],
				additional: [],
				uid: response.data.uid,
				id: response.data.uid,
			});
			list = list;
		}
	}
</script>

<div
	class="rounded-lg bg-gray-100 border min-h-[200px] w-[300px] flex flex-col">
	<div class="w-full py-4 px-4 flex flex-row justify-between items-center">
		<h2 class="text-lg font-medium text-gray-500">{list.name}</h2>
		<span
			class="rounded-full bg-secondary text-primary w-[35px] h-[35px] flex items-center justify-center font-medium text-sm">
			{list.cards.length}
		</span>
	</div>
	<div
		class="px-4 py-4 flex flex-col gap-4 mb-auto h-full min-h-[200px]"
		use:dndzone={{ items: list.cards, flipDurationMs }}
		on:consider={handleDndConsider}
		on:finalize={handleDndFinalize}>
		{#each list.cards as card (card.uid)}
			<div animate:flip={{ duration: flipDurationMs }}>
				<Card {card} />
			</div>
		{/each}
	</div>
	<button
		on:click={() => addCard()}
		class="w-full py-2 px-4 flex flex-row justify-between items-center hover:bg-gray-200 cursor-pointer transition-colors text-gray-500 hover:text-gray-700">
		+ Add Card
	</button>
</div>
