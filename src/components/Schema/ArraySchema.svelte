<script lang="ts">
	import ObjectSchema from "./ObjectSchema.svelte";
	import SchemaContainer from "./SchemaContainer.svelte";
	import SchemaRenderer from "./SchemaRenderer.svelte";
	import type { ArraySchemaType } from "./types";

	export let schema: ArraySchemaType;
	export let name: string
	export let required: boolean = false;
</script>

{#if schema.items}
<SchemaContainer>
		<h4 class="flex items-center gap-4 my-0"><span class="badge badge-md badge-primary font-bold">array</span> {name}</h4>
		<ul class="list-none">
			{#if Array.isArray(schema.items)}
				{#each schema.items as item, index}
					<li class="my-0"><SchemaRenderer schema={item} name={`${name}[${index}]`} required={required}></SchemaRenderer></li>
				{/each}
			{:else}
				<li class="my-0"><SchemaRenderer schema={schema.items} name={name} required={required}></SchemaRenderer></li>
			{/if}
		</ul>
	</SchemaContainer>
{/if}