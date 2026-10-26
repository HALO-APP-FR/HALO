import {
  BedDouble,
  Building2,
  CalendarRange,
  House,
  ListChecks,
  Settings,
  UserRound,
  Users,
  CalendarClock,
  Siren,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  key: string; // clé de traduction dans "nav"
  href: string;
  icon: LucideIcon;
}

export const managerNav: NavItem[] = [
  { key: "today", href: "/today", icon: House },
  { key: "planning", href: "/planning", icon: CalendarRange },
  { key: "tasks", href: "/tasks", icon: ListChecks },
  { key: "alerts", href: "/alerts", icon: Siren },
  { key: "properties", href: "/properties", icon: Building2 },
  { key: "linen", href: "/linen", icon: BedDouble },
  { key: "team", href: "/team", icon: Users },
  { key: "settings", href: "/settings", icon: Settings },
];

/** Onglets visibles dans la barre du bas sur mobile (le reste est dans « Plus »). */
export const managerMobileTabs = ["today", "planning", "tasks", "alerts"];

export const agentNav: NavItem[] = [
  { key: "today", href: "/a/today", icon: House },
  { key: "upcoming", href: "/a/upcoming", icon: CalendarClock },
  { key: "profile", href: "/a/profile", icon: UserRound },
];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
