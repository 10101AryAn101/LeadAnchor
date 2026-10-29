import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo, Atkinson_Hyperlegible_Next } from "next/font/google";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

/*
 * Atkinson Hyperlegible Next for all interface text — built to keep 1/l/I, 0/O and B/8
 * apart, which matters for phone numbers and dollar amounts read in a van.
 * Archivo (semi-expanded) for headings and money. Both OFL.
 */
const sans = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-atkinson", display: "swap" });
const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "LeadAnchor", template: "%s · LeadAnchor" },
  description: "Catch every missed call and turn it into a booked job.",
  applicationName: "LeadAnchor",
  appleWebApp: { capable: true, title: "LeadAnchor", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#110f0d" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(sans.variable, display.variable)}>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
