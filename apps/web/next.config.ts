import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: [
    "@fsm/engine",
    "@fsm/byok-gateway",
    "@fsm/grpc-bridge",
    "@fsm/proto",
  ],
};

export default nextConfig;
