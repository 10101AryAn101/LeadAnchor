import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/** Where the LeadAnchor API runs. Server-side only — the browser always talks to /api on this origin. */
const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/**
 * This computer's addresses on the local network. `next dev` listens on all of them, so a
 * teammate or a phone on the same Wi-Fi can open http://<address>:3000, but Next.js only
 * serves its dev scripts and live reload to hosts listed in allowedDevOrigins.
 */
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .flatMap((net) => (net && net.family === "IPv4" && !net.internal ? [net.address] : []));

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses,
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Same-origin API: the browser calls /api/*, Next.js forwards it to the API server,
  // so session cookies stay first-party and no API address or key ever reaches the client bundle.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
