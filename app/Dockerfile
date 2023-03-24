FROM node:alpine3.16

WORKDIR /app

COPY . .

RUN npm i -g pnpm
RUN pnpm install

CMD pnpm run dev