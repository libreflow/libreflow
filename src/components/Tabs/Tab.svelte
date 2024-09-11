<script>
	import { getContext } from 'svelte';
	import { TABS } from './Tabs.svelte';

	const tab = {};
	const { registerTab, selectTab, selectedTab } = getContext(TABS);

	registerTab(tab);
</script>

<button class:selected="{$selectedTab === tab}" class="px-2 py-1 text-base rounded-lg" on:click="{() => selectTab(tab)}">
	<slot></slot>
</button>

<style>
	.selected {
		@apply bg-gradient-to-tr from-primary to-primary-focus text-white;
	}
</style>