import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { Link } from "@/i18n/navigation";

/** Point d'entrée « Vous utilisez déjà un logiciel ? » (première configuration et réglages). */
export function ImportEntry({ title, text }: { title: string; text: string }) {
  return (
    <Link href="/app/import" className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-canvas p-4 hover:bg-surface-hover" data-testid="import-entry">
      <FileSpreadsheet className="size-6 shrink-0 text-accent-text" />
      <span className="flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[14px] text-muted">{text}</span>
      </span>
      <ArrowRight className="size-5 text-accent-text rtl:-scale-x-100" />
    </Link>
  );
}
