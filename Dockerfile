FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml* ./

RUN pnpm install --frozen-lockfile

COPY prisma ./prisma/
RUN pnpm prisma generate

COPY . .

EXPOSE 5000

CMD ["sh", "-c", "pnpm prisma generate && pnpm prisma db push && pnpm run dev"]
