<script lang="ts">
	import type { Workspace } from "../types";
	import Modal, { getModal } from "./Modal.svelte";

	export let workspaces: Workspace[];

	let workspaceName: string;
	let disableButton: boolean = false;

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
</script>

<button on:click={() => getModal().open()} class="h-[300px] border-4 border-gray-200 hover:border-gray-300 transition-colors rounded-lg border-dashed flex items-center justify-center group">
	<svg width="50" height="50" class="fill-gray-400 group-hover:scale-110 group-hover:fill-gray-500 transition-all" viewBox="0 0 15 15" xmlns="http://www.w3.org/2000/svg"><path d="M8 2.75C8 2.47386 7.77614 2.25 7.5 2.25C7.22386 2.25 7 2.47386 7 2.75V7H2.75C2.47386 7 2.25 7.22386 2.25 7.5C2.25 7.77614 2.47386 8 2.75 8H7V12.25C7 12.5261 7.22386 12.75 7.5 12.75C7.77614 12.75 8 12.5261 8 12.25V8H12.25C12.5261 8 12.75 7.77614 12.75 7.5C12.75 7.22386 12.5261 7 12.25 7H8V2.75Z" fill-rule="evenodd" clip-rule="evenodd"></path></svg>
</button>

<Modal title="Add a new Workspace">
	<div class="flex flex-col gap-4">
		<p class="text-lg">
			Workspaces help you organize team members, boards and projects so they don't
			interfere with each other.
		</p>
	
		<div class="flex flex-row gap-4">
			<input
				type="text"
				class="w-full"
				placeholder="Workspace Name"
				bind:value={workspaceName} />
			<button class="border rounded-lg px-4 py-2 hover:bg-gray-100 transition-colors font-semibold w-fit"
				on:click={createWorkspace}
				disabled={disableButton}>
				Create
			</button>
		</div>
	</div>
</Modal>
