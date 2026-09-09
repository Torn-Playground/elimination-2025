FROM oven/bun:1.2

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY drizzle.config.ts ./
COPY migrations ./migrations
COPY src ./src
COPY web ./web

CMD ["bun", "src/index.ts"]
