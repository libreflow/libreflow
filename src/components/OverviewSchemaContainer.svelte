<script lang="ts">
	import type { Schema } from "@prisma/client";
	import moment from "moment"

	export let schema: Schema;
</script>

<div class="border-b border-b-base-300 py-4 flex flex-col">
	<span class="text-sm text-base-content text-opacity-60">{schema.category}</span>
	<a class="my-0 link link-hover no-underline" href="/schemas/{schema.name}/{schema.version}">{schema.name}</a>
	<p class="text-base mt-0 mb-2">{schema.description}</p>
	<div class="flex flex-row gap-2">
		{#each schema.tags as tag}
			<span class="badge badge-sm px-3 py-3">{tag}</span>
		{/each}
	</div>
	<span class="text-sm mt-4">published <strong>{schema.version}</strong> • {moment(schema.createdAt).fromNow()}</span>
</div>