FROM node:22-alpine AS build
WORKDIR /app

# Build args are optional overrides. Local container builds read values from
# .env.production; AWS CI builds the static bundle directly and supplies public
# URLs through scripts/generate_env.py. Both keys are required to avoid shipping
# a bundle with blank VITE_* values.
ARG VITE_API_BASE_URL
ARG VITE_WS_BASE_URL

COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

RUN set -eu; \
    override_api="${VITE_API_BASE_URL:-}"; \
    override_ws="${VITE_WS_BASE_URL:-}"; \
    if [ -f .env.production ]; then \
      set -a; \
      . ./.env.production; \
      set +a; \
    fi; \
    if [ -n "$override_api" ]; then export VITE_API_BASE_URL="$override_api"; fi; \
    if [ -n "$override_ws" ]; then export VITE_WS_BASE_URL="$override_ws"; fi; \
    if [ -z "${VITE_API_BASE_URL:-}" ]; then \
      echo "error: VITE_API_BASE_URL is not set. Supply it as a build arg or via .env.production." >&2; \
      exit 1; \
    fi; \
    if [ -z "${VITE_WS_BASE_URL:-}" ]; then \
      echo "error: VITE_WS_BASE_URL is not set. Supply it as a build arg or via .env.production." >&2; \
      exit 1; \
    fi; \
    echo "Building frontend against API ${VITE_API_BASE_URL}"; \
    npm run build

FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve@14.2.4
COPY --from=build /app/dist ./dist
COPY serve.json ./serve.json
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://localhost/"]
CMD ["serve", "-s", "dist", "-l", "80"]
