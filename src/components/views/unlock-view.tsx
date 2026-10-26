"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { initialsOf } from "@/lib/domain/types";
import { useHalo, useHaloReady } from "@/lib/store/halo-store";
import { Avatar } from "@/components/halo/avatar";
import { AnimatedLogoMark } from "@/components/halo/logo";
import { UnlockPad } from "@/components/halo/unlock-pad";
import { Skeleton } from "@/components/ui/skeleton";

export function UnlockView() {
  const t = useTranslations("auth");
  const ready = useHaloReady();
  const me = useHalo((s) => s.members.find((m) => m.id === s.currentAgentId));

  return (
    <div className="flex min-h-dvh flex-col items-center bg-subtle px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),40px)]">
      <AnimatedLogoMark className="size-10 text-fg" label="HALO" />
      <div className="halo-rise mt-10 flex flex-col items-center text-center [animation-delay:0.3s]">
        {ready && me ? <Avatar initials={initialsOf(me.name)} color={me.color} size="lg" /> : <Skeleton className="size-11 rounded-full" />}
        <h1 className="mt-4 text-title-1">{t("hello", { name: me?.name.split(" ")[0] ?? "" })}</h1>
        <p className="mt-1 text-body text-muted">{t("pinTitle")}</p>
      </div>
      <div className="halo-rise mt-10 [animation-delay:0.45s]">
        <UnlockPad />
      </div>
      <div className="mt-auto flex flex-col items-center gap-3 pt-10 text-center">
        <Link href="/login?role=agent" className="flex h-11 items-center px-3 text-[15px] font-medium text-accent-text">
          {t("notYou")}
        </Link>
        <p className="max-w-xs text-caption text-muted">{t("pinForgot")}</p>
      </div>
    </div>
  );
}
