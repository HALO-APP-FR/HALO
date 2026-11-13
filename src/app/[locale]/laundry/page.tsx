import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { LogoMark } from "@/components/halo/logo";
import { EnvBadge } from "@/components/connected/env-badge";
import { SignOutButton } from "@/components/connected/shell-client";
import { PartnerOrderCard, type OrderView } from "@/components/connected/laundry";
import { getContext } from "@/lib/connected/context";
import { isConnected } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";

/**
 * Espace blanchisseur : uniquement SES commandes (fonction laundry_my_orders). Aucune navigation vers les logements,
 * les voyageurs, les missions ou la messagerie : cet espace n'a pas d'autre page.
 */
export default async function LaundrySpace({ params }: PageProps<"/[locale]/laundry">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.laundry");
  const tc = await getTranslations("connected");
  if (!isConnected()) return <p className="mx-auto max-w-lg p-8 text-[15px] text-muted">{tc("notConfigured")}</p>;
  const { supabase, user, orgs } = await getContext();
  if (!user) redirect({ href: { pathname: "/auth/sign-in", query: { next: "/laundry" } }, locale });
  const [{ data: isPartner, error: e1 }, { data: raw }] = await Promise.all([supabase.rpc("laundry_is_partner"), supabase.rpc("laundry_my_orders")]);
  const orders = ((raw ?? []) as OrderView[] & { expected_back_at?: string }[]).map((o) => {
    const r = o as unknown as Record<string, unknown>;
    return {
      id: r.id as string,
      reference: r.reference as string,
      partnerName: r.partner as string,
      client: r.client as string,
      status: r.status as OrderView["status"],
      sentAt: r.sent_at as string,
      expectedBackAt: r.expected_back_at as string,
      deliveredAt: (r.delivered_at as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      late: Boolean(r.late),
      lines: ((r.lines as Record<string, unknown>[]) ?? []).map((l) => ({ itemId: l.item as string, label: l.label as string, sent: l.sent as number, received: (l.received as number | null) ?? null, returned: (l.returned as number | null) ?? null, confirmed: (l.confirmed as number | null) ?? null })),
      events: ((r.events as Record<string, unknown>[]) ?? []).map((e) => ({ kind: e.kind as string, side: e.side as "concierge" | "laundry", at: e.at as string, note: (e.note as string | null) ?? null })),
    } satisfies OrderView;
  });
  const open = orders.filter((o) => o.status !== "delivered" && o.status !== "cancelled");
  // Ce que le blanchisseur a à faire, dans l'ordre : recevoir, traiter, livrer ; puis ce qui attend la conciergerie
  const groups = [
    { key: "toReceive", list: open.filter((o) => o.status === "sent") },
    { key: "toProcess", list: open.filter((o) => o.status === "received") },
    { key: "toDeliver", list: open.filter((o) => o.status === "processing" || o.status === "ready") },
    { key: "onTheWay", list: open.filter((o) => o.status === "out_for_delivery") },
  ] as const;
  const closed = orders.filter((o) => !open.includes(o));
  return (
    <div className="min-h-dvh bg-subtle" data-testid="laundry-space">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 md:px-8">
        <LogoMark className="size-7 text-fg" />
        <span className="text-[15px] font-semibold">{t("spaceTitle")}</span>
        <EnvBadge />
        <span className="ms-auto">
          <SignOutButton label={tc("signOut")} email={user!.email ?? ""} />
        </span>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        {e1 ? (
          <p className="text-[15px] text-muted" data-testid="laundry-space-unavailable">{t("unavailable")}</p>
        ) : !isPartner ? (
          <div className="rounded-xl border border-line bg-surface p-5" data-testid="laundry-no-access">
            <p className="text-[15px] font-semibold">{t("noAccessTitle")}</p>
            <p className="mt-1 text-[14px] text-muted">{t("noAccessText", { email: user!.email ?? "" })}</p>
            {orgs.length > 0 && (
              <a href={`/${locale}/app`} className="mt-3 inline-flex text-[14px] font-medium text-accent-text">
                {t("backToApp")}
              </a>
            )}
          </div>
        ) : (
          <>
            <h1 className="text-title-2">{t("myOrders")}</h1>
            <p className="mt-1 text-[14px] text-muted">{t("spaceIntro")}</p>
            {open.length === 0 ? (
              <p className="mt-6 rounded-xl border border-dashed border-line bg-surface p-5 text-[14px] text-muted" data-testid="partner-orders-empty">{t("partnerEmpty")}</p>
            ) : (
              <>
                <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="partner-summary">
                  {groups.map((g) => (
                    <li key={g.key}>
                      <a href={`#g-${g.key}`} className={cn("block rounded-lg border border-line bg-surface px-3 py-2", g.list.length ? "" : "opacity-60")} data-testid={`partner-count-${g.key}`} data-count={g.list.length}>
                        <span className="block text-title-2 tabular">{g.list.length}</span>
                        <span className="block text-[13px] text-muted">{t(`group.${g.key}`)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
                {groups
                  .filter((g) => g.list.length)
                  .map((g) => (
                    <section key={g.key} id={`g-${g.key}`} className="mt-6 scroll-mt-4" data-testid={`partner-group-${g.key}`}>
                      <h2 className="text-[15px] font-semibold">{t(`group.${g.key}`)}</h2>
                      <ul className="mt-2 space-y-4">
                        {g.list.map((o) => (
                          <PartnerOrderCard key={o.id} o={o} />
                        ))}
                      </ul>
                    </section>
                  ))}
              </>
            )}
            {closed.length > 0 && (
              <details className="mt-8">
                <summary className="cursor-pointer text-[15px] font-semibold">{t("closedOrders", { count: closed.length })}</summary>
                <ul className="mt-3 space-y-4">
                  {closed.map((o) => (
                    <PartnerOrderCard key={o.id} o={o} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </main>
    </div>
  );
}
