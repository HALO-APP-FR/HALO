import {
  BedDouble,
  Building2,
  CalendarRange,
  House,
  ListChecks,
  Settings,
  UserRound,
  Users,
  CalendarDays,
  ConciergeBell,
  Siren,
  KeyRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  key: string; // clé de traduction dans "nav"
  href: string;
  icon: LucideIcon;
}

export const managerNav: NavItem[] = [
  { key: "today", href: "/today", icon: House },
  { key: "arrivals", href: "/arrivals", icon: KeyRound },
  { key: "planning", href: "/planning", icon: CalendarRange },
  { key: "tasks", href: "/tasks", icon: ListChecks },
  { key: "alerts", href: "/alerts", icon: Siren },
  { key: "services", href: "/services", icon: ConciergeBell },
  { key: "properties", href: "/properties", icon: Building2 },
  { key: "linen", href: "/linen", icon: BedDouble },
  { key: "team", href: "/team", icon: Users },
  { key: "settings", href: "/settings", icon: Settings },
];

/** Onglets visibles dans la barre du bas sur mobile (le reste est dans « Plus »). */
export const managerMobileTabs = ["today", "planning", "tasks", "alerts"];

export const agentNav: NavItem[] = [
  { key: "today", href: "/a/today", icon: House },
  { key: "calendar", href: "/a/upcoming", icon: CalendarDays },
  { key: "profile", href: "/a/profile", icon: UserRound },
];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
