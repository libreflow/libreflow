<script lang="ts">
	import type { StringSchemaType } from "./types";

	export let schema: StringSchemaType;
	export let name: string;
	export let required: boolean = false;
</script>

<div class="flex items-center gap-4">
		<h5 class="flex items-center gap-4 my-0">
			<span class="badge badge-md badge-primary font-bold">string</span>
			{#if required}
				<span class="badge badge-md badge-warning font-bold">required</span>
			{/if}
			{name}
		</h5>
	{#if schema.minLength}
		<p>Minimum length: {schema.minLength}</p>
	{/if}
	{#if schema.maxLength}
		<p>Maximum length: {schema.maxLength}</p>
	{/if}
	{#if schema.pattern}
		<p>Pattern: {schema.pattern}</p>
	{/if}
	{#if schema.format}
		<p>Format: {schema.format}</p>
	{/if}
</div>