import type { APIRoute } from "astro";
import { dbOpen } from "../../lib/Database";
import { error, success } from "../../lib/Response";
import { db } from "../../lib/Shared";
import { createWorkspace } from "../../lib/Workspaces";

export const get: APIRoute = ({params, request}) => {
	console.log(db.select("*").from("workspaces"));
}

export const post: APIRoute = ({params, request}) => {
	
}

export const put: APIRoute = async ({params, request}) => {
	let body = await request.json();
	if (!body.name) {
		// TODO Return error Message
		return error(["Missing required parameter 'name'."])
	}

	const result = createWorkspace(body.name);

	if (!result) {
		return error(["Unable to create workspace."])
	}

	return success(result)
}

export const del: APIRoute = async ({params, request}) => {
	let body = await request.json();
	if (!body.id) {
		// TODO Return error Message
		return error(["Missing required parameter 'id'."])
	}

	await db.from("workspaces").where("id", body.id).delete();

	return success({})
}