FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

RUN npm install -g pnpm

COPY package*.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY prisma ./prisma/
RUN pnpm prisma generate

COPY . .

EXPOSE 5000

CMD ["sh", "-c", "pnpm prisma generate && pnpm prisma db push && pnpm run dev"]
