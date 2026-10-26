"use client";

import { useLocale, useTranslations } from "next-intl";
import { Archive, ArchiveRestore, ArrowLeft, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { timezoneLabel } from "@/lib/domain/geo";
import { useHalo } from "@/lib/store/halo-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/halo/empty-state";
import { PropertyCalendar } from "@/components/halo/property-calendar";
import { PropertyAccessForm, PropertyBedsForm, PropertyChecklistEditor, PropertyInfoForm } from "@/components/halo/property-forms";
import { ReadyGate } from "@/components/halo/ready-gate";

export function PropertyDetail({ id }: { id: string }) {
  return (
    <ReadyGate>
      <PropertyDetailInner id={id} />
    </ReadyGate>
  );
}

function PropertyDetailInner({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const property = useHalo((s) => s.properties.find((p) => p.id === id));
  const orgTz = useHalo((s) => s.org.timezone);

  if (!property) {
    return (
      <Card>
        <EmptyState
          icon={Building2}
          title={t("propertyDetail.notFound")}
          action={
            <Button asChild variant="secondary">
              <Link href="/properties">{t("nav.properties")}</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <Link href="/properties" className="-ms-2 mb-3 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[14px] font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("nav.properties")}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title-1">{property.name}</h1>
            {property.archived && <Badge>{t("properties.archived")}</Badge>}
          </div>
          <p className="mt-1 text-body text-muted">
            {[property.addressLine, property.area, property.city].filter(Boolean).join(" · ")}
            {property.timezone !== orgTz && ` · ${timezoneLabel(property.timezone, locale)}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            useHalo.getState().setArchived(property.id, !property.archived);
            toast(property.archived ? t("propertyDetail.restored") : t("propertyDetail.archivedToast"));
          }}
        >
          {property.archived ? <ArchiveRestore /> : <Archive />}
          {property.archived ? t("propertyDetail.restore") : t("propertyDetail.archive")}
        </Button>
      </header>

      <Tabs defaultValue="calendar">
        <TabsList aria-label={property.name}>
          <TabsTrigger value="calendar">{t("propertyDetail.tabCalendar")}</TabsTrigger>
          <TabsTrigger value="info">{t("propertyDetail.tabInfo")}</TabsTrigger>
          <TabsTrigger value="access">{t("propertyDetail.tabAccess")}</TabsTrigger>
          <TabsTrigger value="beds">{t("propertyDetail.tabBeds")}</TabsTrigger>
          <TabsTrigger value="checklist">{t("propertyDetail.tabChecklist")}</TabsTrigger>
        </TabsList>
        <div className="pt-5">
          <TabsContent value="calendar">
            <PropertyCalendar property={property} />
          </TabsContent>
          <TabsContent value="info">
            <PropertyInfoForm key={property.id} property={property} />
          </TabsContent>
          <TabsContent value="access">
            <PropertyAccessForm key={property.id} property={property} />
          </TabsContent>
          <TabsContent value="beds">
            <PropertyBedsForm key={property.id} property={property} />
          </TabsContent>
          <TabsContent value="checklist">
            <PropertyChecklistEditor property={property} />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}
