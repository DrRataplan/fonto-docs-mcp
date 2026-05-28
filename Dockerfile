FROM node:20-alpine
WORKDIR /app
COPY package.json .
COPY src/ ./src/
EXPOSE 8080
CMD ["node", "src/server.js"]
