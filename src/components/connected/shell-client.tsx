"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, LogOut, MoreHorizontal } from "lucide-react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { signOut } from "@/lib/connected/auth-actions";
import { setActiveOrganization } from "@/lib/connected/actions";

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
      className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover"
    >
      <LogOut className="size-4" />
      <span className="hidden sm:inline">{label}</span>
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
      className="h-9 max-w-44 rounded-md border border-line bg-surface px-2 text-[13px]"
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
 * Menu « Plus » : rubriques secondaires regroupées pour que la barre principale tienne en entier dès 1 280 px.
 * Clavier : Entrée/Espace ouvre, Échap ferme et rend le focus ; clic à l'extérieur ferme.
 */
export function NavMore({ label, items }: { label: string; items: { href: string; label: string; icon: React.ReactNode; testId: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const active = items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
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
  return (
    <div ref={ref} className="relative">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[14px] font-medium hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover ${active ? "text-fg" : "text-muted"}`}
        data-testid="nav-more"
      >
        <MoreHorizontal className="size-4" />
        {label}
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="absolute end-0 top-10 z-30 min-w-56 rounded-lg border border-line bg-canvas p-1 shadow-lg" data-testid="nav-more-menu">
          {items.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={pathname === i.href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="flex h-10 items-center gap-2.5 rounded-md px-3 text-[14px] font-medium text-fg hover:bg-subtle dark:hover:bg-surface-hover"
                data-testid={i.testId}
              >
                {i.icon}
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
