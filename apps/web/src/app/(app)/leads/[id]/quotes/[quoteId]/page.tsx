import type { Metadata } from "next";
import { Suspense } from "react";
import { QuoteEditorView } from "@/features/quotes/quote-editor";

export const metadata: Metadata = { title: "Quote" };

export default function QuotePage() {
  return (
    <Suspense>
      <QuoteEditorView />
    </Suspense>
  );
}
