# Minimal DeepSeek beautify proxy — zero dependencies, just the runtime.
FROM node:24-alpine
WORKDIR /app
COPY server.mjs package.json ./
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.mjs"]
