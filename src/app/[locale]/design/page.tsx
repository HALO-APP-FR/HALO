import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, Inbox, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DesignInteractive } from "@/components/halo/design-interactive";
import { EmptyState } from "@/components/halo/empty-state";
import { KpiCard } from "@/components/halo/kpi-card";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { Logo } from "@/components/halo/logo";
import { StatusPill } from "@/components/halo/status-pill";
import { TaskCard } from "@/components/halo/task-card";
import { TaskTypeIcon } from "@/components/halo/task-type";
import { ThemeSwitcher } from "@/components/halo/theme-switcher";
import type { TaskStatus, TaskType } from "@/lib/domain/types";
import { buildDemoData } from "@/lib/store/seed";

const STATUSES: TaskStatus[] = ["unassigned", "assigned", "in_progress", "done", "to_redo", "validated", "cancelled"];
const TYPES: TaskType[] = ["turnover", "check_in", "check_out", "linen_delivery", "linen_pickup", "inspection", "other"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-10">
      <h2 className="mb-6 text-micro text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default async function DesignPage({ params }: PageProps<"/[locale]/design">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection(); // « maintenant » = l\'heure de la requête, pas celle du build
  const t = await getTranslations();
  const now = new Date();
  const demo = buildDemoData(now, locale);
  const prop = (id: string) => demo.properties.find((p) => p.id === id)!;
  const samples = demo.tasks.filter((x) => x.assigneeId).slice(0, 3);

  return (
    <div className="min-h-dvh bg-subtle">
      <div className="mx-auto max-w-5xl px-4 py-10 md:px-8 md:py-16">
        <header className="flex flex-wrap items-start justify-between gap-6 pb-10">
          <div>
            <Logo />
            <h1 className="mt-8 text-display">{t("design.title")}</h1>
            <p className="mt-2 text-body text-muted">{t("design.intro")}</p>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeSwitcher />
          </div>
        </header>

        <Section title={t("design.buttons")}>
          <div className="flex flex-wrap items-center gap-3">
            <Button>
              <Plus />
              {t("design.primary")}
            </Button>
            <Button variant="secondary">{t("design.secondary")}</Button>
            <Button variant="outline">{t("design.outline")}</Button>
            <Button variant="ghost">{t("design.ghost")}</Button>
            <Button variant="danger">
              <Trash2 />
              {t("design.danger")}
            </Button>
          </div>
          <div className="mt-6 max-w-sm space-y-3">
            <Input placeholder="Loft Marais" aria-label="Exemple" />
            <Button size="xl">
              {t("task.start")}
              <ArrowRight />
            </Button>
          </div>
        </Section>

        <Section title={t("design.statuses")}>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {STATUSES.map((s) => (
              <StatusPill key={s} status={s} />
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Badge tone="danger">{t("priority.high")}</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="success">OK</Badge>
            <Badge tone="warning">{t("taskStatus.done")}</Badge>
            <Badge>{t("common.demoData")}</Badge>
          </div>
          <div className="mt-6 flex flex-wrap gap-4">
            {TYPES.map((type) => (
              <span key={type} className="flex items-center gap-2 text-caption text-muted">
                <TaskTypeIcon type={type} />
                {t(`taskType.${type}`)}
              </span>
            ))}
          </div>
        </Section>

        <Section title={t("design.taskCards")}>
          <div className="grid gap-4 md:grid-cols-2">
            {samples.map((task) => (
              <TaskCard key={task.id} task={task} property={prop(task.propertyId)} reference={now} />
            ))}
          </div>
        </Section>

        <Section title={t("design.states")}>
          <div className="grid gap-4 md:grid-cols-3">
            <KpiCard label={t("managerToday.kpiCleanings")} value={12} icon={Sparkles} />
            <Card className="space-y-3 p-5" aria-label={t("design.loading")}>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </Card>
            <Card>
              <EmptyState icon={Inbox} title={t("design.empty")} text={t("agentToday.emptyText")} className="py-8" />
            </Card>
          </div>
          <div className="mt-6">
            <DesignInteractive />
          </div>
        </Section>
      </div>
    </div>
  );
}
