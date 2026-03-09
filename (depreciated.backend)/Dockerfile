FROM oven/bun:1-alpine

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy application code
COPY . .

# Build the application
RUN bun run build || echo "Build step skipped in development"

# Expose the API port used by the app
EXPOSE 5000

# Start the application
CMD ["bun", "run", "dev"]
