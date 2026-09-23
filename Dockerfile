FROM oven/bun:1
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_COMPILE_BYTECODE=1 \
    UV_FROZEN=1 \
    UV_NO_DEV=1 \
    DATASETS_DIR=/app/data/datasets

WORKDIR /app

# Python pipeline venv (managed Python 3.12), synced at build time so runtime needs no network.
COPY pipeline/pyproject.toml pipeline/uv.lock pipeline/
RUN cd pipeline && uv sync --frozen --no-dev --python 3.12

# JS deps (workspaces client, server).
COPY package.json bun.lock ./
COPY client/package.json client/
COPY server/package.json server/
RUN bun install --frozen-lockfile

COPY . .
RUN cd client && bun run build && mkdir -p /app/data/datasets

WORKDIR /app/server
CMD ["bun", "src/index.ts"]
