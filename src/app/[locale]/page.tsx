import { redirect } from "@/i18n/navigation";

// Phase 2 : redirection selon le rôle (manager → /today, agent → /a/today)
export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  redirect({ href: "/today", locale });
}
