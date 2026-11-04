import type { MetadataRoute } from "next";
import { headers } from "next/headers";

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/**
 * The marketing page, then every live business's public page and website (C-42, C-33). Read at
 * request time, never at build.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host") ?? "localhost:3000";
  const local = host.startsWith("localhost") || /^\d/.test(host);
  const home: MetadataRoute.Sitemap = [
    { url: `${local ? "http" : "https"}://${host}/`, changeFrequency: "monthly", priority: 1 },
  ];
  try {
    const response = await fetch(`${API_URL}/api/public/sitemap-profiles`, { cache: "no-store" });
    if (!response.ok) return home;
    const { profiles } = (await response.json()) as {
      profiles: Array<{ url: string; updatedAt: string }>;
    };
    return [
      ...home,
      ...profiles.map((profile) => ({
        url: profile.url,
        lastModified: profile.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    return home;
  }
}
