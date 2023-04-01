import type { APIRoute } from "astro";
import { createCard } from "../../lib/Cards";
import { error, success } from "../../lib/Response";
import { db } from "../../lib/Shared";

export const get: APIRoute = async ({ params, request }) => {
	let body = await request.json();
	if (!body.id) {
		return error(["Missing required parameter 'id'."]);
	}

	const card = await db("cards").select("*").where("id", body.id);

	return success(card);
};

export const post: APIRoute = async ({ params, request }) => {
	let body = await request.json();
	if (!body.title || !body.id) {
		return error(["Missing required parameter 'title' or 'id'."]);
	}

	await db("cards")
		.update(
			{
				title: body.title,
				description: body.description
			},
		).where("id", body.id);

	return success({ });
};

export const put: APIRoute = async ({ params, request }) => {
	let body = await request.json();
	if (!body.title || !body.list_uid) {
		return error(["Missing required parameter 'title' or 'list_uid'."]);
	}

	const result = await createCard(body.title, body.description, [], body.additional, body.list_uid);

	if (!result) {
		return error(["Unable to create card."])
	}

	return success(result);
};

export const del: APIRoute = async ({ params, request }) => {
	let body = await request.json();
	if (!body.id) {
		return error(["Missing required parameter 'id'."]);
	}

	await db("cards").where("id", body.id).delete();

	return success({});
};
