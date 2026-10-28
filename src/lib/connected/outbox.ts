import "server-only";
import nodemailer from "nodemailer";
import { getTranslations } from "next-intl/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { locales, type Locale } from "@/i18n/routing";

/** Service d'envoi : SMTP_URL complète, ou bien hôte + identifiant + mot de passe séparés (plus simples à saisir). */
function smtpTransport() {
  if (process.env.SMTP_URL) return nodemailer.createTransport(process.env.SMTP_URL);
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass } = process.env;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

export interface OutboxRow {
  id: string;
  recipient: string;
  locale: string;
  template: string;
  payload: Record<string, unknown>;
  organization_id: string;
}

/**
 * Envoie les e-mails en attente. L'état enregistré est TOUJOURS le résultat réel :
 *  - « sent » seulement si le serveur d'envoi a accepté le message ;
 *  - « not_configured » si aucun service d'envoi n'est configuré (rien n'est simulé) ;
 *  - « failed » avec l'erreur, relançable par un responsable.
 */
export async function processOutbox(orgId?: string) {
  const admin = supabaseAdmin();
  if (!admin) return { processed: 0, reason: "no_admin_key" as const };
  let q = admin.from("notification_outbox").select("id, recipient, locale, template, payload, organization_id").eq("status", "pending").order("created_at").limit(20);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data: rows } = await q;
  if (!rows?.length) return { processed: 0 };
  const transport = smtpTransport();
  const orgNames = new Map<string, string>();
  for (const row of rows as OutboxRow[]) {
    if (!transport) {
      await admin.from("notification_outbox").update({ status: "not_configured", last_error: "no_email_provider" }).eq("id", row.id);
      continue;
    }
    try {
      if (!orgNames.has(row.organization_id)) {
        const { data } = await admin.from("organizations").select("name").eq("id", row.organization_id).maybeSingle();
        orgNames.set(row.organization_id, (data?.name as string) ?? "HALO");
      }
      const locale = (locales as readonly string[]).includes(row.locale) ? (row.locale as Locale) : "en";
      const t = await getTranslations({ locale, namespace: "email" });
      const kind = typeof row.payload.kind === "string" ? (await getTranslations({ locale, namespace: "serviceKind" }))(row.payload.kind) : "";
      const message = typeof row.payload.message === "string" ? row.payload.message : "";
      const org = orgNames.get(row.organization_id)!;
      const subject = t(`${row.template}.subject`, { org, kind });
      const text = [t(`${row.template}.body`, { org, kind }), message ? `\n« ${message} »` : "", `\n${t("footer")}`].join("\n");
      await transport.sendMail({ from: process.env.EMAIL_FROM ?? "HALO <no-reply@halo.app>", to: row.recipient, subject, text });
      await admin.from("notification_outbox").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
    } catch (e) {
      const { data } = await admin.from("notification_outbox").select("attempts").eq("id", row.id).maybeSingle();
      await admin
        .from("notification_outbox")
        .update({ status: "failed", attempts: ((data?.attempts as number) ?? 0) + 1, last_error: String(e instanceof Error ? e.message : e).slice(0, 300) })
        .eq("id", row.id);
    }
  }
  return { processed: rows.length };
}
