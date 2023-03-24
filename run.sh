clear_docker() {
	docker-compose down
}

start_docker() {
	docker-compose up
}

start_dev_server() {
	cd ./app
	pnpm run dev
}

clear_docker;
start_docker & start_dev_server;