# AGENTS.md - Solar Sentinel Development Guide

**CRITICAL: Use pnpm only** - npm/yarn are blocked by preinstall script

## Commands
- `pnpm test` - Run all tests (Vitest)  
- `pnpm test src/test/api.test.ts` - Run single test file
- `pnpm run build` - Build TypeScript with Vite
- `pnpm run typecheck` - Type checking only  
- `pnpm run format` - Format code with Prettier
- `pnpm run dev` - Development with auto-restart

## Code Style
- **Imports**: Use `.js` extensions for local imports (TS/ES module requirement)
- **Types**: Explicit typing with interfaces in `src/types/`, use `type` imports
- **Formatting**: Prettier config - 2 spaces, single quotes, 100 char width
- **Classes**: Private fields with `private readonly` for constants
- **Error Handling**: Try/catch with typed errors `(error as Error).message`
- **Async**: Use `async/await`, performance timing with `performance.now()`

## Architecture
- ES modules (`"type": "module"`) - use `.js` imports in TS files
- Express backend (server.js), TypeScript frontend (src/)
- Chart.js with fixed dimensions, no animations/responsive mode
- Location-based caching, timezone-aware data processing