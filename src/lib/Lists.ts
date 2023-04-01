import type { Board, List } from "../types";
import { db } from "./Shared";
import { v4 as uuid } from "uuid";
import { getBoard } from "./Boards";

export async function getLists(board: Board): Promise<List[] | null> {
	if (!board) {
		return null;
	}

	const lists = await db("lists")
		.select("*")
		.where("board_id", board.id);
	
	if (!lists) {
		return null;
	}

	return lists;
}

export async function getList(id: number | string): Promise<List | null> {
	if (typeof id == "undefined") {
		return null;
	}

	let list: List | undefined;
	if (typeof id == "string") {
		list = await db
			.select<List>("*")
			.from("lists")
			.where("uid", id)
			.first();
	} else if (typeof id == "number") {
		list = await db.select<List>("*").from("lists").where("id", id).first();
	} else {
		return null;
	}

	if (!list) {
		return null;
	}

	return list;
}

export async function createList(
	name: string,
	board_id: string
): Promise<{
	uid: string;
	id: number;
} | false> {
	if (!name || name.length < 2) {
		return false;
	}

	const board = await getBoard(board_id);

	if (!board) {
		return false;
	}

	const uid = uuid();

	const result = await db("lists").insert(
		{
			name,
			uid,
			board_id: board.id
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
