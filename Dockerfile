FROM mcr.microsoft.com/mssql/server:2017-latest
ENV ACCEPT_EULA=Y
ENV SA_PASSWORD=abcDEF123#
ENV MSSQL_PID=Developer
ENV MSSQL_TCP_PORT=1433
RUN /opt/mssql/bin/sqlservr --accept-eula
