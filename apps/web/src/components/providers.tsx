"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type ReactNode, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // "Back between jobs" is the moment to refresh (no pull-to-refresh in installed PWAs).
            refetchOnWindowFocus: true,
            retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          {/* Respect the device's reduced-motion setting for every animation. */}
          <MotionConfig reducedMotion="user">
            <TooltipProvider>
              {children}
              <Toaster position="top-center" closeButton />
            </TooltipProvider>
          </MotionConfig>
        </NuqsAdapter>
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
