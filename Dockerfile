FROM node:22-alpine

# Install pnpm. The lockfile is pnpm v9; avoid pnpm@latest changing Docker install behavior.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Create non-root user early
RUN addgroup -g 1001 -S nodejs
RUN adduser -S uvapp -u 1001

# Create and own the app directory
RUN mkdir -p /app/data && chown -R uvapp:nodejs /app
WORKDIR /app

# Switch to non-root user
USER uvapp

# Copy package files with correct ownership
COPY --chown=uvapp:nodejs package.json pnpm-lock.yaml .npmrc ./

# Install all dependencies (needed for build)
RUN pnpm install --frozen-lockfile

# Copy application code with correct ownership
COPY --chown=uvapp:nodejs . .

# Build the TypeScript application
RUN pnpm run build

# Set production environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/weather').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the application
CMD ["pnpm", "start"]
