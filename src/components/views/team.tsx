"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Phone, Plus, UserRound, Users } from "lucide-react";
import { initialsOf, type Member, type MemberRole, type StaffPosition } from "@/lib/domain/types";
import { formatDuration, workedMinutes } from "@/lib/engine/learning";
import { addDaysToKey, localDateKey, zonedTimeToUtc } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { byId, taskDayKey } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import { Avatar } from "@/components/halo/avatar";
import { EmptyState } from "@/components/halo/empty-state";
import { isPlausiblePhone } from "@/components/halo/login-panel";
import { PageHeader } from "@/components/halo/page-header";
import { ReadyGate } from "@/components/halo/ready-gate";
import { cn } from "@/lib/utils";

export const POSITIONS: StaffPosition[] = ["housekeeper", "inspector", "maintenance", "laundry", "concierge", "driver", "chef", "other"];
const GROUPS: { key: string; positions: StaffPosition[] }[] = [
  { key: "groupCleaning", positions: ["housekeeper", "inspector", "laundry"] },
  { key: "groupMaintenance", positions: ["maintenance"] },
  { key: "groupConcierge", positions: ["concierge", "driver", "chef", "other"] },
];

const PALETTE = ["#0055FF", "#1F9D55", "#8E4EC6", "#B86E00", "#D92D20", "#0E7C86", "#C2185B", "#5B5BD6", "#4E5D6C", "#7A5C3E"];

export function Team() {
  return (
    <ReadyGate>
      <TeamInner />
    </ReadyGate>
  );
}

function TeamInner() {
  const t = useTranslations();
  const locale = useLocale();
  const members = useHalo((s) => s.members);
  const tasks = useHalo((s) => s.tasks);
  const properties = useHalo((s) => s.properties);
  const orgTz = useHalo((s) => s.org.timezone);
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const props = byId(properties);
  const todayKey = localDateKey(new Date(), orgTz);
  const weekEnd = addDaysToKey(todayKey, 6);

  const load = (id: string) =>
    tasks.filter((x) => {
      if (x.assigneeId !== id || x.status === "cancelled") return false;
      const k = taskDayKey(x, props.get(x.propertyId));
      return k >= todayKey && k <= weekEnd;
    }).length;

  // Heures pointées depuis lundi
  const monday = addDaysToKey(todayKey, -((new Date(`${todayKey}T12:00:00Z`).getUTCDay() + 6) % 7));
  const weekFrom = zonedTimeToUtc(monday, "00:00", orgTz);
  const nowEnd = zonedTimeToUtc(addDaysToKey(todayKey, 1), "00:00", orgTz);
  const hours = (id: string) => workedMinutes(tasks, id, weekFrom, nowEnd).minutes;

  const groups: { title: string; list: Member[] }[] = [
    ...GROUPS.map((g) => ({
      title: t(`team.${g.key}`),
      list: members.filter((m) => m.role === "agent" && g.positions.includes(m.position ?? "housekeeper")),
    })).filter((g) => g.list.length > 0),
    { title: t("team.managers"), list: members.filter((m) => m.role !== "agent") },
  ];
  if (groups.length === 1) groups.unshift({ title: t("team.agents"), list: [] });

  return (
    <>
      <PageHeader
        title={t("nav.team")}
        subtitle={t("team.count", { count: members.filter((m) => m.role === "agent" && m.active).length })}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            {t("team.add")}
          </Button>
        }
      />
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-micro text-muted">{g.title}</h2>
            {g.list.length === 0 ? (
              <Card>
                <EmptyState icon={Users} title={t("team.emptyAgents")} text={t("team.emptyAgentsText")} className="py-8" />
              </Card>
            ) : (
              <Card className="divide-y divide-line">
                {g.list.map((m) => (
                  <button key={m.id} type="button" onClick={() => setEditing(m)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-hover md:px-5", !m.active && "opacity-50")}>
                    <Avatar initials={initialsOf(m.name)} color={m.color} size="lg" className="ring-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-semibold">{m.name}</span>
                        <Badge>{m.role === "agent" ? t(`position.${m.position ?? "housekeeper"}`) : t(`role.${m.role}`)}</Badge>
                        {!m.active && <Badge tone="warning">{t("team.inactive")}</Badge>}
                      </span>
                      {m.phone && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-caption text-muted tabular">
                          <Phone className="size-3.5" />
                          {m.phone}
                        </span>
                      )}
                    </span>
                    {m.role === "agent" && (
                      <span className="flex shrink-0 gap-5 text-end">
                        <span className="hidden sm:block">
                          <span className="block text-title-3 tabular">{formatDuration(hours(m.id), locale)}</span>
                          <span className="block text-caption text-muted">{t("team.hoursWeek")}</span>
                        </span>
                        <span>
                          <span className="block text-title-3 tabular">{load(m.id)}</span>
                          <span className="block text-caption text-muted">{t("team.next7")}</span>
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </Card>
            )}
          </section>
        ))}
      </div>
      <MemberSheet member={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function MemberSheet({ member, onClose }: { member: Member | "new" | null; onClose: () => void }) {
  if (!member) return null;
  return <MemberSheetInner key={member === "new" ? "new" : member.id} member={member} onClose={onClose} />;
}

function MemberSheetInner({ member, onClose }: { member: Member | "new"; onClose: () => void }) {
  const t = useTranslations();
  const count = useHalo((s) => s.members.length);
  const isNew = member === "new";
  const [name, setName] = useState(isNew ? "" : member.name);
  const [phone, setPhone] = useState(isNew ? "" : member.phone ?? "");
  const [role, setRole] = useState<MemberRole>(isNew ? "agent" : member.role);
  const [position, setPosition] = useState<StaffPosition>(isNew ? "housekeeper" : member.position ?? "housekeeper");
  const [color, setColor] = useState(isNew ? PALETTE[count % PALETTE.length] : member.color);
  const [active, setActive] = useState(isNew ? true : member.active);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!name.trim()) err.name = t("form.required");
    if (role === "agent" && !isPlausiblePhone(phone)) err.phone = t("auth.invalidPhone");
    setErrors(err);
    if (Object.keys(err).length) return;
    const { addMember, updateMember } = useHalo.getState();
    if (isNew) {
      addMember({ name: name.trim(), phone: phone.trim() || undefined, role, color, position: role === "agent" ? position : undefined });
      toast(t("team.added", { name: name.trim() }));
    } else {
      updateMember(member.id, {
        name: name.trim(),
        phone: phone.trim() || undefined,
        role: member.role === "owner" ? "owner" : role,
        position: role === "agent" ? position : undefined,
        color,
        active,
      });
      toast(t("form.saved"));
    }
    onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={isNew ? t("team.add") : name || t("team.member")} closeLabel={t("common.close")}>
        <form onSubmit={submit} noValidate className="space-y-4 pt-2">
          <div className="flex justify-center py-2">
            <Avatar initials={name ? initialsOf(name) : "?"} color={color} size="lg" className="size-16 text-[22px] ring-0" />
          </div>
          <Field label={t("team.name")} htmlFor="m-name" error={errors.name}>
            <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus={isNew} />
          </Field>
          <Field label={t("auth.phone")} htmlFor="m-phone" error={errors.phone} hint={t("team.phoneHint")}>
            <Input id="m-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("auth.phonePlaceholder")} className="tabular" />
          </Field>
          {(isNew || member.role !== "owner") && (
            <Field label={t("team.role")} htmlFor="m-role">
              <Select id="m-role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
                <option value="agent">{t("role.agent")}</option>
                <option value="manager">{t("role.manager")}</option>
              </Select>
            </Field>
          )}
          {role === "agent" && (
            <Field label={t("team.position")} htmlFor="m-position" hint={t("team.positionHint")}>
              <Select id="m-position" value={position} onChange={(e) => setPosition(e.target.value as StaffPosition)}>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {t(`position.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-muted">{t("team.color")}</legend>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={c}
                  aria-pressed={color === c}
                  className={cn("size-9 rounded-full ring-offset-2 ring-offset-surface transition-shadow", color === c && "ring-2 ring-fg")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </fieldset>
          {!isNew && member.role !== "owner" && (
            <SwitchRow id="m-active" label={t("team.active")} description={t("team.activeHint")} checked={active} onCheckedChange={setActive} />
          )}
          {isNew && role === "agent" && (
            <p className="flex items-start gap-2 rounded-lg bg-subtle p-3 text-caption text-muted dark:bg-surface-hover">
              <UserRound className="mt-0.5 size-4 shrink-0" />
              {t("team.inviteSoon")}
            </p>
          )}
          <Button type="submit" size="xl">
            {isNew ? t("team.add") : t("form.save")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
