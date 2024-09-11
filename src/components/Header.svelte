<script lang="ts">
	import ThemeController from "./ThemeController.svelte";
	import { lightMode } from "#lib/shared";
	import ReactiveImage from "./ReactiveImage.svelte";

	export let light: boolean = false;

	lightMode.set(light);
</script>
<header class="h-full border-b border-base-200 py-8 px-16">
	<div class="max-w-screen-xl flex flex-row justify-between items-center mx-auto">
		<a href="/">
			<ReactiveImage src="/logo-long-light.svg" srclight="/logo-long-dark.svg" class="h-12"></ReactiveImage>
		</a>
		<nav>
			<ul class="flex flex-row gap-8">
				<li class="font-bold text-xl link link-hover"><a href="/docs">Docs</a></li>
				<li class="font-bold text-xl link link-hover"><a href="/schemas">Schemas</a></li>
				<li class="font-bold text-xl link link-hover"><a href="/validate">Validate</a></li>
				<li class="font-bold text-xl link link-hover"><a href="/about">About</a></li>
			</ul>
		</nav>
		<div class="flex flex-row items-center gap-4">
			<input type="text" class="input input-bordered input-md">
			<ThemeController></ThemeController>
		</div>
	</div>
</header>