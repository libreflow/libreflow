<script lang="ts">
	import Modal, { getModal } from "../components/Modal.svelte";
  import type { Board } from "../types";
  import Trash from "./Trash.svelte";

	export let boards: Board[];
	export let organizatonId: number;

	let boardName: string;
	let boardDescription: string;
	async function createBoard() {
		disableButton = true;
		if (!boardName) {
			// TODO Popup error Message
			return
		}

		const response = await fetch("/api/boards", {
			method: "PUT",
			body: JSON.stringify({
				name: boardName,
				description: boardDescription,
				workspace_id: organizatonId
			})
		}).then(response => response.json())

		if (response.success == true) {
			getModal().close()
			boards.push({
				name: boardName,
				id: response.data.id,
				description: boardDescription,
				uid: response.data.uid,
				lists: []
			})
			boards = boards;
			disableButton = false;
		}
	}

	async function deleteBoard(uid: string) {
		if (!uid) {
			// TODO Popup error Message
			return
		}

		const response = await fetch("/api/boards", {
			method: "DELETE",
			body: JSON.stringify({
				uid
			})
		}).then(response => response.json())

		if (response.success == true) {
			getModal().close()
			boards = boards.filter((board) => board.uid !== uid)
		}
	}

	let disableButton: boolean = false;
</script>

<h2>Boards</h2>
<div class="grid grid-cols-4 gap-4">
	{#each boards as board}
		<div class="border rounded-lg flex flex-row justify-between">
			<a href="/boards/{board.id}" class="px-4 py-4 w-full">
				<h2>{board.name}</h2>
				<p>{board.description}</p>
			</a>
			<div class="px-4 py-4 hover:bg-gray-100 cursor-pointer" on:click={() => deleteBoard(board.uid)} on:keydown={() => deleteBoard(board.uid)}>
				<Trash></Trash>
			</div>
		</div>
	{/each}
	<button on:click={() => getModal().open() }>Add</button>
</div>

<Modal title="Add a new Board">
	<div class="flex flex-col gap-2">
		<span>Name</span>
		<input type="text" placeholder="My Board" bind:value={boardName}>
		<span>Description</span>
		<textarea cols="30" rows="10" bind:value={boardDescription} placeholder="Description"></textarea>
		<button on:click={createBoard} disabled={disableButton}>Create</button>
	</div>
</Modal>