import {
  type Icon,
  IconFlask,
  IconHome,
  IconHomeFilled,
  IconLayoutKanban,
  IconLayoutKanbanFilled,
  IconMail,
  IconMessages,
  IconPhone,
  IconPhoneFilled,
  IconPlug,
  IconSettings,
  IconSettingsFilled,
  IconShieldCheck,
  IconStar,
  IconUsers,
} from "@tabler/icons-react";

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  /** Filled variant shown for the active tab. */
  activeIcon?: Icon;
  badge?: "dev";
}

/** The five destinations of the phone tab bar and the desktop sidebar (brief §4.1). */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: IconHome, activeIcon: IconHomeFilled },
  { href: "/leads", label: "Leads", icon: IconLayoutKanban, activeIcon: IconLayoutKanbanFilled },
  { href: "/customers", label: "Customers", icon: IconUsers },
  { href: "/calls", label: "Calls", icon: IconPhone, activeIcon: IconPhoneFilled },
  { href: "/settings", label: "Settings", icon: IconSettings, activeIcon: IconSettingsFilled },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/chats", label: "Chats", icon: IconMessages },
  { href: "/reviews", label: "Reviews", icon: IconStar },
  { href: "/compliance", label: "Texting and consent", icon: IconShieldCheck },
  { href: "/integrations", label: "Integrations", icon: IconPlug },
  { href: "/simulator", label: "Call simulator", icon: IconFlask, badge: "dev" },
  { href: "/outbox", label: "Email outbox", icon: IconMail, badge: "dev" },
];
