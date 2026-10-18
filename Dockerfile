# Adwarp MCP server on stdio, for MCP clients and directories that run servers in Docker.
# The build stage packs the same npm package that `npx adwarp` installs, and the runtime
# stage installs that tarball, so the image runs exactly what npm ships.
#
#   docker build -t adwarp .
#   docker run -i --rm -v ~/.liads:/home/node/.liads adwarp
#
# Credentials come from a mounted ~/.liads (after `adwarp auth login` on the host) or from
# LIADS_CLIENT_ID, LIADS_CLIENT_SECRET, LIADS_REFRESH_TOKEN and LIADS_DEFAULT_ACCOUNT_ID.
# Without them the server still starts and lists its tools.

FROM node:22-slim AS build
RUN npm install -g pnpm@10
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "adwarp..." \
  && pnpm --filter "adwarp..." build \
  && cd packages/adwarp && pnpm pack --pack-destination /out

FROM node:22-slim
LABEL io.modelcontextprotocol.server.name="io.github.adwarp-dev/adwarp"
COPY --from=build /out/ /tmp/adwarp/
RUN npm install -g --no-audit --no-fund /tmp/adwarp/*.tgz \
  && rm -rf /tmp/adwarp \
  && npm cache clean --force
USER node
WORKDIR /home/node
ENTRYPOINT ["adwarp-mcp"]
