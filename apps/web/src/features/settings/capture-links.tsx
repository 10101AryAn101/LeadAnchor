"use client";

import type { SettingsResponse } from "@leadanchor/contracts";
import { type Icon, IconBrandGoogle, IconCode, IconCopy, IconExternalLink, IconLink } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

/**
 * C-10: catch the people who'd never call. One request form, three ways in: the
 * Google profile's booking link, a button on the owner's website and a link to share.
 */
export function CaptureLinks({ settings }: { settings: SettingsResponse }) {
  const url = new URL(settings.requestUrl);
  const slug = url.pathname.split("/").pop() ?? "";
  const snippet = `<script src="${url.origin}/widget.js" data-business="${slug}" async></script>`;

  return (
    <div className="space-y-3">
      <CopyRow
        icon={IconBrandGoogle}
        title="Your Google profile"
        body="In Google, open your Business Profile, choose Edit profile, then Contact, and paste this as your appointment link. Requests from it are marked Google."
        value={`${settings.requestUrl}?src=google`}
        copied="Google link copied."
      />
      <CopyRow
        icon={IconCode}
        title="A button on your website"
        body="Paste this line just before </body>, or in your website builder's custom code box. It adds a Book / Chat button that opens your request form."
        value={snippet}
        copied="Website code copied."
        code
        preview={`/widget-demo.html?business=${encodeURIComponent(slug)}`}
      />
      <CopyRow
        icon={IconLink}
        title="A link to share"
        body="For social media, email signatures and ads."
        value={settings.requestUrl}
        copied="Link copied."
        preview={settings.requestUrl.replace(url.origin, "")}
      />
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
