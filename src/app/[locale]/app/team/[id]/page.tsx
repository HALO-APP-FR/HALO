import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowRight, MessagesSquare, Phone } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Avatar } from "@/components/connected/avatar";
import { MemberEdit } from "@/components/connected/member-edit";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { loadThreads } from "@/lib/connected/chat";
import { nowDate } from "@/lib/connected/time";
import { periodText, windowText } from "@/lib/connected/format";
import { cn } from "@/lib/utils";

function Section({ title, count, children, testId }: { title: string; count?: number; children: React.ReactNode; testId: string }) {
  return (
    <section data-testid={testId}>
      <h2 className="mb-2 text-[15px] font-semibold">
        {title}
        {count !== undefined && <span className="ms-1.5 font-normal text-muted">{count}</span>}
      </h2>
      {children}
    </section>
  )
}

/**
 * Fiche d'un membre (responsable uniquement) : appeler, écrire, ses missions, ses absences, ses conversations.
 * Les absences n'affichent que le type et la période (jamais le motif) ; le nom et le téléphone sont modifiés
 * par la personne elle-même (la base n'autorise pas un responsable à modifier le profil d'un autre membre).
 */
export default async function MemberPage({ params }: PageProps<"/[locale]/app/team/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.member");
  const tr = await getTranslations("connected.team");
  const ta = await getTranslations("connected.absences");
  const tt = await getTranslations("taskType");
  const tts = await getTranslations("taskStatus");
  const tc = await getTranslations("connected.chat");
  const tp = await getTranslations("position");
  const tcol = await getTranslations("collaboration");
  const f = await getFormatter();
  const { supabase, org, user } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const o = org!.id;
  const { data: m } = await supabase.from("memberships").select("user_id, role, position, collaboration, is_active, profiles(full_name, phone)").eq("organization_id", o).eq("user_id", id).maybeSingle();
  if (!m) notFound();
  const prof = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string | null; phone: string | null } | null;
  const name = prof?.full_name?.trim() || "";
  const phone = prof?.phone?.trim() || "";
  const now = nowDate();
  const [{ data: open }, { data: toValidate }, { data: recent }, { data: absences }, threads] = await Promise.all([
    supabase.from("tasks").select("id, type, title, status, window_start, window_end, properties(name, timezone)").eq("organization_id", o).eq("assignee_id", id).in("status", ["assigned", "in_progress", "to_redo"]).order("window_start").limit(12),
    supabase.from("tasks").select("id, type, title, completed_at, properties(name)").eq("organization_id", o).eq("assignee_id", id).eq("status", "done").order("completed_at").limit(12),
    supabase.from("tasks").select("id, type, title, validated_at, properties(name)").eq("organization_id", o).eq("assignee_id", id).eq("status", "validated").order("validated_at", { ascending: false }).limit(5),
    supabase.from("absences").select("id, kind, starts_at, ends_at, status").eq("organization_id", o).eq("member_id", id).in("status", ["pending", "accepted"]).gte("ends_at", now.toISOString()).order("starts_at").limit(10),
    loadThreads(supabase, o, user!.id),
  ]);
  const withMember = threads.filter((th) => th.members.some((x) => x.id === id));
  const pname = (x: unknown) => ((Array.isArray(x) ? x[0] : x) as { name: string } | null)?.name ?? "";
  const ptz = (x: unknown) => ((Array.isArray(x) ? x[0] : x) as { timezone?: string | null } | null)?.timezone ?? undefined;
  const short = (x: string) => f.dateTime(new Date(x), { dateStyle: "short", timeStyle: "short" });
  const isMe = id === user!.id;

  return (
    <>
      <Link href="/app/team" className="mb-4 inline-block text-[14px] text-accent-text hover:underline">
        ← {t("back")}
      </Link>
      <Card className="mb-6 p-5 md:p-6" data-testid="member-card">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={name} id={id} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-title-2 truncate" data-testid="member-title">{name || tr("noName")}</h1>
            <p className="text-[14px] text-muted">
              {tr(`roles.${m.role}`)}
              {m.position ? ` · ${tp.has(m.position) ? tp(m.position) : m.position}` : ""}
              {m.collaboration ? ` · ${tcol(m.collaboration)}` : ""}
              {m.is_active ? "" : ` · ${tr("inactive")}`}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {phone ? (
            <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className={buttonVariants({ variant: "outline", size: "lg" })} data-testid="member-call">
              <Phone />
              {t("call", { phone })}
            </a>
          ) : (
            <span className="inline-flex h-11 items-center rounded-md border border-dashed border-line px-4 text-[14px] text-muted" data-testid="member-no-phone">
              {t("noPhone")}
            </span>
          )}
          {!isMe && m.is_active && (
            <Link href={`/app/messages?to=${id}`} className={buttonVariants({ size: "lg" })} data-testid="member-write">
              <MessagesSquare />
              {t("write")}
            </Link>
          )}
        </div>
        <p className="mt-3 text-[13px] text-muted">{t(isMe ? "editSelf" : "editHint")}</p>
        {(org!.role === "owner" || m.role === "agent") && (
          <div className="mt-2">
            <MemberEdit memberId={id} position={(m.position as string | null) ?? null} collaboration={(m.collaboration as string | null) ?? null} />
          </div>
        )}
        {isMe && (
          <Link href="/app/profile" className="mt-1 inline-block text-[14px] text-accent-text hover:underline">
            {t("editProfile")}
          </Link>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Section title={t("toValidate")} count={(toValidate ?? []).length} testId="member-to-validate">
            <Card className="divide-y divide-line">
              {(toValidate ?? []).length === 0 && <p className="p-4 text-[14px] text-muted">{t("noneToValidate")}</p>}
              {(toValidate ?? []).map((k) => (
                <Link key={k.id} href={`/app/missions/${k.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{(k.title as string) || tt(k.type)} · {pname(k.properties)}</span>
                    <span className="block text-[13px] text-muted">{t("finishedAt", { date: k.completed_at ? short(k.completed_at) : "—" })}</span>
                  </span>
                  <span className={cn(buttonVariants({ size: "sm" }))}>{t("review")}</span>
                </Link>
              ))}
            </Card>
          </Section>
          <Section title={t("upcoming")} count={(open ?? []).length} testId="member-missions">
            <Card className="divide-y divide-line">
              {(open ?? []).length === 0 && <p className="p-4 text-[14px] text-muted">{t("noneUpcoming")}</p>}
              {(open ?? []).map((k) => (
                <Link key={k.id} href={`/app/missions/${k.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{(k.title as string) || tt(k.type)} · {pname(k.properties)}</span>
                    <span className="block truncate text-[13px] text-muted">{windowText(f, k.window_start, k.window_end, false, ptz(k.properties))}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[12px] font-medium dark:bg-surface-hover">{tts(k.status)}</span>
                </Link>
              ))}
            </Card>
          </Section>
          {(recent ?? []).length > 0 && (
            <Section title={t("recent")} testId="member-recent">
              <Card className="divide-y divide-line">
                {(recent ?? []).map((k) => (
                  <Link key={k.id} href={`/app/missions/${k.id}`} className="block px-4 py-2.5 text-[14px] hover:bg-surface-hover">
                    {(k.title as string) || tt(k.type)} · {pname(k.properties)} <span className="text-muted">· {t("validatedAt", { date: k.validated_at ? short(k.validated_at) : "—" })}</span>
                  </Link>
                ))}
              </Card>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          <Section title={t("conversations")} count={withMember.length} testId="member-threads">
            <Card className="divide-y divide-line">
              {withMember.length === 0 && <p className="p-4 text-[14px] text-muted">{t("noConversation")}</p>}
              {withMember.map((th) => (
                <Link key={th.id} href={`/app/messages/${th.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover" data-testid="member-thread">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{tc(`contextKind.${th.contextKind}`)} · {th.contextLabel}</span>
                    {th.last && <span className="block truncate text-[13px] text-muted">{th.last.body}</span>}
                  </span>
                  {th.unread && <span className="size-2.5 shrink-0 rounded-full bg-accent" aria-label={tc("new")} />}
                  <ArrowRight className="size-4 text-faint rtl:-scale-x-100" />
                </Link>
              ))}
            </Card>
          </Section>
          <Section title={t("absences")} testId="member-absences">
            <Card className="divide-y divide-line">
              {(absences ?? []).length === 0 && <p className="p-4 text-[14px] text-muted">{t("noAbsence")}</p>}
              {(absences ?? []).map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3 text-[14px]" data-testid="member-absence">
                  <span className="flex-1">
                    {ta(`kinds.${a.kind}`)} · {periodText(f, a.starts_at, a.ends_at)}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", a.status === "pending" ? "bg-warning-soft text-warning" : "bg-subtle dark:bg-surface-hover")}>{t(`absence.${a.status}`)}</span>
                </div>
              ))}
            </Card>
            <p className="mt-2 text-[13px] text-muted">{t("absenceHint")}</p>
          </Section>
        </div>
      </div>
    </>
  );
}
