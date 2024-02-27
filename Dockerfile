# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/azure-sql-edge:latest

USER root

RUN apt-get -y update && \
    apt-get install -y npm unixodbc-dev

USER mssql

ENV NODE_ENV production

WORKDIR /usr/src/app

COPY . .

RUN npm install

EXPOSE 8080

CMD /opt/mssql/bin/sqlservr & node index.js

# docker run -e "ACCEPT_EULA=Y" -e "MSSQL_PID=Express" -e "SA_PASSWORD=Password0:" -p 1433:1433 -p 8080:8080 mssql-converter
