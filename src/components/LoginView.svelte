<script lang="ts">
	import cookie from "cookiejs";

	let username: string;
	let password: string;
	let hasError: boolean;

	async function login() {
		const response = await fetch("http://localhost:3004/api/login", {
			method: "POST",
			body: JSON.stringify({
				username,
				password,
			}),
		});

		const json = await response.json();

		if (json.success == true) {
			cookie.set("token", json.data.token);
			cookie.set("expires", json.data.expires);
			window.location.href = "/";
		} else {
			hasError = true;
		}
	}
</script>

<div
	class="w-[300px] mx-auto flex flex-col relative top-[50%] translate-y-[-50%] gap-2">
	<h1>Login</h1>
	<div class="flex flex-col gap-1">
		<span>Username</span>
		<input
			type="text"
			placeholder="Username"
			bind:value={username} />
	</div>
	<div class="flex flex-col gap-1">
		<span>Password</span>
		<input
			type="password"
			placeholder="Password"
			bind:value={password} />
	</div>
	{#if hasError}
		<p class="text-red-400">
			Das hat leider nicht geklappt, haben sie ihr Passwort und den Nutzernamen
			richtig eingegeben?
		</p>
	{/if}
	<div class="flex justify-between items-center mt-2">
		<button on:click={login}>Login</button>
		<a href="/register">Register</a>
	</div>
</div>
