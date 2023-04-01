import type { Workspace } from "../types";
import { db } from "./Shared";
import { v4 as uuid } from "uuid";

export async function getWorkspace(
	id: number | string
): Promise<Workspace | null> {
	if (typeof id == "undefined") {
		return null;
	}

	let workspace: Workspace | undefined;
	if (typeof id == "string") {
		workspace = await db
			.select<Workspace>("*")
			.from("workspaces")
			.where("uid", id)
			.first();
	} else if (typeof id == "number") {
		workspace = await db
			.select<Workspace>("*")
			.from("workspaces")
			.where("id", id)
			.first();
	} else {
		return null;
	}

	if (!workspace) {
		return null;
	}

	return workspace;
}

/**
 * Returns a list of all created workspaces.
 * @returns The array of workspaces or null if an error occured.
 */
export async function getWorkspaces(): Promise<Workspace[] | null> {
	let workspace = db.select<Workspace[]>("*").from("workspaces");

	if (!workspace) {
		return null;
	}

	return workspace;
}

export async function createWorkspace(
	name: string
): Promise<{
	uid: string;
	id: number;
} | false> {
	if (!name || name.length < 2) {
		return false;
	}

	const uid = uuid();

	const result = await db("workspaces").insert(
		{
			name,
			uid
		},
		["id"]
	);

	if (!result) {
		return false;
	}

	return {
		id: result[0],
		uid
	};
}
