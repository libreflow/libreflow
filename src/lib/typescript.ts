import type { SchemaType } from "#components/Schema/types";
import { compile } from "json-schema-to-typescript";

export async function convertSchemaToTypescript(schema: SchemaType, name: string) {
	const ts = await compile(schema, name, {
		$refOptions: {
			continueOnError: true,
		},
		bannerComment: "",
		additionalProperties: false,
	});

	return ts;
}
