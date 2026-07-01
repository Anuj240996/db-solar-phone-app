FROM node:20-alpine

ARG CACHE_BUST=1
ENV BUILD_STAMP=${CACHE_BUST}

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN echo "build=${CACHE_BUST}" > /tmp/build-stamp.txt

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
