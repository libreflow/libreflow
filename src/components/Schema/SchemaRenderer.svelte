<script lang="ts">
	import ArraySchema from "./ArraySchema.svelte";
	import ObjectSchema from "./ObjectSchema.svelte";
	import StringSchema from "./StringSchema.svelte";
	import { type SchemaType } from "./types";

	export let schema: SchemaType;
	export let name: string;
	export let required: boolean = false;
</script>

{#if schema.type === "object"}
	<ObjectSchema {schema} {name} {required} />
{:else if schema.type === "string"}
	<StringSchema {schema} {name} {required} />
{:else if schema.type === "array"}
	<ArraySchema {schema} {name} {required} />
{/if}