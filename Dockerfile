# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/azure-sql-edge:latest

USER root

RUN apt-get update \
 && </dev/null DEBIAN_FRONTEND=noninteractive \
    apt-get --yes install curl

RUN curl -sL https://deb.nodesource.com/setup_16.x | bash - \
 && apt-get update \
 && </dev/null DEBIAN_FRONTEND=noninteractive \
    apt-get install -y nodejs unixodbc-dev \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV production

WORKDIR /usr/src/app

COPY . .

RUN npm install

EXPOSE 8080

CMD /opt/mssql/bin/sqlservr & node index.js

# docker run -e "ACCEPT_EULA=Y" -e "MSSQL_PID=Express" -e "SA_PASSWORD=Password0:" -p 1433:1433 -p 8080:8080 mssql-converter
# docker run -e "ACCEPT_EULA=Y" -e "MSSQL_PID=Express" -e "MSSQL_SA_PASSWORD=PicaPapas!" -p 1433:1433 -p 8080:8080 mssql-converter