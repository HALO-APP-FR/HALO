"use client";

import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { BellRing, CircleUser, FileSpreadsheet, LayoutDashboard, ListChecks, LogOut, Mail, MessagesSquare, Settings2, SlidersHorizontal, Sparkles, Truck, Users } from "lucide-react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { signOut } from "@/lib/connected/auth-actions";
import { setActiveOrganization } from "@/lib/connected/actions";
import { cn } from "@/lib/utils";

export type NavLabels = Record<
  | "dashboard" | "logistics" | "teamSpace" | "guest" | "missions" | "incidents" | "properties" | "import" | "members" | "toValidate" | "messages"
  | "stays" | "services" | "bookings" | "satisfaction" | "profile" | "preferences" | "settings" | "setup" | "notifications" | "account" | "label" | "spaceTabs",
  string
>;

type SpaceKey = "dashboard" | "logistics" | "team" | "guest";
type Tab = { key: keyof NavLabels; href: string; query?: string };

/**
 * Les quatre espaces du responsable. Chaque page existante est rattachée à un espace par son adresse :
 * aucune adresse n'a changé (liens des e-mails et favoris toujours valides).
 */
const SPACES: { key: SpaceKey; label: keyof NavLabels; href: string; icon: typeof Users; prefixes: string[]; tabs: Tab[] }[] = [
  { key: "dashboard", label: "dashboard", href: "/app", icon: LayoutDashboard, prefixes: [], tabs: [] },
  {
    key: "logistics",
    label: "logistics",
    href: "/app/missions",
    icon: Truck,
    prefixes: ["/app/missions", "/app/incidents", "/app/properties", "/app/import"],
    tabs: [
      { key: "missions", href: "/app/missions" },
      { key: "incidents", href: "/app/incidents" },
      { key: "properties", href: "/app/properties" },
    ],
  },
  {
    key: "team",
    label: "teamSpace",
    href: "/app/team",
    icon: Users,
    prefixes: ["/app/team", "/app/messages"],
    tabs: [
      { key: "members", href: "/app/team" },
      { key: "toValidate", href: "/app/missions", query: "status=done" },
      { key: "messages", href: "/app/messages" },
    ],
  },
  {
    key: "guest",
    label: "guest",
    href: "/app/stays",
    icon: Sparkles,
    prefixes: ["/app/stays", "/app/services", "/app/bookings", "/app/satisfaction"],
    tabs: [
      { key: "stays", href: "/app/stays" },
      { key: "services", href: "/app/services" },
      { key: "bookings", href: "/app/bookings" },
      { key: "satisfaction", href: "/app/satisfaction" },
    ],
  },
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Espace de la page affichée ; null pour les pages de compte (profil, réglages…). */
export function spaceOf(path: string, status: string | null): SpaceKey | null {
  if (path === "/app") return "dashboard";
  // « Missions à valider » : la liste des missions filtrée, rattachée à l'Équipe (validation du travail)
  if (path === "/app/missions" && status === "done") return "team";
  return SPACES.find((s) => s.prefixes.some((p) => under(path, p)))?.key ?? null;
}

function useSpace() {
  const pathname = usePathname();
  const sp = useSearchParams();
  return { pathname, status: sp.get("status"), space: spaceOf(pathname, sp.get("status")) };
}

function SpaceNavInner({ labels }: { labels: NavLabels }) {
  const { space } = useSpace();
  // Barre latérale (ordinateur), dans l'esprit de la démo : quatre espaces, l'actif mis en avant
  return (
    <nav aria-label={labels.label}>
      <ul className="space-y-0.5" data-testid="space-nav">
        {SPACES.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              aria-current={space === s.key ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-md px-3 text-[14px] font-medium transition-colors duration-150",
                space === s.key ? "bg-subtle text-fg dark:bg-surface-hover" : "text-muted hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover",
              )}
              data-testid={`space-${s.key}`}
            >
              <s.icon className={cn("size-[18px] shrink-0", space === s.key && "text-accent-text")} strokeWidth={space === s.key ? 2.2 : 1.8} />
              <span className="truncate">{labels[s.label]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
export function SpaceNav(props: { labels: NavLabels }) {
  return (
    <Suspense fallback={null}>
      <SpaceNavInner {...props} />
    </Suspense>
  );
}

function SpaceTabsInner({ labels }: { labels: NavLabels }) {
  const { pathname, status, space } = useSpace();
  const def = SPACES.find((s) => s.key === space);
  if (!def || def.tabs.length === 0) return null;
  const isActive = (tab: Tab) => {
    if (tab.query) return pathname === tab.href && status === "done";
    if (tab.href === "/app/missions") return under(pathname, tab.href) && status !== "done";
    return under(pathname, tab.href);
  };
  return (
    <nav aria-label={labels.spaceTabs} className="mx-auto max-w-[1200px] px-4 md:px-8">
      <ul className="-mb-px flex gap-5 overflow-x-auto [scrollbar-width:none]" data-testid="space-tabs" data-space={def.key}>
        {def.tabs.map((tab) => (
          <li key={tab.key} className="shrink-0">
            <Link
              href={tab.query ? `${tab.href}?${tab.query}` : tab.href}
              aria-current={isActive(tab) ? "page" : undefined}
              className={cn(
                "flex h-11 items-center border-b-2 text-[14px] font-medium transition-colors",
                isActive(tab) ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg",
              )}
              data-testid={`tab-${tab.key}`}
            >
              {labels[tab.key]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
export function SpaceTabs(props: { labels: NavLabels }) {
  return (
    <Suspense fallback={null}>
      <SpaceTabsInner {...props} />
    </Suspense>
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
    const apply = () => root.style.setProperty("--bottom-bar", mq.matches || typing ? "0px" : "calc(3.5rem + env(safe-area-inset-bottom))");
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      root.style.removeProperty("--bottom-bar");
    };
  }, [typing]);
  return typing;
}

/** Téléphone : barre inférieure à quatre destinations, libellés toujours visibles, zone tactile ≥ 56 px. */
function BottomBarInner({ labels }: { labels: NavLabels }) {
  const { space } = useSpace();
  const typing = useBarSpace();
  return (
    <nav aria-label={labels.label} hidden={typing} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <ul className="grid grid-cols-4" data-testid="bottom-bar">
        {SPACES.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              aria-current={space === s.key ? "page" : undefined}
              className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", space === s.key ? "text-accent-text" : "text-muted")}
              data-testid={`bottom-${s.key}`}
            >
              <s.icon className={cn("size-[22px]", space === s.key && "stroke-[2.25]")} />
              <span className="max-w-full truncate px-0.5 max-[380px]:text-[10px] max-[380px]:tracking-tight">{labels[s.label]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
export function BottomBar(props: { labels: NavLabels }) {
  return (
    <Suspense fallback={null}>
      <BottomBarInner {...props} />
    </Suspense>
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
          { key: "settings" as const, href: "/app/settings", icon: SlidersHorizontal },
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
