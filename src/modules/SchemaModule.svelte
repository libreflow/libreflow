<script lang="ts">
	import { Tabs, TabList, Tab, TabPanel } from "#components/Tabs"
	import SchemaRenderer from "#components/Schema/SchemaRenderer.svelte"
	import { type Schema } from "@prisma/client"
	import { ArrowRight, CrumpledPaper, Download, Pencil2 } from "radix-svelte-icons";
	import { InfoCircled, CrossCircled } from "radix-svelte-icons";
	import CopyCodeLine from "#components/CopyCodeLine.svelte";


	export let schema: Schema;
	export let typescript: string;
	export let latest: Schema;
	export let markdown: string;
</script>

<main class="my-16 grid grid-cols-1 lg:grid-cols-[1fr,3fr] gap-8 px-8">
	{#if schema.status === "Deprecated"}
		<div role="alert" class="alert alert-error mb-8 col-span-2">
			<CrossCircled size={24}></CrossCircled>
			<span>This Schema version has been deprecated, consider using a newer version.</span>
		</div>
	{:else if schema.version !== latest.version}
		<div role="alert" class="alert mb-8 col-span-2">
			<InfoCircled size={24}></InfoCircled>
			<span>This Schema version is outdated, consider using the <a href="/schemas/{schema.name}/latest">latest version</a>.</span>
		</div>
	{/if}
	<aside class="flex flex-col gap-4">
		<div class="flex flex-col gap-2">
			<span class="text-sm font-bold text-base-content text-opacity-60">Install</span>
			<CopyCodeLine code="openschema pull {schema.name}:{schema.version}"></CopyCodeLine>
		</div>
		<div class="flex flex-col gap-2">
			<span class="text-sm font-bold text-base-content text-opacity-60">Link</span>
			<a href="/schemas/{schema.name}/{schema.version}.json" target="_blank" class="text-sm break-words whitespace-pre-line">https://openschema.wiki/schemas/{schema.name}/{schema.version}.json</a>
		</div>
		<div class="divider my-0"></div>
		<div class="flex flex-col gap-2">
			<span class="text-sm font-bold text-base-content text-opacity-60">Downloads</span>
			<span class="text-sm flex flex-row gap-2 items-center"><Download size={20}></Download> {schema.downloads}</span>
		</div>
		<div class="divider my-0"></div>
		<div class="flex flex-col gap-2">
			<span class="text-sm font-bold text-base-content text-opacity-60">Tags</span>
			<div>
				{#each schema.tags as tag}
					<span class="badge badge-md badge-neutral">{tag}</span>
				{/each}
			</div>
		</div>
	</aside>
	<article>
		<header>
			<div class="flex flex-row justify-between items-start">
				<h1 class="mb-4">{schema.name}</h1>
				<div class="flex flex-row gap-2">
					<div class="tooltip" data-tip="Download">
						<button class="btn btn-ghost btn-square"><Download size={18}></Download></button>
					</div>
					<div class="tooltip" data-tip="Suggest Edit">
						<button class="btn btn-ghost btn-square"><Pencil2 size={18}></Pencil2></button>
					</div>
					<div class="tooltip" data-tip="Report">
						<button class="btn btn-ghost btn-square"><CrumpledPaper size={18}></CrumpledPaper></button>
					</div>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<span class="badge badge-lg font-bold">Version: {schema.version}</span>
				<ArrowRight></ArrowRight>
				<span class="badge badge-lg font-bold">Latest: {latest.version}</span>
			</div>
			<div class="divider"></div>
			{@html markdown}
			<Tabs>
				<TabList>
					<Tab>Schema</Tab>
					<Tab>Typescript</Tab>
				</TabList>
				<TabPanel>
					<SchemaRenderer schema={schema.schema} name={schema.name}></SchemaRenderer>
				</TabPanel>
				<TabPanel>
					<pre><code>{typescript}</code></pre>
				</TabPanel>
			</Tabs>
		</header>
	</article>
</main>