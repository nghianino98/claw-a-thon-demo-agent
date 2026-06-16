import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],

  // AgentBase Runtime health check requires GET /health -> 200; Next only has /api/health
  async rewrites() {
    return [{ source: "/health", destination: "/api/health" }];
  },

  // Explicitly set the tracing root to current directory
  // to avoid confusion with package-lock.json in home folder
  outputFileTracingRoot: process.cwd(),

  // Empty turbopack config to allow Turbopack builds (Next.js 16 default)
  turbopack: {},

  // Webpack fallback (kept for --webpack mode compatibility, dev only)
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...(config.watchOptions || {}),
        ignored: [
          ...(Array.isArray(config.watchOptions?.ignored) ? config.watchOptions.ignored : []),
          "**/logs/**",
          "**/data/*.log",
          "**/data/*.json",
          "**/*.tsbuildinfo",
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
