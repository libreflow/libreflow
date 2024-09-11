import { defineApiRoute } from "astro-typesafe-api/server";
import { z } from "zod";
import { prisma, sqids } from "src/shared";
import type { Prisma, Schema } from "@prisma/client";
import semver from "semver"
import moment from "moment";

export const POST = defineApiRoute({
	input: z.object({
		name: z.string().optional(),
		version: z.string().optional().refine((data) => {
			if (data === undefined) {
				return true;
			}

			const valid = semver.valid(semver.coerce(data));

			if (valid !== null) {
				return valid;
			}
		}, "Invalid semantic version number."),
		category: z.string().optional(),
		tags: z.array(z.string()).optional()
	}),
	output: z.any(),
	async fetch(input, {request}) {
		const where: Prisma.SchemaWhereInput = {
			
		}

		if (input.name) {
			where.name = {
				startsWith: input.name
			}
		}

		if (input.version) {
			where.version = input.version
		}

		if (input.category) {
			where.categories = {
				hasSome: input.category
			}
		}

		if (input.tags) {
			where.tags = {
				hasEvery: input.tags
			}
		}

		const result = await prisma.schema.findMany({
			where,
			orderBy: {
				createdAt: "desc"
			},
			distinct: "name"
		})

		const schemas = result.map(({id, createdAt, updatedAt, sha512, ...rest}: Schema) => {
			return {
				uid: sqids.encode([id]),
				...rest,
				created: moment(createdAt).fromNow()
			}
		})

		return schemas
	}
})