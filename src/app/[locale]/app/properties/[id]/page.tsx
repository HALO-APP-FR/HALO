import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/halo/page-header";
import { GuideEditor } from "@/components/connected/property-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";

export default async function PropertyPage({ params }: PageProps<"/[locale]/app/properties/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.properties");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const [{ data: p }, { data: g }, { data: rooms }] = await Promise.all([
    supabase.from("properties").select("id, name, city, address_line, default_check_in, default_check_out").eq("organization_id", org!.id).eq("id", id).maybeSingle(),
    supabase.from("guest_guides").select("*").eq("organization_id", org!.id).eq("property_id", id).maybeSingle(),
    supabase.from("checklist_rooms").select("id, name, checklist_items(label, photo_required)").eq("organization_id", org!.id).eq("property_id", id).order("sort"),
  ]);
  if (!p) notFound();
  return (
    <>
      <PageHeader title={p.name} subtitle={[p.address_line, p.city].filter(Boolean).join(", ") || t("noAddress")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <GuideEditor propertyId={p.id} guide={g ?? {}} />
        <div className="self-start rounded-xl border border-line bg-surface p-5">
          <h2 className="text-[17px] font-semibold">{t("checklist")}</h2>
          {(rooms ?? []).length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">{t("noChecklist")}</p>
          ) : (
            <ul className="mt-2 space-y-2 text-[14px]">
              {(rooms ?? []).map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted"> — {(r.checklist_items as { label: string }[]).map((i) => i.label).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
