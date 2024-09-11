export type SchemaType =
	| StringSchemaType
	| NumberSchemaType
	| ObjectSchemaType
	| ArraySchemaType
	| BooleanSchemaType
	| NullSchemaType
	| AnySchemaType;

export type StringSchemaType = {
	type: "string";
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	format?: string;
};

export type NumberSchemaType = {
	type: "number";
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: boolean;
	exclusiveMaximum?: boolean;
	multipleOf?: number;
};

export type ObjectSchemaType = {
	type: "object";
	properties: { [key: string]: SchemaType };
	required?: string[];
};

export type ArraySchemaType = {
	type: "array";
	items: SchemaType;
	minItems?: number;
	maxItems?: number;
	uniqueItems?: boolean;
};

export type BooleanSchemaType = { type: "boolean" };

export type NullSchemaType = { type: "null" };

export type AnySchemaType = { type: "any" };
