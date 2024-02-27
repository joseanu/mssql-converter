# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/azure-sql-edge:latest

# Switch to root user for access to apt-get install
USER root

# Install curl zip nodejs, and add the mssql-tools repository
RUN apt-get -y update && \
    apt-get install -y npm unixodbc unixodbc-dev

# Use production node environment by default.
ENV NODE_ENV production

# Leverage a cache mount to /root/.npm to speed up subsequent builds.
# Leverage a bind mounts to package.json and package-lock.json to avoid having to copy them into into this layer.
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

USER mssql

WORKDIR /usr/src/app

# Copy the rest of the source files into the image.
COPY . .

# Expose the port that the application listens on.
EXPOSE 8080

# Run the application.
CMD /opt/mssql/bin/sqlservr & node index.js

# docker run -e "ACCEPT_EULA=Y" -e "MSSQL_PID=Express" -e "SA_PASSWORD=Password0:" -p 1433:1433 -p 8080:8080 mssql-converter
