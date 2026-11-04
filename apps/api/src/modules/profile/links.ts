import { linkBaseUrl } from "../../config/env";

/** The business's public profile page (C-41), which AI assistants read too (C-42). */
export const profileUrl = (slug: string) => `${linkBaseUrl}/p/${slug}`;

/** C-33: the business's one-page website, live while it has the website add-on. */
export const siteUrl = (slug: string) => `${linkBaseUrl}/s/${slug}`;

/** The website add-on is paid for (a retry pending still counts). */
export const websiteLive = (tenant: { websiteStatus: string }) => tenant.websiteStatus === "active" || tenant.websiteStatus === "past_due";
