"use client";

import type { SettingsResponse } from "@leadanchor/contracts";
import { type Icon, IconBrandGoogle, IconCode, IconCopy, IconExternalLink, IconLink } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { useBookingSettings } from "@/lib/queries";

/**
 * C-10: catch the people who'd never call. One page, three ways in: the Google profile's
 * booking link, a button on the owner's website and a link to share. With online booking
 * on (C-18) they lead to the booking page, which links to the request form for the rest.
 */
export function CaptureLinks({ settings }: { settings: SettingsResponse }) {
  const { data: booking } = useBookingSettings();
  const booksOnline = booking?.settings.enabled === true;
  const link = booksOnline ? booking.bookingUrl : settings.requestUrl;
  const url = new URL(link);
  const slug = url.pathname.split("/").pop() ?? "";
  const snippet = `<script src="${url.origin}/widget.js" data-business="${slug}"${booksOnline ? ' data-action="book"' : ""} async></script>`;

  return (
    <div className="space-y-3">
      <CopyRow
        icon={IconBrandGoogle}
        title="Your Google profile"
        body={`In Google, open your Business Profile, choose Edit profile, then Contact, and paste this as your appointment link. ${booksOnline ? "Bookings" : "Requests"} from it are marked Google.`}
        value={`${link}?src=google`}
        copied="Google link copied."
      />
      <CopyRow
        icon={IconCode}
        title="A button on your website"
        body={`Paste this line just before </body>, or in your website builder's custom code box. It adds ${booksOnline ? "a Book online button that opens your booking page" : "a Book / Chat button that opens your request form"}.`}
        value={snippet}
        copied="Website code copied."
        code
        preview={`/widget-demo.html?business=${encodeURIComponent(slug)}${booksOnline ? "&action=book" : ""}`}
      />
      <CopyRow
        icon={IconLink}
        title="A link to share"
        body="For social media, email signatures and ads."
        value={link}
        copied="Link copied."
        preview={link.replace(url.origin, "")}
      />
      {booksOnline && <p className="text-sm text-muted-foreground">Online booking is on, so these lead to your booking page. Jobs that need a look first can still send a request from it.</p>}
    </div>
  );
}

function CopyRow({
  icon: RowIcon,
  title,
  body,
  value,
  copied,
  code = false,
  preview,
}: {
  icon: Icon;
  title: string;
  body: string;
  value: string;
  copied: string;
  code?: boolean;
  preview?: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <RowIcon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="text-[15px] text-muted-foreground">{body}</p>
        </div>
      </div>
      <p className={code ? "rounded-md bg-muted p-3 font-mono text-[13px] leading-5 break-all" : "rounded-md bg-muted px-3 py-2.5 text-[15px] break-all"}>{value}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={async () => ((await copyText(value)) ? toast.success(copied) : toast.error("Couldn't copy. Select the text and copy it instead."))}
        >
          <IconCopy /> Copy
        </Button>
        {preview && (
          <Button type="button" variant="ghost" nativeButton={false} render={<a href={preview} target="_blank" rel="noreferrer" />}>
            <IconExternalLink /> Preview
          </Button>
        )}
      </div>
    </div>
  );
}
