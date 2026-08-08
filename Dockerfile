FROM node:20-alpine

ARG CACHE_BUST=1
ENV BUILD_STAMP=${CACHE_BUST}

WORKDIR /app

COPY package.json package-lock.json ./
# Fail the build early if package.json is missing/empty/corrupt (prevents crash-loop deploys).
RUN test -s package.json \
  && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')" \
  && npm ci --omit=dev

COPY . .
RUN test -s package.json \
  && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" \
  && echo "build=${CACHE_BUST}" > /tmp/build-stamp.txt

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
