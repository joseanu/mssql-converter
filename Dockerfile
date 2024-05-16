# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/azure-sql-edge:latest

USER root

RUN apt-get update && apt-get install -y curl build-essential python3 make g++

RUN curl -sL https://deb.nodesource.com/setup_16.x | bash - \
 && apt-get update \
 && apt-get install -y nodejs unixodbc-dev \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV production

WORKDIR /usr/src/app

COPY . .

RUN npm install --omit=dev

EXPOSE 8080

CMD /opt/mssql/bin/sqlservr & node index.js
