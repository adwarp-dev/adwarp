FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @adwarp/shared build \
 && pnpm --filter @adwarp/core build \
 && pnpm --filter @adwarp/core exec playwright install --with-deps chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
RUN mv /root/.cache/ms-playwright /opt/playwright \
 && chmod -R a+rX /opt/playwright \
 && mkdir -p /data/screenshots && chown -R node:node /data
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
ENV ADWARP_CREATIVE_WORKER=1
ENV WORKER_DATA_DIR=/data
USER node
EXPOSE 8080
CMD ["node", "services/creative-worker/main.mjs"]
