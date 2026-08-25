# Multi-stage build (Phase 4 of the migration plan): stage 1 builds the
# React/Vite frontend, stage 2 is the actual production image - Python only,
# no Node.js at runtime, just the built static files baked in. Build context
# is the REPO ROOT (see docker-compose.yml's `context: .`), not backend/,
# since this needs to see both backend/ and frontend/.

FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS backend
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
# Lands at /app/frontend/dist, nested under main.py's own WORKDIR (unlike
# bare-metal dev, where ../frontend/dist is a sibling one level up from
# backend/) - docker-compose.yml sets MARKETPLACE_FRONTEND_DIR=frontend/dist
# (no ../) to match this container-only layout.
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--proxy-headers"]
