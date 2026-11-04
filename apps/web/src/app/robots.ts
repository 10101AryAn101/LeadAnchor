import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/** Search engines and AI assistants may read the public business pages and websites (C-42, C-33); the app stays private. */
const READERS = [
  "*",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Google-Extended",
  "ClaudeBot",
  "Applebot-Extended",
  "Bingbot",
  "Googlebot",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "localhost:3000";
  const origin = `${host.startsWith("localhost") || /^\d/.test(host) ? "http" : "https"}://${host}`;
  return {
    // "/$" is the marketing page itself (the end anchor keeps the rest of the app out).
    rules: READERS.map((userAgent) => ({
      userAgent,
      allow: ["/$", "/p/", "/s/", "/privacy", "/terms"],
      disallow: ["/"],
    })),
    sitemap: `${origin}/sitemap.xml`,
  };
}
