FROM node:26-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
RUN apk add --no-cache --virtual .build-deps rsvg-convert ttf-dejavu && \
    rsvg-convert -w 1200 -h 630 src/static/og-image.svg -o src/static/og-image.png && \
    apk del .build-deps
EXPOSE 8080
CMD ["node", "src/server.js"]
