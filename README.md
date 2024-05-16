# Cargador de archivos SQL Server

Este proyecto es una aplicación Node.js Express que recibe archivos .bak y realiza una serie de operaciones. Utiliza el middleware multer para manejar el proceso de carga de archivos. Se conecta al servidor SQL, restaura el archivo .bak a una base de datos temporal, extrae datos de una tabla en particular de la base de datos y devuelve los datos en respuesta al cliente.

## Cómo funciona

Tan pronto como el servidor recibe un archivo, valida el archivo para asegurar que es un archivo .bak. Utiliza el motor diskStorage de multer para guardar el archivo en el directorio `uploads` temporalmente, siendo el nombre del archivo el timestamp de la carga.

El archivo se restaura luego a una base de datos de SQL Server, el nombre de la base de datos es "DB_" concatenado con el nombre del archivo sin extensión. Después de eso, la aplicación envía una consulta a la base de datos para extraer datos y enviarlos de vuelta en la respuesta al cliente. Después de enviar la respuesta, la base de datos temporal se elimina. Por último, el archivo .bak en el directorio `uploads` también se borra.

Este servidor se ejecuta utilizando Docker, alojando un servidor SQL Edge junto con él.

## Configuración del proyecto

Asegúrese de tener Docker instalado en su computadora antes de continuar con los siguientes pasos.

1. Construya la imagen Docker con el comando: `docker build -t mssql-converter .`
2. Inicie el contenedor Docker con el comando: `docker run -p 8080:8080 -e "MSSQL_SA_PASSWORD=<YourStrong!Passw0rd>" sql-file-uploader`
	- Reemplace `<YourStrong!Passw0rd>` con la contraseña de la base de datos que prefiera.

El servidor Express se ejecutará en `http://localhost:8080`.

## Endpoints

- GET `/`: Un endpoint sencillo que devuelve un mensaje "¡Hola Mundo!".
- POST `/bak`: Un endpoint de carga de archivos que recibe un archivo .bak, lo restaura a una base de datos del servidor SQL temporal, extrae datos de una tabla específica y devuelve esos datos al cliente, luego elimina la base de datos temporal y el archivo en el servidor.
  - Este endpoint espera un cuerpo de solicitud `multipart/form-data`, con el archivo adjunto en un campo `bak`.
- GET `/upload-form`: Un endpoint que devuelve un formulario HTML que los visitantes pueden usar para cargar un archivo. Envía el archivo al endpoint `/bak`.


# Workaround to disable mssql telemetry
echo "127.0.0.1 settings-win.data.microsoft.com" >> /etc/hosts
echo "127.0.0.1 vortex.data.microsoft.com" >> /etc/hosts