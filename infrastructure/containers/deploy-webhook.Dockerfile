FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-compose git bash \
 && git config --global --add safe.directory /deploy

WORKDIR /app
COPY deploy-webhook.mjs ./

CMD ["node", "deploy-webhook.mjs"]
