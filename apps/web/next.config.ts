import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@fsm/engine", "@fsm/export-engine"],
};

export default nextConfig;
