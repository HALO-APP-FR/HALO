import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { NewThreadForm } from "@/components/connected/chat";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { loadThreads } from "@/lib/connected/chat";
import { isoFromNow } from "@/lib/connected/time";
import { windowText } from "@/lib/connected/format";
import { cn } from "@/lib/utils";

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
  if (manager) {
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
      />
    );
  }
  const nameOf = (th: (typeof threads)[number], id: string | null) => th.members.find((m) => m.id === id)?.name || t("noName");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className={cn("grid gap-4", manager && "lg:grid-cols-[1fr_420px]")}>
        <Card className="divide-y divide-line self-start" data-testid="chat-list">
          {threads.length === 0 && <p className="p-5 text-[15px] text-muted">{t("none")}</p>}
          {threads.map((th) => (
            <Link key={th.id} href={`/app/messages/${th.id}`} className="block px-5 py-3.5 hover:bg-surface-hover" data-testid="chat-row" data-unread={th.unread ? "1" : "0"}>
              <span className="flex items-center gap-2">
                <span className="flex-1 truncate text-[15px] font-medium">
                  {t(`contextKind.${th.contextKind}`)} · {th.contextLabel}
                </span>
                {th.unread && <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white">{t("new")}</span>}
              </span>
              <span className="block truncate text-[13px] text-muted">
                {th.members.map((m) => m.name || t("noName")).join(", ")}
              </span>
              {th.last && (
                <span className="mt-0.5 block truncate text-[14px]">
                  {th.last.urgent && <span className="me-1 font-semibold text-danger">{t("urgent")}</span>}
                  {nameOf(th, th.last.authorId)} : {th.last.body}
                </span>
              )}
            </Link>
          ))}
        </Card>
        {form}
      </div>
    </>
  );
}
