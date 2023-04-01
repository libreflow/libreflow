export interface Workspace {
	name: string;
	members: User[];
	id?: number;
	boards: Board[]
	uid: string;
}

export interface User {
	name: string;
	email: string;
}

export interface Board {
	name: string;
	description: string;
	lists: List[];
	id?: number;
	uid: string;
}

export interface List {
	id?: number;
	cards: Card[];
	name: string;
	routines: Routine[];
	board_id: string;
	uid: string;
}

export interface Routine {

}

export interface Card {
	title: string;
	description: string;
	tags: Tag[];
	additional: Additional[];
	id: number;
	uid: string;
}


export interface Tag {
	color: string;
	name: string;
	uid: string;
}

export interface Additional {
	type: string;
	value: any;
	title: string;
}