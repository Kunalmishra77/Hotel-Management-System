# Woodpecker PMS — production image.
# Serves the Next.js web app (default CMD). The SAME image also runs the
# pg-boss worker — deploy a second Coolify resource from this repo and override
# the start command to:  npm run worker
#
# Debian slim (not alpine) so Prisma's query engine + openssl work out of the box.

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

# ---- build stage: install all deps, generate Prisma client, build Next ----
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Placeholder DB URLs so `prisma generate` / `next build` never need a live DB
# at build time (all data-reading pages are dynamic). Real values come from
# Coolify env vars at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV DIRECT_URL="postgresql://build:build@localhost:5432/build?schema=public"
RUN npx prisma generate && npm run build

# ---- runtime stage ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
# Web app. Override to `npm run worker` for the background-jobs service.
CMD ["npm", "run", "start"]
