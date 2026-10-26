"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/halo/page-header";
import { ReadyGate } from "@/components/halo/ready-gate";
import { LinenJournal } from "@/components/linen/linen-journal";
import { LinenKits } from "@/components/linen/linen-kits";
import { LinenLaundry, useNewLaundryOrder } from "@/components/linen/linen-laundry";
import { LinenOverview } from "@/components/linen/linen-overview";
import { LinenSettingsPanel } from "@/components/linen/linen-settings";
import { LinenStock } from "@/components/linen/linen-stock";

export function Linen() {
  return (
    <ReadyGate>
      <LinenInner />
    </ReadyGate>
  );
}

function LinenInner() {
  const t = useTranslations();
  const [tab, setTab] = useState("overview");
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const newOrder = useNewLaundryOrder();
  const startOrder = () => {
    const id = newOrder();
    if (id) {
      setTab("laundry");
      setOpenOrder(id);
    }
  };

  return (
    <>
      <PageHeader
        title={t("nav.linen")}
        subtitle={t("linen.subtitle")}
        actions={
          <Button onClick={startOrder}>
            <Plus />
            {t("linen.newOrder")}
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t("nav.linen")}>
          <TabsTrigger value="overview">{t("linen.tabOverview")}</TabsTrigger>
          <TabsTrigger value="stock">{t("linen.tabStock")}</TabsTrigger>
          <TabsTrigger value="laundry">{t("linen.tabLaundry")}</TabsTrigger>
          <TabsTrigger value="kits">{t("linen.tabKits")}</TabsTrigger>
          <TabsTrigger value="journal">{t("linen.tabJournal")}</TabsTrigger>
          <TabsTrigger value="settings">{t("linen.tabSettings")}</TabsTrigger>
        </TabsList>
        <div className="pt-5">
          <TabsContent value="overview">
            <LinenOverview goTo={setTab} onNewOrder={startOrder} />
          </TabsContent>
          <TabsContent value="stock">
            <LinenStock />
          </TabsContent>
          <TabsContent value="laundry">
            <LinenLaundry openOrderId={openOrder} setOpenOrderId={setOpenOrder} />
          </TabsContent>
          <TabsContent value="kits">
            <LinenKits />
          </TabsContent>
          <TabsContent value="journal">
            <LinenJournal />
          </TabsContent>
          <TabsContent value="settings">
            <LinenSettingsPanel />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}
