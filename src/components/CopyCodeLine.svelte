<script lang="ts">
	export let code: string;

	let tooltipText = "Copy";

	function copy() {
		navigator.clipboard.writeText(code);
		tooltipText = "Copied!";
	}
</script>

<div class="tooltip" data-tip={tooltipText} on:mouseleave={() => setTimeout(() => tooltipText = "Copy", 500)}>
	<pre class="my-0 px-4 py-3 flex items-center gap-4 hover:bg-base-300 bg-base-200 cursor-copy" on:click={copy}><code>{code}</code></pre>
</div>