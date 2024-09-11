<script lang="ts">
	import { lightMode } from "#lib/shared";

	export let src: string;
	export let srclight: string;	
	export let alt: string = "";
</script>

{#if $lightMode}
	<img src={srclight} {alt} {...$$restProps}>
{:else}
	<img {src} {alt} {...$$restProps}>
{/if}