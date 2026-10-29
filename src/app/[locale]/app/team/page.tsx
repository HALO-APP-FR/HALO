import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Phone, TriangleAlert } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { InviteForm } from "@/components/connected/team-forms";
import { AbsenceForm, AbsenceList, type AbsenceRow } from "@/components/connected/planning-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { loadPlanning } from "@/lib/connected/planning";
import { nowDate } from "@/lib/connected/time";
import { periodText, windowText } from "@/lib/connected/format";

/** Équipe : qui est qui, qui est disponible, ce qu'il faut réorganiser (rien n'est réaffecté sans décision). */
export default async function TeamPage({ params }: PageProps<"/[locale]/app/team">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.team");
  const ta = await getTranslations("connected.absences");
  const tt = await getTranslations("taskType");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const now = nowDate();
  const [{ data }, planning, { data: events }] = await Promise.all([
    supabase.from("memberships").select("user_id, role, position, is_active, profiles(full_name, phone)").eq("organization_id", org!.id).order("created_at"),
    loadPlanning(supabase, org!.id, now),
    supabase.from("absence_events").select("id, kind, at, actor_id, absences(scope, member_id, kind, starts_at, ends_at)").eq("organization_id", org!.id).order("at", { ascending: false }).limit(30),
  ]);
  const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x);
  const people = (data ?? []).map((m) => {
    const p = one(m.profiles) as { full_name: string; phone: string | null } | null;
    return { id: m.user_id as string, role: m.role as string, active: m.is_active as boolean, name: p?.full_name?.trim() ?? "", phone: p?.phone?.trim() ?? "" };
  });
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name || t("noName") : ta("wholeTeam"));

  // Missions concernées par une absence ou une fermeture : libellés pour décider et réorganiser
  const taskIds = Array.from(new Set(planning.availability.map((c) => c.taskId)));
  const { data: impacted } = taskIds.length
    ? await supabase.from("tasks").select("id, type, window_start, window_end, properties(name)").eq("organization_id", org!.id).in("id", taskIds)
    : { data: [] as never[] };
  const label = (id: string) => {
    const k = (impacted ?? []).find((x: { id: string }) => x.id === id) as { type: string; window_start: string; window_end: string; properties: unknown } | undefined;
    return k ? `${tt(k.type)} · ${(one(k.properties) as { name: string } | null)?.name ?? ""} · ${windowText(f, k.window_start, k.window_end)}` : id;
  };
  const impactsOf = (absenceId: string) =>
    planning.availability.filter((c) => c.absenceIds.includes(absenceId)).map((c) => ({ id: c.taskId, label: label(c.taskId) }));
  const absent = new Set(
    planning.absences.filter((a) => a.status === "accepted" && new Date(a.startsAt) <= now && new Date(a.endsAt) > now).flatMap((a) => (a.scope === "team" ? people.map((p) => p.id) : [a.memberId!])),
  );
  const rows: AbsenceRow[] = planning.absences
    .filter((a) => new Date(a.endsAt) > now)
    .map((a) => ({
      id: a.id,
      who: a.scope === "team" ? (a.teamPosition ? `${ta("wholeTeam")} (${a.teamPosition})` : ta("wholeTeam")) : nameOf(a.memberId),
      kind: a.kind,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      status: a.status,
      unplanned: a.unplanned,
      reason: a.reason,
      canDecide: a.status === "pending",
      canCancel: true,
      impacts: impactsOf(a.id),
    }));
  const conflicts = planning.availability;
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <Card className="divide-y divide-line self-start">
            {people.map((m) => {
              const missing = [!m.name && t("fields.name"), !m.phone && t("fields.phone")].filter(Boolean) as string[];
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5" data-testid="member-row">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium" data-testid="member-name">
                      {m.name || t("noName")}
                    </span>
                    <span className="block text-[13px] text-muted">
                      {t(`roles.${m.role}`)}
                      {m.active ? "" : ` · ${t("inactive")}`}
                      {missing.length > 0 && <span className="text-warning"> · {t("toComplete", { fields: missing.join(", ") })}</span>}
                    </span>
                  </span>
                  {absent.has(m.id) && (
                    <span className="rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-medium text-warning" data-testid="member-absent">
                      {ta("absentNow")}
                    </span>
                  )}
                  {m.phone && (
                    <a href={`tel:${m.phone.replace(/[^+\d]/g, "")}`} className="flex items-center gap-1.5 text-[14px] text-accent-text hover:underline">
                      <Phone className="size-4" />
                      {m.phone}
                    </a>
                  )}
                </div>
              );
            })}
          </Card>

          {(conflicts.length > 0 || planning.closureStays.length > 0) && (
            <Card className="border-danger p-5" data-testid="availability-conflicts">
              <h2 className="flex items-center gap-2 text-[17px] font-semibold text-danger">
                <TriangleAlert className="size-5" />
                {ta("conflictsTitle", { count: conflicts.length })}
              </h2>
              <p className="mt-1 text-[14px] text-muted">{ta("conflictsText")}</p>
              <ul className="mt-3 divide-y divide-line">
                {conflicts.map((c) => (
                  <li key={c.taskId} className="flex flex-wrap items-center gap-2 py-2.5" data-testid="availability-conflict">
                    <Link href={`/app/missions/${c.taskId}`} className="flex-1 text-[14px] text-accent-text hover:underline">
                      {label(c.taskId)}
                    </Link>
                    <span className="text-[13px] text-muted">
                      {c.memberId ? nameOf(c.memberId) : ta("nobody")} · {ta(`conflictKind.${c.kind}`)}
                    </span>
                  </li>
                ))}
                {planning.closureStays.map((s) => (
                  <li key={s.id} className="py-2.5 text-[14px]" data-testid="closure-stay">
                    <Link href={`/app/stays/${s.id}`} className="text-accent-text hover:underline">
                      {ta("closureStay", { guest: s.guestName || "—", dates: windowText(f, s.checkInAt, s.checkOutAt) })}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-5" data-testid="team-absences">
            <h2 className="text-[17px] font-semibold">{ta("listTitle")}</h2>
            <p className="mt-1 text-[14px] text-muted">{ta("listText")}</p>
            <div className="mt-2">
              <AbsenceList rows={rows} empty={ta("none")} />
            </div>
          </Card>

          <Card className="p-5" data-testid="absence-history">
            <h2 className="text-[17px] font-semibold">{ta("historyTitle")}</h2>
            {(events ?? []).length === 0 ? (
              <p className="mt-2 text-[14px] text-muted">{ta("historyEmpty")}</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-[14px]">
                {(events ?? []).map((e) => {
                  const a = one(e.absences) as { scope: string; member_id: string | null; kind: string; starts_at: string; ends_at: string } | null;
                  return (
                    <li key={e.id} className="text-muted">
                      <span className="text-fg">{f.dateTime(new Date(e.at), { dateStyle: "short", timeStyle: "short" })}</span> · {nameOf(e.actor_id)} · {ta(`event.${e.kind}`)}
                      {a && ` — ${a.scope === "team" ? ta("wholeTeam") : nameOf(a.member_id)}, ${ta(`kinds.${a.kind}`)}, ${periodText(f, a.starts_at, a.ends_at)}`}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <AbsenceForm manager members={people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))} selfId="" />
          <InviteForm />
        </div>
      </div>
    </>
  );
}
