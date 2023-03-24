<script lang="ts">
	export let color: string = "rgb(167 139 250)"; 
</script>

<span
	class="px-2 py-1 rounded-lg text-primary font-medium text-sm" style="background-color: {color};">
	<slot />
</span>
