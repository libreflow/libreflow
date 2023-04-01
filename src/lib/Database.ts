import knex, { Knex } from "knex";

export function dbOpen(): Knex {
	return knex({
		client: "pg",
		connection: {
			host: "localhost",
			port: 5430,
			user: "main",
			password: "ujvFYppR@LdUSvW#",
			database: "main"
		}
	})
}