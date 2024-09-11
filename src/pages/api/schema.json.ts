import { APIError, defineApiRoute } from "astro-typesafe-api/server";
import { z } from "zod";
import ZSchema from "z-schema";
import semver from "semver";
import { prisma, sqids } from "src/shared";
import crypto from "crypto";
import type { Schema } from "@prisma/client";



export const PUT = defineApiRoute({
	input: z.object({
		name: z.string().refine((data) => {
			// Make sure the name has no special characters
			const regex = /^[a-zA-Z0-9-_]+$/;
			return regex.test(data);
		}, "Name can only contain letters, numbers, hyphens, and underscores."),
		description: z.string().optional(),
		schema: z.custom<{[key:string]: any}>((data) => {
			const validator = new ZSchema({
				strictMode: false
			});

			const isSchemaValid = validator.validateSchema(data);

			if (isSchemaValid) {
				return data;
			}
		}, "Provided schema could not be validated against the JSON Schema spec."),
		categories: z.array(z.string()).optional(),
		version: z.string().refine((data) => {
			const valid = semver.valid(semver.coerce(data));

			if (valid !== null) {
				return valid;
			}
		}, "Invalid semantic version number.")
	}),
	output: z.object({
		uid: z.string()
	}),
	async fetch(input, { request }) {
		// Check all previous versions of the schema
		const existing = await prisma.schema.findMany({
			where: {
				name: input.name
			}
		});

		// Check if the schema already exists
		if (existing.length > 0) {
			const existingVersions = existing.map((schema) => schema.version);

			if (existingVersions.includes(input.version)) {
				throw new APIError({
					code: "CONFLICT",
					message: "Schema with this version already exists."
				});
			}

			// Check if the new version is higher than all existing versions
			const highestVersion = semver.maxSatisfying(existingVersions, "*");

			if (highestVersion && semver.gt(highestVersion, input.version)) {
				throw new APIError({
					code: "CONFLICT",
					message: "New version is lower than the highest already published version."
				});
			}
		}

		const sha512 = crypto.createHash("sha512").update(JSON.stringify(input.schema)).digest("hex");

		// Make sure the schema has not been published yet under a different name
		const existingSchema = await prisma.schema.findFirst({
			where: {
				sha512
			}
		});

		if (existingSchema) {
			throw new APIError({
				code: "CONFLICT",
				message: `The '${existingSchema.name}' schema already provides the same schema. Make sure your schema is unique or consider using theirs.`
			});
		}

		const result = await prisma.schema.create({
			data: {
				schema: input.schema,
				categories: [],
				name: input.name,
				version: input.version,
				description: input.description,
				sha512
			}
		})

		return {
			uid: sqids.encode([result.id])
		}
	}
})

export const GET = defineApiRoute({
	input: z.object({
		name: z.string(),
		version:  z.string().optional().refine((data) => {
			if (data === undefined) {
				return true;
			}

			const valid = semver.valid(semver.coerce(data));

			if (valid !== null) {
				return valid;
			}
		}, "Invalid semantic version number."),
	}),
	output: z.any(),
	async fetch(input, {request}) {
		let schema: Schema | null = null;

		if (input.version) {
			schema = await prisma.schema.findUnique({
				where: {
					name_version: {
						name: input.name,
						version: input.version
					}
				}
			})
		} else {
			schema = await prisma.schema.findFirst({
				where: {
					name: input.name
				},
				orderBy: {
					version: "desc"
				}
			})
		}

		if (!schema) {
			throw new APIError({
				code: "NOT_FOUND",
				message: "Schema not found."
			})
		}

		return schema.schema;
	}
})