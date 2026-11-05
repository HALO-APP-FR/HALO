import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { NewThreadForm } from "@/components/connected/chat";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { loadThreads } from "@/lib/connected/chat";
import { isoFromNow, nowDate } from "@/lib/connected/time";
import { windowText } from "@/lib/connected/format";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Avatar } from "@/components/connected/avatar";

/** Messagerie interne : chaque conversation est liée à une mission, un logement ou un séjour. Jamais visible du voyageur. */
export default async function MessagesPage({ params, searchParams }: PageProps<"/[locale]/app/messages">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("connected.chat");
  const tt = await getTranslations("taskType");
  const f = await getFormatter();
  const { supabase, org, user } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  const manager = isManagerRole(org!.role);
  const threads = await loadThreads(supabase, org!.id, user!.id);
  let form = null;
  // Formulaire de nouvelle conversation : ouvert à la demande (bouton, fiche agent, fiche mission/séjour/logement)
  const wantsNew = manager && (sp.new === "1" || typeof sp.to === "string" || typeof sp.task === "string" || typeof sp.property === "string" || typeof sp.stay === "string");
  if (wantsNew) {
    const [{ data: members }, { data: tasks }, { data: props }, { data: stays }] = await Promise.all([
      supabase.from("memberships").select("user_id, role, profiles(full_name)").eq("organization_id", org!.id).eq("is_active", true),
      supabase.from("tasks").select("id, type, title, window_start, window_end, properties(name)").eq("organization_id", org!.id).in("status", ["unassigned", "assigned", "in_progress", "to_redo", "done"]).gte("window_end", isoFromNow(-86_400_000)).order("window_start").limit(100),
      supabase.from("properties").select("id, name").eq("organization_id", org!.id).is("archived_at", null).order("name"),
      supabase.from("reservations").select("id, guest_name, check_in_at, check_out_at, properties(name)").eq("organization_id", org!.id).eq("status", "confirmed").gte("check_out_at", isoFromNow(0)).order("check_in_at").limit(100),
    ]);
    const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x);
    const contexts = [
      ...(tasks ?? []).map((k) => ({ kind: "task" as const, id: k.id as string, label: `${tt(k.type)} · ${(one(k.properties) as { name: string } | null)?.name ?? ""} · ${windowText(f, k.window_start, k.window_end)}` })),
      ...(props ?? []).map((p) => ({ kind: "property" as const, id: p.id as string, label: p.name as string })),
      ...(stays ?? []).map((s) => ({ kind: "reservation" as const, id: s.id as string, label: `${s.guest_name || "—"} · ${(one(s.properties) as { name: string } | null)?.name ?? ""} · ${windowText(f, s.check_in_at, s.check_out_at)}` })),
    ];
    const initial = typeof sp.task === "string" ? { kind: "task" as const, id: sp.task } : typeof sp.property === "string" ? { kind: "property" as const, id: sp.property } : typeof sp.stay === "string" ? { kind: "reservation" as const, id: sp.stay } : undefined;
    form = (
      <NewThreadForm
        members={(members ?? [])
          .filter((m) => m.user_id !== user!.id)
          .map((m) => ({ id: m.user_id as string, role: m.role as string, name: ((Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string } | null)?.full_name ?? "" }))}
        contexts={contexts}
        initial={initial}
        initialTo={typeof sp.to === "string" ? [sp.to] : []}
      />
    );
  }
  const others = (th: (typeof threads)[number]) => th.members.filter((m) => m.id !== user!.id);
  const title = (th: (typeof threads)[number]) => others(th).map((m) => m.name || t("noName")).join(", ") || t("noName");
  const nameOf = (th: (typeof threads)[number], id: string | null) => (id === user!.id ? t("you") : th.members.find((m) => m.id === id)?.name || t("noName"));
  const now = nowDate().getTime();
  const when = (x: string) => {
    const d = new Date(x);
    const sameDay = now - d.getTime() < 86_400_000 && new Date(now).getDate() === d.getDate();
    return sameDay ? f.dateTime(d, { hour: "2-digit", minute: "2-digit" }) : f.dateTime(d, { day: "numeric", month: "short" });
  };
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={manager ? t("subtitleManager") : t("subtitle")}
        actions={manager && !wantsNew ? (
          <Link href="/app/messages?new=1" className={buttonVariants({ size: "md" })} data-testid="chat-new-open">
            <Plus />
            {t("newTitle")}
          </Link>
        ) : undefined}
      />
      <div className={cn("grid gap-6", form && "lg:grid-cols-[1fr_420px]")}>
        <div className="min-w-0 space-y-2 self-start">
          <Card className="divide-y divide-line overflow-hidden" data-testid="chat-list">
            {threads.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-[15px] font-medium">{t("none")}</p>
                <p className="mt-1 text-[14px] text-muted">{manager ? t("noneManager") : t("noneAgent")}</p>
              </div>
            )}
            {threads.map((th) => {
              const first = others(th)[0];
              return (
                <Link key={th.id} href={`/app/messages/${th.id}`} className="flex items-start gap-3 px-4 py-3.5 hover:bg-surface-hover md:px-5" data-testid="chat-row" data-unread={th.unread ? "1" : "0"}>
                  <Avatar name={first?.name ?? ""} id={first?.id ?? th.id} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("min-w-0 flex-1 truncate text-[15px]", th.unread ? "font-semibold" : "font-medium")}>{title(th)}</span>
                      <span className={cn("shrink-0 text-[12px]", th.unread ? "font-semibold text-accent-text" : "text-muted")}>{when(th.lastMessageAt)}</span>
                    </span>
                    {th.last && (
                      <span className={cn("mt-0.5 block truncate text-[14px]", th.unread ? "text-fg" : "text-muted")}>
                        {th.last.urgent && <span className="me-1 font-semibold text-danger">{t("urgent")} ·</span>}
                        {nameOf(th, th.last.authorId)} : {th.last.body}
                      </span>
                    )}
                    <span className="mt-1 flex items-center gap-2">
                      <span className="truncate rounded-full bg-subtle px-2 py-0.5 text-[12px] text-muted dark:bg-surface-hover">
                        {t(`contextKind.${th.contextKind}`)} · {th.contextLabel}
                      </span>
                      {th.unread && <span className="ms-auto rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-on-accent">{t("new")}</span>}
                    </span>
                  </span>
                </Link>
              );
            })}
          </Card>
          {manager && <p className="px-1 text-[13px] text-muted" data-testid="chat-privacy">{t("privacy")}</p>}
        </div>
        {form}
      </div>
    </>
  );
}
