<script lang="ts">
	import ObjectSchema from "./ObjectSchema.svelte";
	import SchemaContainer from "./SchemaContainer.svelte";
	import SchemaRenderer from "./SchemaRenderer.svelte";
	import type { ObjectSchemaType } from "./types";

	export let schema: ObjectSchemaType;
	export let name: string
	export let required: boolean = false;
</script>

{#if schema.properties}
	<SchemaContainer>
		<h4 class="flex items-center gap-4 my-0"><span class="badge badge-md badge-primary font-bold">object</span> {name}</h4>
		<ul class="list-none">
			{#each Object.entries(schema.properties) as [name, value]}
				<li class="my-0"><SchemaRenderer schema={value} {name} required={schema.required && schema.required.indexOf(name) > -1}></SchemaRenderer></li>
			{/each}
		</ul>
	</SchemaContainer>
{/if}