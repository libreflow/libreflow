<script lang="ts">
	import * as EmailValidator from 'email-validator';

	let username: string;
	let password: string;
	let passwordRepeat: string;
	let email: string;
	let error: string = "";

	async function createAccount() {
		if (password !== passwordRepeat) {
			error = "Passwords don't match!";
			return;
		}
		if (!EmailValidator.validate(email)) {
			error = "Please enter a valid email so others can reach you."
			return;
		}

		const response = await fetch("http://localhost:3004/api/user", {
			method: "PUT",
			body: JSON.stringify({
				username, password, email
			})
		})

		const result = await response.json();

		if (result.success == true) {
			window.location.href = "/login";
		}
	}
</script>

<div class="w-[300px] mx-auto flex flex-col relative top-[50%] translate-y-[-50%] gap-2">
	<h1>Register</h1>
	<div class="flex flex-col gap-1">
		<span>Username</span>
		<input type="text" placeholder="Username" bind:value={username}>
	</div>
	<div class="flex flex-col gap-1">
		<span>Email</span>
		<input type="text" placeholder="Email" bind:value={email}>
	</div>
	<div class="flex flex-col gap-1">
		<span>Password</span>
		<input type="password" placeholder="Password" bind:value={password}>
	</div>
	<div class="flex flex-col gap-1">
		<span>Repeat Password</span>
		<input type="password" placeholder="Repeat" bind:value={passwordRepeat}>
	</div>
	<span class="text-red-500">{error}</span>
	<div class="flex flex-col gap-4">
		<div class="flex justify-between items-center mt-2">
			<button on:click={createAccount}>Create Account</button>
			<a href="/login">Login instead</a>
		</div>
		<a href="/settings">Connect to a different remote</a>
	</div>
</div>