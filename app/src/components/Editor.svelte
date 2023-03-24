<script lang="ts">
	export let value: string;
</script>

<textarea
	cols="30"
	rows="10"
	class="border w-full rounded-lg bg-primary px-2 py-2 outline-none focus:bg-gray-100 resize-y">
	{value}
</textarea>
