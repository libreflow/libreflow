import type { Additional, Card, List, Tag } from "../types";
import { getList } from "./Lists";
import { db } from "./Shared";
import { v4 as uuid } from "uuid";

export async function getCards(list: List): Promise<Card[] | null> {
	if (!list) {
		return null;
	}

	const cards = await db
		.leftJoin("link_cards_tags", "link_cards_tags.card_id", "cards.id")
		.leftJoin("tags", "tags.id", "link_cards_tags.tag_id")
		.select([
			"cards.*",
			db.raw("array_agg(json_build_object('name', tags.name, 'color', tags.color)) as tags")
		])
		.from("cards")
		.where("cards.list_id", list.id)
		.groupBy("cards.id");
	
	if (!cards) {
		return null;
	}

	return cards;
}

export async function createCard(
	title: string,
	description: string,
	tags: Tag[],
	additional: Additional[],
	list_uid: string
): Promise<{
	uid: string;
	id: number;
} | false> {
	if (!title || title.length < 2) {
		return false;
	}

	const list = await getList(list_uid);

	if (!list) {
		return false;
	}

	const uid = uuid();

	const result = await db("cards").insert(
		{
			title,
			description,
			uid,
			additional,
			list_id: list.id
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
