FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache ffmpeg python3 make g++ freetype fontconfig ttf-dejavu font-noto font-liberation ttf-freefont && fc-cache -f
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p uploads data
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
