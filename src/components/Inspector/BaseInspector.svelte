<script lang="ts">
	export let visible: boolean;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->	
<div class="fixed top-0 left-0 w-full h-full flex justify-end z-50 backdrop-brightness-50" on:click|self={() => visible = false} style={visible ? "visibility: visible;" : "visibility: hidden"}>
	<div class="w-[800px] h-full bg-primary border-l px-8 py-12 overflow-y-auto">
		<slot></slot>
	</div>
</div>