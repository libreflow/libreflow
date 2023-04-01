import type { APIRoute } from "astro";
import { createBoard, getBoard } from "../../lib/Boards";
import { dbOpen } from "../../lib/Database";
import { error, success } from "../../lib/Response";
import { db } from "../../lib/Shared";

export const get: APIRoute = async ({ params, request }) => {
	let body = await request.json();
		if (!body.uid) {
			return error(["Missing required parameter 'uid'."]);
		}

		const board = getBoard(body.uid);

		if (!board) {
			return error(["Requested board does not exist."])
		}

		return success(board);
};

export const post: APIRoute = async ({ params, request }) => {
	let body = await request.json();
	if (!body.name || !body.uid) {
		return error(["Missing required parameter 'name' or 'uid'."]);
	}

	await db("boards")
		.update(
			{
				name: body.name,
				description: body.description,
			},
		).where("uid", body.uid);

	return success({ });
};

export const put: APIRoute = async ({ params, request }) => {
	let body = await request.json();
	if (!body.name || !body.workspace_id) {
		return error(["Missing required parameter 'name'."]);
	}

	const id = createBoard(body.name, body.description, body.workspace_id)

	return success({ id });
};

export const del: APIRoute = async ({ params, request }) => {
	let body = await request.json();
	if (!body.uid) {
		return error(["Missing required parameter 'uid'."]);
	}

	await db.from("boards").where("uid", body.uid).delete();

	return success({});
};
