<script lang="ts">
	import { flip } from "svelte/animate";
	import { dndzone } from "svelte-dnd-action";
	import Card from "./Card.svelte";
	import type { Card as CardType } from "../types";

	export let cards: CardType[];
	export let name: string;
	export let uid: string;
	export let onDrop: (items: any) => void;

	const flipDurationMs = 150;
	function handleDndConsider(e: Event & { detail: { items: any }}) {
		cards = e.detail.items;
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
				list_uid: uid,
			}),
		}).then((response) => response.json());

		if (response.success == true) {
			cards.push({
				title: "New Card",
				description: "This is a demo card!",
				tags: [],
				additional: [],
				uid: response.data.uid,
				id: response.data.uid,
			});
			cards = cards;
		}
	}
</script>

<div
	class="rounded-lg bg-gray-100 border min-h-[200px] w-[300px] flex flex-col">
	<div class="w-full py-4 px-4 flex flex-row justify-between items-center">
		<h2 class="text-lg font-medium text-gray-500">{name}</h2>
		<span
			class="rounded-full bg-secondary text-primary w-[35px] h-[35px] flex items-center justify-center font-medium text-sm">
			{cards.length}
		</span>
	</div>
	<div
		class="px-4 py-4 flex flex-col gap-4 mb-auto h-full min-h-[200px]"
		use:dndzone={{ items: cards, flipDurationMs }}
		on:consider={handleDndConsider}
		on:finalize={handleDndFinalize}>
		{#each cards as card (card.uid)}
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
