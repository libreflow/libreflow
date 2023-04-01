<script lang="ts">
	import { getModal } from "../components/Modal.svelte";
	import type { Board } from "../types";
	import AddBoardButton from "./AddBoardButton.svelte";
	import Trash from "./Trash.svelte";

	export let boards: Board[];
	export let organizatonId: number;

	async function deleteBoard(uid: string) {
		if (!uid) {
			// TODO Popup error Message
			return;
		}

		const response = await fetch("/api/boards", {
			method: "DELETE",
			body: JSON.stringify({
				uid,
			}),
		}).then((response) => response.json());

		if (response.success == true) {
			getModal().close();
			boards = boards.filter((board) => board.uid !== uid);
		}
	}
</script>

<h2>Boards</h2>
<div class="grid grid-cols-6 gap-4">
	{#each boards as board}
		<div class="border rounded-lg flex flex-row justify-between">
			<a
				href="/boards/{board.id}"
				class="px-4 py-4 w-full">
				<h2>{board.name}</h2>
				<p>{board.description}</p>
			</a>
			<div
				class="px-4 py-4 hover:bg-gray-100 cursor-pointer"
				on:click={() => deleteBoard(board.uid)}
				on:keydown={() => deleteBoard(board.uid)}>
				<Trash />
			</div>
		</div>
	{/each}
	<AddBoardButton
		bind:boards={boards}
		{organizatonId} />
</div>
