# syntax=docker/dockerfile:1
FROM node:23

WORKDIR /usr/src/app

# Copiar package.json y package-lock.json para aprovechar la cache de capas
COPY package*.json ./

# Instalar dependencias de producción
RUN npm install --omit=dev

# Copiar el resto del código de la app
COPY . .

# Exponer el puerto donde la app escucha
EXPOSE 8080

# Comando de inicio
CMD ["node", "index.js"]
