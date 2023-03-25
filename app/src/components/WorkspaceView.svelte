<script lang="ts">
	import Modal, { getModal } from "./Modal.svelte";
	import type { Workspace } from "../types";
	import Trash from "./Trash.svelte";
	import AddWorkspaceButton from "./AddWorkspaceButton.svelte";

	export let workspaces: Workspace[];

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
</script>

<h1>Workspaces</h1>
<div class="grid grid-cols-6 gap-4">
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
	<AddWorkspaceButton {workspaces} />
</div>
