# One image for both processes: `web` (default CMD) and `worker` (`pnpm worker`).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Build-time placeholders only; real values come from the runtime environment.
ENV BETTER_AUTH_SECRET=build-time-placeholder-secret-not-used BETTER_AUTH_URL=http://localhost:3000 NODE_ENV=production
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build /app /app
EXPOSE 3000
# Apply migrations, then serve. The worker service overrides CMD with `pnpm worker`.
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
