import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { GuestGuideView } from "@/components/views/guest-guide";

export const metadata: Metadata = {
  title: "HALO",
  // Lien privé du voyageur : jamais indexé par les moteurs de recherche
  robots: { index: false, follow: false },
};

export default async function GuestPage({ params, searchParams }: PageProps<"/[locale]/g/[token]">) {
  const { locale, token } = await params;
  const { s } = await searchParams;
  setRequestLocale(locale);
  return <GuestGuideView token={token} stayId={typeof s === "string" ? s : undefined} />;
}
