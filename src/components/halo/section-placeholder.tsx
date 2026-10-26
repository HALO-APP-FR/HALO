import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

export function SectionPlaceholder({ titleKey, icon }: { titleKey: string; icon: LucideIcon }) {
  const t = useTranslations();
  const title = t(`nav.${titleKey}`);
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState icon={icon} title={title} text={t("common.comingSoon")} />
      </Card>
    </>
  );
}
