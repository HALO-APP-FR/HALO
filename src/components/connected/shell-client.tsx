"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  BedDouble,
  BellRing,
  Building2,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  CircleUser,
  ConciergeBell,
  Ellipsis,
  FileSpreadsheet,
  House,
  ListChecks,
  LogOut,
  Mail,
  MessagesSquare,
  Settings,
  Settings2,
  Siren,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { signOut } from "@/lib/connected/auth-actions";
import { setActiveOrganization } from "@/lib/connected/actions";
import { cn } from "@/lib/utils";

export type NavLabels = Record<
  | "today" | "planning" | "tasks" | "alerts" | "services" | "properties" | "linen" | "team" | "settings" | "more"
  | "stays" | "messages" | "bookings" | "satisfaction" | "import" | "profile" | "preferences" | "setup" | "notifications" | "account" | "label" | "guestGroup",
  string
>;

type Item = { key: keyof NavLabels; href: string; icon: LucideIcon; also?: string[] };

/**
 * Navigation du responsable, reprise de la démo : neuf entrées dans le même ordre.
 * Chaque entrée ouvre l'écran connecté correspondant ; les adresses existantes ne changent pas
 * (Tâches = /app/missions, Alertes = /app/incidents…), les liens des e-mails restent valides.
 */
export const MANAGER_NAV: Item[] = [
  { key: "today", href: "/app", icon: House },
  { key: "planning", href: "/app/planning", icon: CalendarRange },
  { key: "tasks", href: "/app/missions", icon: ListChecks },
  { key: "alerts", href: "/app/incidents", icon: Siren },
  { key: "services", href: "/app/services", icon: ConciergeBell },
  { key: "properties", href: "/app/properties", icon: Building2, also: ["/app/import"] },
  { key: "linen", href: "/app/linen", icon: BedDouble },
  { key: "team", href: "/app/team", icon: Users },
  { key: "settings", href: "/app/settings", icon: Settings, also: ["/app/onboarding", "/app/notifications"] },
];
/** Séjours et espace voyageur, messagerie : toujours accessibles, sous les neuf entrées. */
export const GUEST_NAV: Item[] = [
  { key: "stays", href: "/app/stays", icon: CalendarDays },
  { key: "messages", href: "/app/messages", icon: MessagesSquare },
  { key: "bookings", href: "/app/bookings", icon: CalendarPlus },
  { key: "satisfaction", href: "/app/satisfaction", icon: Star },
];
const MOBILE_TABS = ["today", "planning", "tasks", "alerts"];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
const isActive = (path: string, it: Item) => (it.href === "/app" ? path === "/app" : under(path, it.href) || (it.also ?? []).some((a) => under(path, a)));

function CountDot({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return <span className={cn("grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-bold leading-none text-white tabular", className)}>{count > 99 ? "99+" : count}</span>;
}

/** Barre latérale (ordinateur), comme dans la démo. */
export function ManagerSidebarNav({ labels, unread, alerts }: { labels: NavLabels; unread: number; alerts: number }) {
  const pathname = usePathname();
  const link = (it: Item, count = 0, testId?: string) => {
    const active = isActive(pathname, it);
    return (
      <li key={it.key}>
        <Link
          href={it.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex h-10 items-center gap-3 rounded-md px-3 text-[14px] font-medium text-muted transition-colors duration-150 hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover",
            active && "bg-subtle text-fg dark:bg-surface-hover",
          )}
          data-testid={testId ?? `nav-${it.key}`}
        >
          <it.icon className={cn("size-[18px] shrink-0", active && "text-accent-text")} strokeWidth={active ? 2.2 : 1.8} />
          <span className="flex-1 truncate">{labels[it.key]}</span>
          <CountDot count={count} />
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label={labels.label} className="flex-1 overflow-y-auto px-3 pt-2" data-testid="manager-nav">
      <ul className="space-y-0.5">{MANAGER_NAV.map((it) => link(it, it.key === "alerts" ? alerts : 0))}</ul>
      <p className="px-3 pb-1 pt-5 text-micro text-faint">{labels.guestGroup}</p>
      <ul className="space-y-0.5">{GUEST_NAV.map((it) => link(it, it.key === "messages" ? unread : 0))}</ul>
    </nav>
  );
}

/**
 * Clavier ouvert (saisie en cours) : la barre inférieure s'efface pour laisser la place à la zone de saisie ;
 * sa hauteur est exposée (--bottom-bar) pour que les zones de saisie collantes restent au-dessus.
 */
function useBarSpace() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (el: EventTarget | null) => el instanceof HTMLElement && el.matches("input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]");
    const onIn = (e: FocusEvent) => setTyping(isField(e.target));
    const onOut = () => setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => root.style.setProperty("--bottom-bar", mq.matches || typing ? "0px" : "calc(4rem + env(safe-area-inset-bottom))");
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      root.style.removeProperty("--bottom-bar");
    };
  }, [typing]);
  return typing;
}

/** Téléphone : barre basse de la démo (Aujourd'hui, Planning, Tâches, Alertes) et « Plus » pour le reste. */
export function ManagerBottomBar({ labels, unread, alerts }: { labels: NavLabels; unread: number; alerts: number }) {
  const pathname = usePathname();
  const typing = useBarSpace();
  const tabs = MANAGER_NAV.filter((n) => MOBILE_TABS.includes(n.key));
  const more = [...MANAGER_NAV.filter((n) => !MOBILE_TABS.includes(n.key)), ...GUEST_NAV];
  const moreActive = more.some((n) => isActive(pathname, n));
  const [open, setOpen] = useState(false);
  return (
    <nav aria-label={labels.label} hidden={typing} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <ul className="grid h-16 grid-cols-5" data-testid="bottom-bar">
        {tabs.map((it) => {
          const active = isActive(pathname, it);
          return (
            <li key={it.key}>
              <Link href={it.href} aria-current={active ? "page" : undefined} className={cn("flex h-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium", active ? "text-accent-text" : "text-muted")} data-testid={`bottom-${it.key}`}>
                <span className="relative">
                  <it.icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
                  <CountDot count={it.key === "alerts" ? alerts : 0} className="absolute -end-2.5 -top-1.5 h-4 min-w-4 px-1 text-[10px]" />
                </span>
                {labels[it.key]}
              </Link>
            </li>
          );
        })}
        <li>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger className={cn("flex h-full w-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium", moreActive ? "text-accent-text" : "text-muted")} data-testid="bottom-more">
              <span className="relative">
                <Ellipsis className="size-[22px]" strokeWidth={1.8} />
                <CountDot count={unread} className="absolute -end-2.5 -top-1.5 h-4 min-w-4 px-1 text-[10px]" />
              </span>
              {labels.more}
            </SheetTrigger>
            <SheetContent title={labels.more}>
              <ul className="divide-y divide-line" data-testid="more-list">
                {more.map((it) => (
                  <li key={it.key}>
                    <Link href={it.href} onClick={() => setOpen(false)} className="flex h-14 items-center gap-3 text-[17px]" data-testid={`more-${it.key}`}>
                      <it.icon className="size-5 text-muted" strokeWidth={1.8} />
                      <span className="flex-1">{labels[it.key]}</span>
                      <CountDot count={it.key === "messages" ? unread : 0} />
                    </Link>
                  </li>
                ))}
              </ul>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}

/** Agent (téléphone) : barre inférieure — Missions, Messages (non-lus réels), Profil, Préférences. */
export function AgentBottomBar({ unread, labels }: { unread: number; labels: { missions: string; messages: string; profile: string; preferences: string; label: string } }) {
  const pathname = usePathname();
  const typing = useBarSpace();
  const items = [
    { key: "missions", href: "/app/missions", icon: ListChecks },
    { key: "messages", href: "/app/messages", icon: MessagesSquare },
    { key: "profile", href: "/app/profile", icon: CircleUser },
    { key: "preferences", href: "/app/preferences", icon: BellRing },
  ] as const;
  return (
    <nav aria-label={labels.label} hidden={typing} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <ul className="grid grid-cols-4" data-testid="agent-bottom-bar">
        {items.map((i) => {
          const on = under(pathname, i.href) || (i.href === "/app/missions" && pathname === "/app");
          return (
            <li key={i.key}>
              <Link href={i.href} aria-current={on ? "page" : undefined} className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", on ? "text-accent-text" : "text-muted")}>
                <i.icon className="size-[22px]" strokeWidth={on ? 2.2 : 1.8} />
                <span className="max-w-full truncate px-1">{labels[i.key]}</span>
                {i.key === "messages" && unread > 0 && (
                  <span className="absolute end-[calc(50%-20px)] top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Accès permanent aux messages d'équipe ; le nombre est celui des conversations réellement non lues. */
export function MessagesButton({ label, unread }: { label: string; unread: number }) {
  const pathname = usePathname();
  return (
    <Link
      href="/app/messages"
      aria-label={unread > 0 ? `${label} (${unread})` : label}
      aria-current={under(pathname, "/app/messages") ? "page" : undefined}
      className="relative grid size-10 place-items-center rounded-full text-muted hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover"
      data-testid="top-messages"
    >
      <MessagesSquare className="size-5" />
      {unread > 0 && (
        <span className="absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-danger px-1 text-center text-[11px] font-semibold leading-5 text-white" data-testid="nav-chat-unread">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

export function SignOutButton({ label, email }: { label: string; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title={email}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await signOut();
          router.replace("/auth/sign-in");
          router.refresh();
        })
      }
      className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-[14px] font-medium text-fg hover:bg-subtle dark:hover:bg-surface-hover"
      data-testid="sign-out"
    >
      <LogOut className="size-4" />
      {label}
    </button>
  );
}

export function OrgSwitcher({ orgs, current }: { orgs: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Organisation"
      value={current}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await setActiveOrganization(e.target.value);
          router.refresh();
        })
      }
      className="h-9 max-w-36 rounded-md border border-line bg-surface px-2 text-[13px] md:max-w-44"
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Menu Compte : profil, préférences, réglages, configuration, import, journal des envois, déconnexion.
 * Clavier : Entrée/Espace ouvre, Échap ferme et rend le focus ; clic à l'extérieur ferme.
 */
export function AccountMenu({ labels, email, signOut: signOutLabel, manager }: { labels: NavLabels; email: string; signOut: string; manager: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const items: { key: keyof NavLabels; href: string; icon: typeof CircleUser }[] = [
    { key: "profile", href: "/app/profile", icon: CircleUser },
    { key: "preferences", href: "/app/preferences", icon: BellRing },
    ...(manager
      ? [
          { key: "setup" as const, href: "/app/onboarding", icon: Settings2 },
          { key: "import" as const, href: "/app/import", icon: FileSpreadsheet },
          { key: "notifications" as const, href: "/app/notifications", icon: Mail },
        ]
      : []),
  ];
  return (
    <div ref={ref} className="relative">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={labels.account}
        title={email}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-full text-muted hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover"
        data-testid="account-menu"
      >
        <CircleUser className="size-5" />
      </button>
      {open && (
        <div className="absolute end-0 top-11 z-40 w-64 rounded-xl border border-line bg-canvas p-1.5 shadow-lg" data-testid="account-menu-list">
          <p className="truncate px-3 pb-1.5 pt-1 text-[13px] text-muted">{email}</p>
          <ul>
            {items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={pathname === i.href ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className="flex h-10 items-center gap-2.5 rounded-md px-3 text-[14px] font-medium text-fg hover:bg-subtle dark:hover:bg-surface-hover"
                  data-testid={`nav-${i.key}`}
                >
                  <i.icon className="size-4 text-muted" />
                  {labels[i.key]}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-line pt-1">
            <SignOutButton label={signOutLabel} email={email} />
          </div>
        </div>
      )}
    </div>
  );
}
