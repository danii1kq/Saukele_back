FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma.config.ts ./

RUN npm install

COPY . .

# Generate Prisma client
RUN npx prisma generate

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]