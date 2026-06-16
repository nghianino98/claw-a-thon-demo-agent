import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],

  // Explicitly set the tracing root to current directory
  // to avoid confusion with package-lock.json in home folder
  outputFileTracingRoot: process.cwd(),

  // Ignore the logs directory from the file watcher to prevent infinite reloading loops
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
