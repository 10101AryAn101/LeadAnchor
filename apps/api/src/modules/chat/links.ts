import { linkBaseUrl } from "../../config/env";
import { channels } from "../../container";

/** The WhatsApp chat link customers tap (C-11): the business's number, with a first line typed for them. */
export const whatsappLinkFor = (businessName: string, businessE164: string | null | undefined) =>
  businessE164 && channels.whatsapp
    ? channels.whatsapp.chatLink(businessE164, `Hi ${businessName}, `)
    : null;

/** The website chat (C-10, C-16): the page the website's Chat button opens. */
export const webChatUrl = (slug: string) => `${linkBaseUrl}/c/${slug}`;
