import type { Board, Workspace } from "../types";
import { db } from "./Shared";
import { v4 as uuid } from "uuid";

export async function getBoards(workspace: Workspace): Promise<Board[] | null> {
	if (!workspace) {
		return null;
	}

	const boards = await db
		.select<Board[]>("*")
		.from("boards")
		.where("workspace_id", workspace.id);

	if (!boards) {
		return null;
	}

	return boards;
}

export async function getBoard(id: number | string): Promise<Board | null> {
	if (typeof id == "undefined") {
		return null;
	}

	let board: Board | undefined;
	if (typeof id == "string") {
		board = await db
			.select<Board>("*")
			.from("boards")
			.where("uid", id)
			.first();
	} else if (typeof id == "number") {
		board = await db.select<Board>("*").from("boards").where("id", id).first();
	} else {
		return null;
	}

	if (!board) {
		return null;
	}

	return board;
}

export async function createBoard(
	name: string,
	description: string,
	workspace_id: number
): Promise<{
	uid: string;
	id: number;
} | false> {
	if (!name || name.length < 2) {
		return false;
	}

	const uid = uuid();

	const result = await db("boards").insert(
		{
			name,
			description,
			uid,
			workspace_id,
		},
		["id"]
	);

	if (!result) {
		return false;
	}

	return {
		uid,
		id: result[0]
	};
}
