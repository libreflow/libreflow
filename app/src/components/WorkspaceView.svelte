<script lang="ts">
	import Modal, { getModal } from "./Modal.svelte";
	import type { Workspace } from "../types";
	import Trash from "./Trash.svelte";

	export let workspaces: Workspace[];

	let workspaceName: string;
	async function createWorkspace() {
		disableButton = true;
		if (!workspaceName) {
			// TODO Popup error Message
			return;
		}

		const response = await fetch("/api/workspaces", {
			method: "PUT",
			body: JSON.stringify({
				name: workspaceName,
			}),
		}).then((response) => response.json());

		if (response.success == true) {
			getModal().close();
			workspaces.push({
				name: workspaceName,
				members: [],
				boards: [],
				uid: response.data.uid,
			});
			workspaces = workspaces;
			disableButton = false;
		}
	}

	async function deleteWorkspace(uid: string) {
		if (!uid) {
			// TODO Popup error Message
			return;
		}

		const response = await fetch("/api/workspaces", {
			method: "DELETE",
			body: JSON.stringify({
				uid,
			}),
		}).then((response) => response.json());

		if (response.success == true) {
			getModal().close();
			workspaces = workspaces.filter((workspace) => workspace.uid !== uid);
		}
	}

	let disableButton: boolean = false;
</script>

<h1>Workspaces</h1>
<div class="grid grid-cols-4 gap-4">
	{#each workspaces as workspace}
		<div class="border rounded-lg flex flex-row justify-between">
			<a
				href="/workspaces/{workspace.id}"
				class="px-4 py-4 w-full">
				<h2>{workspace.name}</h2>
			</a>
			<div
				class="px-4 py-4 hover:bg-gray-100 cursor-pointer"
				on:click={() => deleteWorkspace(workspace.uid)}
				on:keydown={() => deleteWorkspace(workspace.uid)}>
				<Trash />
			</div>
		</div>
	{/each}
	<button on:click={() => getModal().open()}>Add</button>
</div>

<Modal title="Add a new Workspace">
	<p>
		Workspaces help you organize team members, boards and projects so they
		don't interfere with each other.
	</p>

	<span>Name</span>
	<input
		type="text"
		placeholder="My Workspace"
		bind:value={workspaceName} />
	<button
		on:click={createWorkspace}
		disabled={disableButton}>
		Create
	</button>
</Modal>
