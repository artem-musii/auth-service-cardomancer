FROM oven/bun:1 AS install
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1
WORKDIR /app
COPY --from=install /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
CMD ["sh", "-c", "bun run db:migrate && bun run start"]
