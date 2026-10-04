FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_BASE_URL
ARG VITE_WS_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_WS_BASE_URL=$VITE_WS_BASE_URL
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN test -n "$VITE_API_BASE_URL" && test -n "$VITE_WS_BASE_URL"
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve@14.2.4
COPY --from=build /app/dist ./dist
COPY serve.json ./serve.json
EXPOSE 80
CMD ["serve", "-s", "dist", "-l", "80"]
