<script lang="ts">
	import Sortable from "sortablejs";
	import { flip } from "svelte/animate";
	import Card from "./Card.svelte";
	import type { List } from "../types";
  import { onMount } from "svelte";

	export let list: List;
	export let allLists: List[];
	export let updateLists: Function;

	$: ({cards} = list)

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

	let sortableSection: HTMLElement;

	onMount(() => {
		Sortable.create(sortableSection, {
			group: {
				name: "lists",
				put: true
			},
			animation: 200,
			setData: () => {

			},
			onAdd: (evt) => {
				const oldList = allLists.find(l => l.uid == evt.item.dataset.list);
				if (!oldList) {
					return
				}
				// list.cards = list.cards.splice(evt.newIndex, 0, oldList.cards[evt.oldIndex])
				
				
				updateLists(allLists)
			},
			onRemove: (evt) => {
				//list.cards = list.cards.splice(evt.oldIndex, 1);
				console.log(allLists);
				
			}
		})
	})
</script>

<div
	class="rounded-lg bg-gray-100 border min-h-[200px] w-[300px] flex flex-col">
	<div class="w-full py-4 px-4 flex flex-row justify-between items-center">
		<h2 class="text-lg font-medium text-gray-500">{list.name} - {list.id}</h2>
		<span
			class="rounded-full bg-secondary text-primary w-[35px] h-[35px] flex items-center justify-center font-medium text-sm">
			{cards.length}
		</span>
	</div>
	<section
	bind:this={sortableSection}
		class="px-4 py-4 flex flex-col gap-4 mb-auto h-full min-h-[200px]">
		{#each cards as card (card.uid)}
			<div data-list={list.uid} animate:flip={{ duration: 200 }}>
				<Card {card} />
			</div>
		{/each}
	</section>
	<button
		on:click={() => addCard()}
		class="w-full py-2 px-4 flex flex-row justify-between items-center hover:bg-gray-200 cursor-pointer transition-colors text-gray-500 hover:text-gray-700">
		+ Add Card
	</button>
</div>