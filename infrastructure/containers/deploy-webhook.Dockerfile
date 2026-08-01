FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-compose git bash

WORKDIR /app
COPY deploy-webhook.mjs ./

CMD ["node", "deploy-webhook.mjs"]
