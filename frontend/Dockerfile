FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Create directories for certbot and SSL
RUN mkdir -p /var/www/certbot /etc/nginx/ssl-conf

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
