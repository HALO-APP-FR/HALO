import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AlertTriangle, ArrowRight, CircleCheck, DoorClosed, KeyRound, Sparkles, UserRoundX } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DayTimeline } from "@/components/halo/day-timeline";
import { KpiCard } from "@/components/halo/kpi-card";
import { PageHeader } from "@/components/halo/page-header";
import { demoAgents, demoProperties, getDemoDay } from "@/lib/demo/data";

export async function generateMetadata({ params }: PageProps<"/[locale]/today">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("today") };
}

export default async function ManagerTodayPage({ params }: PageProps<"/[locale]/today">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection(); // « maintenant » = l\'heure de la requête, pas celle du build
  const t = await getTranslations();
  const now = new Date();
  const day = getDemoDay(now);
  const orgTz = "Europe/Paris";

  const cleanings = day.tasks.filter((x) => x.type === "turnover");
  const unassigned = day.tasks.filter((x) => x.status === "unassigned");
  const toValidate = day.tasks.filter((x) => x.status === "done");
  const dateLabel = new Intl.DateTimeFormat(locale, { timeZone: orgTz, weekday: "long", day: "numeric", month: "long" }).format(now);

  const actions = [
    unassigned.length > 0 && {
      key: "unassigned",
      icon: UserRoundX,
      tone: "text-danger bg-danger-soft",
      label: t("managerToday.unassignedCount", { count: unassigned.length }),
      cta: t("managerToday.assign"),
      href: "/planning",
      primary: true,
    },
    toValidate.length > 0 && {
      key: "validate",
      icon: CircleCheck,
      tone: "text-warning bg-warning-soft",
      label: t("managerToday.toValidateCount", { count: toValidate.length }),
      cta: t("managerToday.review"),
      href: "/tasks",
      primary: false,
    },
    day.urgentIncidents > 0 && {
      key: "incident",
      icon: AlertTriangle,
      tone: "text-danger bg-danger-soft",
      label: t("managerToday.incidentCount", { count: day.urgentIncidents }),
      cta: t("managerToday.view"),
      href: "/tasks",
      primary: false,
    },
  ].filter(Boolean) as Array<{
    key: string;
    icon: typeof UserRoundX;
    tone: string;
    label: string;
    cta: string;
    href: "/planning" | "/tasks";
    primary: boolean;
  }>;

  return (
    <>
      <PageHeader
        title={t("managerToday.title")}
        subtitle={dateLabel}
        actions={<Badge tone="neutral">{t("common.demoData")}</Badge>}
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiCard label={t("managerToday.kpiArrivals")} value={day.arrivals} icon={KeyRound} />
        <KpiCard label={t("managerToday.kpiDepartures")} value={day.departures} icon={DoorClosed} />
        <KpiCard label={t("managerToday.kpiCleanings")} value={cleanings.length} icon={Sparkles} />
        <KpiCard label={t("managerToday.kpiIncidents")} value={day.openIncidents} icon={AlertTriangle} tone="danger" />
      </section>

      {actions.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("managerToday.toHandle")}</CardTitle>
          </CardHeader>
          <ul className="mt-2 divide-y divide-line">
            {actions.map(({ key, icon: Icon, tone, label, cta, href, primary }) => (
              <li key={key} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-md ${tone}`}>
                    <Icon className="size-[18px]" strokeWidth={1.9} />
                  </span>
                  <span className="text-[15px] font-medium">{label}</span>
                </span>
                <Button asChild size="sm" variant={primary ? "primary" : "secondary"}>
                  <Link href={href}>
                    {cta}
                    <ArrowRight className="rtl:-scale-x-100" />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>{t("managerToday.timeline")}</CardTitle>
            <p className="mt-1 hidden text-caption text-muted md:block">{t("managerToday.timelineHint")}</p>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <DayTimeline tasks={day.tasks} properties={demoProperties} agents={demoAgents} now={now} />
          <p className="mt-4 text-caption text-muted">{t("common.localTimeNote")}</p>
        </CardContent>
      </Card>
    </>
  );
}
