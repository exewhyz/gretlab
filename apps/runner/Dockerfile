# Build from the repo root: docker build -f apps/runner/Dockerfile .
# Also runs database migrations, since it already has the tooling.
FROM node:22-bookworm-slim
RUN corepack enable
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "runner..."
ENV NODE_ENV=production
WORKDIR /repo/apps/runner
CMD ["node_modules/.bin/tsx", "src/main.ts"]
