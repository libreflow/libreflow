<script
	context="module"
	lang="ts">
	let onTop: HTMLDivElement | null; //keeping track of which open modal is on top
	const modals: Record<any, any> = {}; //all modals get registered here for easy future access

	// 	returns an object for the modal specified by `id`, which contains the API functions (`open` and `close` )
	export function getModal(id = "") {
		return modals[id];
	}
</script>

<script lang="ts">
	import { onDestroy } from "svelte";

	let topDiv: HTMLDivElement | null;
	let visible = false;
	let prevOnTop: HTMLDivElement | null;
	let closeCallback: () => void;

	export let id = "";
	export let title: string = "";

	function keyPress(ev: { key: string; }) {
		//only respond if the current modal is the top one
		if (ev.key == "Escape" && onTop == topDiv) close(); //ESC
	}

	/**  API **/
	function open(callback: () => void) {
		closeCallback = callback;
		if (visible) return;
		prevOnTop = onTop;
		onTop = topDiv;
		window.addEventListener("keydown", keyPress);

		//this prevents scrolling of the main window on larger screens
		document.body.style.overflow = "hidden";

		visible = true;
		//Move the modal in the DOM to be the last child of <BODY> so that it can be on top of everything
		if (topDiv) {
			document.body.appendChild(topDiv);
		}
	}

	function close() {
		if (!visible) return;
		window.removeEventListener("keydown", keyPress);
		onTop = prevOnTop;
		if (onTop == null) document.body.style.overflow = "";
		visible = false;
		if (closeCallback) closeCallback();
	}

	//expose the API
	modals[id] = { open, close };

	onDestroy(() => {
		delete modals[id];
		window.removeEventListener("keydown", keyPress);
	});
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
	id="topModal"
	class:visible
	bind:this={topDiv}>
	<div
		id="modal"
		on:click|stopPropagation={() => {}}
		class="w-[800px] shadow-sm p-6 h-auto">
		<div id="modal-content">
			<div class="flex flex-row justify-between items-center">
				<h1 class="m-0">{title}</h1>
				<span class="text-4xl cursor-pointer select-none" on:click={close}>&times;</span>
			</div>
			<slot />
		</div>
	</div>
</div>

<style>
	#topModal {
		visibility: hidden;
		z-index: 9999;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: #4448;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	#modal {
		position: relative;
		border-radius: 6px;
		background: white;
	}

	.visible {
		visibility: visible !important;
	}

	#modal-content {
		max-width: calc(100vw - 20px);
		max-height: calc(100vh - 20px);
	}
</style>
