"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
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
