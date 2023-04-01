import type { APIRoute } from "astro";
import { createList } from "../../lib/Lists";
import { error, success } from "../../lib/Response";
import { db } from "../../lib/Shared";

export const get: APIRoute = ({ params, request }) => {
	console.log(db.select("*").from("workspaces"));
};

export const post: APIRoute = ({ params, request }) => {};

export const put: APIRoute = async ({ params, request }) => {
	let body = await request.json();
	if (!body.name || !body.board_id) {
		return error(["Missing required parameter 'name' or 'board_id'."]);
	}

	const result = await createList(body.name, body.board_id);

	if (!result) {
		return error(["Unable to create list."])
	}

	return success(result);
};

export const del: APIRoute = async ({ params, request }) => {
	let body = await request.json();
	if (!body.id) {
		return error(["Missing required parameter 'id'."]);
	}

	await db.from("lists").where("id", body.id).delete();

	return success({});
};
