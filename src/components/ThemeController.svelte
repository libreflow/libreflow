<script lang="ts">
	import { Moon, Sun } from "radix-svelte-icons";
	import Cookie from "js-cookie"
	import { lightMode } from "#lib/shared";

	function toggleLightTheme() {
		lightMode.set(!$lightMode)
		Cookie.set("light", $lightMode.toString(), {
			expires: 365,
			path: "/",
		})
	}

	export let size: number = 24;
</script>


<button class="btn btn-square btn-ghost p-2" on:click={toggleLightTheme}>
	<div class="swap swap-rotate">
		<input type="checkbox" class="theme-controller" hidden checked={$lightMode} value={"light"} />
		<input type="checkbox" class="theme-controller" hidden checked={!$lightMode} value={"black"} />
	
		<Sun {size} class={$lightMode ? "swap-on" : "swap-off"} />
		<Moon {size} class={$lightMode ? "swap-off" : "swap-on"} />
	</div>
	
</button>