import type { AstroGlobal } from "astro";
import moment from "moment";

export class User {
	public static async isLoggedIn(Astro: AstroGlobal) {
		const expires = Astro.cookies.get("expires").number();

		if (expires < moment().unix()) {
			return false;
		}

		// Validate the token
		const token = Astro.cookies.get("token").value;

		const response = await fetch("http://libreflow-server:3004/api/validate", {
			method: "POST",
			body: JSON.stringify({
				token
			})
		});

		const result = await response.json()

		return result.success;
	}
}