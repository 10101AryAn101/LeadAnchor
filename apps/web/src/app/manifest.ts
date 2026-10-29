import type { MetadataRoute } from "next";

/** Installable PWA (spec: responsive web first; native apps are a later decision). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LeadAnchor",
    short_name: "LeadAnchor",
    description: "Catch every missed call and turn it into a booked job.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#fbfaf7",
    theme_color: "#155e63",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
