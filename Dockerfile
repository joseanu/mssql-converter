# syntax=docker/dockerfile:1
FROM node:16

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
