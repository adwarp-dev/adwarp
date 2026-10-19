# Adwarp MCP server on stdio, for MCP clients and directories that run servers in Docker.
# The build stage packs the same npm package that `npx adwarp` installs, and the runtime
# stage installs that tarball, so the image runs exactly what npm ships.
#
#   docker build -t adwarp .
#   docker run -i --rm -v ~/.adwarp:/home/node/.adwarp adwarp
#
# Credentials come from a mounted ~/.adwarp (after `adwarp auth login` on the host) or from
# ADWARP_LINKEDIN_CLIENT_ID, ADWARP_LINKEDIN_CLIENT_SECRET, ADWARP_LINKEDIN_REFRESH_TOKEN and
# ADWARP_LINKEDIN_DEFAULT_ACCOUNT_ID. A ~/.liads folder or LIADS_* names from before the rename
# work too.
# Without them the server still starts and lists its tools.

FROM node:22-slim AS build
RUN npm install -g pnpm@10
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "adwarp..." \
  && pnpm --filter "adwarp..." build \
  && cd packages/adwarp && pnpm pack --pack-destination /out

FROM node:22-slim
LABEL io.modelcontextprotocol.server.name="io.github.adwarp-dev/adwarp" \
  org.opencontainers.image.title="Adwarp" \
  org.opencontainers.image.url="https://adwarp.dev" \
  org.opencontainers.image.documentation="https://adwarp.dev/docs/install#run-it-in-docker" \
  org.opencontainers.image.source="https://github.com/adwarp-dev/adwarp" \
  org.opencontainers.image.licenses="MIT"
COPY --from=build /out/ /tmp/adwarp/
RUN npm install -g --no-audit --no-fund /tmp/adwarp/*.tgz \
  && rm -rf /tmp/adwarp \
  && npm cache clean --force
USER node
WORKDIR /home/node
ENTRYPOINT ["adwarp-mcp"]
