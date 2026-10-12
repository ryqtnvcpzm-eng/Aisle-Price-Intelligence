import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Docker images use the standalone server; Vercel and similar hosts build normally.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  // The PDF renderer reads bundled fonts from disk at runtime.
  outputFileTracingIncludes: { "/api/reports/export": ["./assets/fonts/**"] },
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  // Server-only packages that ship data files or native bindings.
  serverExternalPackages: ["pdfkit", "exceljs", "bullmq", "ioredis", "pino"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "m.media-amazon.com" },
      { protocol: "https", hostname: "images-na.ssl-images-amazon.com" },
      { protocol: "https", hostname: "images-eu.ssl-images-amazon.com" },
      { protocol: "https", hostname: "images-fe.ssl-images-amazon.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
