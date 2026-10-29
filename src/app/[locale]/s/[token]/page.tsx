import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Bell, CalendarDays, MapPin } from "lucide-react";
import { LogoMark } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { Card } from "@/components/ui/card";
import { GuestMessageForm, GuestProblemForm, GuestReply, GuestRequestForm } from "@/components/connected/guest-forms";
import { supabaseAnon } from "@/lib/supabase/server";
import { isConnected } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "HALO",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

interface GEvent { kind: string; status: string | null; body: string | null; author: string; at: string }
interface GService { id: string; kind: string; start_at: string; people: number | null; details: string | null; status: string; created_at: string; events: GEvent[] }
interface GProblem { id: string; category: string; description: string; urgent: boolean; status: string; created_at: string; resolved_at: string | null; message: string | null }
interface GStay {
  status: "ok";
  previously_opened_at: string | null;
  organization: { name: string; services_offered: string[] };
  property: { name: string; address: string | null; city: string | null; check_in_time: string; check_out_time: string };
  stay: { guest_name: string | null; check_in_at: string; check_out_at: string; adults: number; children: number; babies: number; link_valid_until: string };
  guide: Record<string, string | null>;
  services: GService[];
  messages: { author: "guest" | "member"; body: string; at: string }[];
}

/** Espace voyageur : accès par lien de séjour, sans compte. Le serveur ne renvoie que ce qui est prévu pour lui. */
export default async function GuestSpace({ params }: PageProps<"/[locale]/s/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("guestSpace");
  const tk = await getTranslations("serviceKind");
  const ts = await getTranslations("serviceStatus");
  const tcat = await getTranslations("connected.incidents.category");
  const f = await getFormatter();

  let data: GStay | { status: string } | null = null;
  let problems: GProblem[] = [];
  let failed = false;
  if (isConnected()) {
    const anon = supabaseAnon();
    const { data: d, error } = await anon.rpc("get_guest_stay", { token });
    if (error) failed = true;
    else data = d as GStay | { status: string };
    if (!failed && data?.status === "ok") {
      const { data: pr } = await anon.rpc("guest_problems", { token });
      problems = ((pr as { problems?: GProblem[] } | null)?.problems ?? []) as GProblem[];
    }
  }

  if (!data || data.status !== "ok") {
    return (
      <div className="grid min-h-dvh place-items-center bg-subtle px-4">
        <Card className="max-w-md p-6 text-center" data-testid="guest-unavailable">
          <LogoMark className="mx-auto size-12 text-fg" />
          <h1 className="mt-5 text-title-2">{failed ? t("error.title") : t("unavailable.title")}</h1>
          <p className="mt-2 text-[15px] text-muted">{failed ? t("error.text") : t("unavailable.text")}</p>
        </Card>
      </div>
    );
  }
  const g = data as GStay;
  const d = (x: string, time = true) => f.dateTime(new Date(x), time ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "full" });
  const news = g.previously_opened_at
    ? g.services.filter((s) => s.events.some((e) => e.author === "member" && Date.parse(e.at) > Date.parse(g.previously_opened_at!))).length +
      g.messages.filter((m) => m.author === "member" && Date.parse(m.at) > Date.parse(g.previously_opened_at!)).length
    : 0;
  const kinds = g.organization.services_offered?.length ? g.organization.services_offered : ["other"];
  const guideKeys = ["welcome", "house_rules", "checkout_instructions", "wifi_name", "wifi_password", "parking", "trash", "recommendations", "emergency_phone"] as const;
  const toLocal = (iso: string) => iso.slice(0, 16);

  return (
    <div className="min-h-dvh bg-subtle">
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <LogoMark className="size-8 text-fg" />
          <span className="flex-1 text-[15px] font-semibold">{g.organization.name}</span>
          <LocaleSwitcher variant="icon" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6" data-testid="guest-space">
        <div>
          <h1 className="text-title-1">{g.stay.guest_name ? t("hello", { name: g.stay.guest_name }) : t("helloAnon")}</h1>
          <p className="mt-2 flex items-center gap-2 text-[15px] text-muted">
            <MapPin className="size-4" />
            {g.property.name}
            {g.property.city ? ` · ${g.property.city}` : ""}
          </p>
          <p className="mt-1 flex items-center gap-2 text-[15px] text-muted">
            <CalendarDays className="size-4" />
            {d(g.stay.check_in_at)} → {d(g.stay.check_out_at)}
          </p>
        </div>
        {news > 0 && (
          <p className="flex items-center gap-2 rounded-xl border border-accent bg-accent-soft p-4 text-[15px] font-medium" role="status" data-testid="guest-news">
            <Bell className="size-5 text-accent-text" />
            {t("news", { count: news })}
          </p>
        )}

        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">{t("guide")}</h2>
          <dl className="mt-3 space-y-3">
            {guideKeys
              .filter((k) => g.guide[k])
              .map((k) => (
                <div key={k}>
                  <dt className="text-[13px] font-medium text-muted">{t(`guideFields.${k}`)}</dt>
                  <dd className="whitespace-pre-wrap text-[15px]">{g.guide[k]}</dd>
                </div>
              ))}
            {guideKeys.every((k) => !g.guide[k]) && <p className="text-[14px] text-muted">{t("guideEmpty")}</p>}
          </dl>
          <p className="mt-3 text-[13px] text-muted">{t("times", { in: g.property.check_in_time.slice(0, 5), out: g.property.check_out_time.slice(0, 5) })}</p>
        </Card>

        <Card className="p-5" data-testid="guest-services">
          <h2 className="text-[17px] font-semibold">{t("myRequests")}</h2>
          {g.services.length === 0 && <p className="mt-2 text-[14px] text-muted">{t("noRequests")}</p>}
          <ul className="mt-3 space-y-3">
            {g.services.map((s) => (
              <li key={s.id} className="rounded-md border border-line p-3" data-testid="guest-service" data-status={s.status}>
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                  <span className="flex-1">{tk(s.kind)} · {d(s.start_at)}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", s.status === "confirmed" || s.status === "done" ? "bg-success-soft text-success" : s.status === "declined" || s.status === "cancelled" ? "bg-danger-soft text-danger" : s.status === "info_requested" ? "bg-warning-soft text-warning" : "bg-subtle text-muted")}>
                    {t(`status.${s.status}`)}
                  </span>
                </p>
                <ol className="mt-2 space-y-1.5 border-s border-line ps-3 text-[14px]">
                  {s.events.map((e, i) => (
                    <li key={i}>
                      <span className="text-[12px] text-faint">{d(e.at)} · </span>
                      {e.kind === "guest_message" ? t("event.you") : e.kind === "created" ? t("event.received") : e.kind === "updated" ? t("event.updated") : ts(e.status ?? "requested")}
                      {e.body && <span className="block whitespace-pre-wrap">« {e.body} »</span>}
                    </li>
                  ))}
                </ol>
                {(s.status === "info_requested" || s.status === "requested") && <GuestReply token={token} serviceId={s.id} question={s.status === "info_requested"} />}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">{t("request.title")}</h2>
          <p className="mb-4 mt-1 text-[14px] text-muted">{t("request.text")}</p>
          <GuestRequestForm token={token} kinds={kinds} minDate={toLocal(new Date().toISOString())} />
        </Card>

        <Card className="p-5" data-testid="guest-problems">
          <h2 className="text-[17px] font-semibold">{t("problem.title")}</h2>
          <p className="mt-1 text-[14px] text-muted">{t("problem.text")}</p>
          {problems.length > 0 && (
            <ul className="mt-3 space-y-2">
              {problems.map((p) => (
                <li key={p.id} className="rounded-md border border-line p-3 text-[14px]" data-testid="guest-problem" data-status={p.status}>
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="flex-1">{tcat(p.category)}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", p.status === "resolved" ? "bg-success-soft text-success" : p.status === "in_progress" ? "bg-accent-soft text-accent-text" : "bg-subtle text-muted")}>
                      {t(`problem.status.${p.status}`)}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-muted">{p.description}</p>
                  {p.message && <p className="mt-2 whitespace-pre-wrap">« {p.message} »</p>}
                </li>
              ))}
            </ul>
          )}
          <GuestProblemForm token={token} />
        </Card>

        <Card className="p-5" data-testid="guest-messages">
          <h2 className="text-[17px] font-semibold">{t("contact.title")}</h2>
          <ul className="mt-3 space-y-2">
            {g.messages.map((m, i) => (
              <li key={i} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[15px]", m.author === "guest" ? "ms-auto bg-accent-soft" : "bg-subtle dark:bg-surface-hover")}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-[12px] text-faint">
                  {m.author === "guest" ? t("contact.you") : t("contact.team")} · {d(m.at)}
                </p>
              </li>
            ))}
          </ul>
          <GuestMessageForm token={token} />
        </Card>
        <p className="pb-6 text-center text-[13px] text-muted">{t("linkValid", { until: d(g.stay.link_valid_until) })}</p>
      </main>
    </div>
  );
}
