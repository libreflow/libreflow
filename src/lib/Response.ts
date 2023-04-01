export function error(errorList: string[]) {
	return new Response(JSON.stringify({
		success: false,
		errors: errorList
	}))
}

export function success(data: any) {
	return new Response(JSON.stringify({
		success: true,
		data: data
	}))
}