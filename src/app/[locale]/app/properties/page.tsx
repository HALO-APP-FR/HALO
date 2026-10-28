import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { PropertyCreateForm } from "@/components/connected/property-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";

export default async function PropertiesPage({ params, searchParams }: PageProps<"/[locale]/app/properties">) {
  const { locale } = await params;
  const { first } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("connected.properties");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const { data, error } = await supabase.from("properties").select("id, name, city, address_line").eq("organization_id", org!.id).is("archived_at", null).order("name");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {first && <p className="mb-4 rounded-xl border border-accent bg-accent-soft p-4 text-[15px]" data-testid="config-saved">{t("afterOnboarding")}</p>}
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card className="divide-y divide-line self-start">
          {(data ?? []).length === 0 && <p className="p-5 text-[15px] text-muted">{t("empty")}</p>}
          {(data ?? []).map((p) => (
            <Link key={p.id} href={`/app/properties/${p.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-hover">
              <span className="flex-1">
                <span className="block text-[15px] font-medium">{p.name}</span>
                <span className="block text-[13px] text-muted">{[p.address_line, p.city].filter(Boolean).join(", ")}</span>
              </span>
              <ArrowRight className="size-4 text-faint rtl:-scale-x-100" />
            </Link>
          ))}
        </Card>
        <PropertyCreateForm />
      </div>
    </>
  );
}
