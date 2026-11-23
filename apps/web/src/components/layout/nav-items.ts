import {
  type Icon,
  IconChartBar,
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
  IconRepeat,
  IconSettings,
  IconSettingsFilled,
  IconShieldCheck,
  IconSpeakerphone,
  IconStar,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  /** Filled variant shown for the active tab. */
  activeIcon?: Icon;
  badge?: "dev";
  /** Left out of the menus (sidebar, phone menu, Ctrl K); the page itself still opens at its address. */
  hidden?: boolean;
}

/** The five destinations of the phone tab bar and the desktop sidebar (brief §4.1). */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: IconHome, activeIcon: IconHomeFilled },
  { href: "/leads", label: "Leads", icon: IconLayoutKanban, activeIcon: IconLayoutKanbanFilled },
  { href: "/customers", label: "Customers", icon: IconUsers },
  { href: "/calls", label: "Calls", icon: IconPhone, activeIcon: IconPhoneFilled },
  { href: "/settings", label: "Settings", icon: IconSettings, activeIcon: IconSettingsFilled },
];

/** Every business destination, hidden ones included. */
const BUSINESS_NAV: NavItem[] = [
  { href: "/chats", label: "Chats", icon: IconMessages },
  { href: "/reviews", label: "Reviews", icon: IconStar },
  { href: "/reports", label: "Reports", icon: IconChartBar },
  { href: "/campaigns", label: "Campaigns", icon: IconSpeakerphone },
  { href: "/memberships", label: "Memberships", icon: IconRepeat },
  { href: "/network", label: "Trusted pros", icon: IconUsersGroup },
  { href: "/compliance", label: "Texting and consent", icon: IconShieldCheck },
  { href: "/integrations", label: "Integrations", icon: IconPlug },
  { href: "/simulator", label: "Call simulator", icon: IconFlask, badge: "dev" },
  // Hidden while emails really go out through Resend, so the menu doesn't suggest they're simulated.
  // The page still works at /outbox; remove `hidden` to show the link again.
  { href: "/outbox", label: "Email outbox", icon: IconMail, badge: "dev", hidden: true },
];

export const SECONDARY_NAV: NavItem[] = BUSINESS_NAV.filter((item) => !item.hidden);
