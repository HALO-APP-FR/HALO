import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export async function SatisfactionNav({ current }: { current: "reviews" | "owners" | "showcase" }) {
  const t = await getTranslations("connected.reviews.tabs");
  const tabs = [
    ["reviews", "/app/satisfaction"],
    ["owners", "/app/satisfaction/owners"],
    ["showcase", "/app/satisfaction/showcase"],
  ] as const;
  return (
    <nav className="mb-5 flex flex-wrap gap-2 text-[14px]">
      {tabs.map(([k, href]) => (
        <Link key={k} href={href} className={cn("rounded-full px-3 py-1", current === k ? "bg-fg text-canvas" : "bg-subtle dark:bg-surface-hover")} data-testid={`sat-tab-${k}`}>
          {t(k)}
        </Link>
      ))}
    </nav>
  );
}
