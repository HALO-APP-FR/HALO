import { Baby, CarFront, ChefHat, ConciergeBell, Flower2, HandHeart, Plane, ShoppingBasket, Ticket, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { Member, ServiceKind, StaffPosition } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export const SERVICE_KINDS: ServiceKind[] = [
  "private_chef",
  "restaurant",
  "driver",
  "airport_transfer",
  "grocery",
  "spa",
  "babysitter",
  "experience",
  "flowers",
  "other",
];

export const SERVICE_ICON: Record<ServiceKind, LucideIcon> = {
  private_chef: ChefHat,
  restaurant: UtensilsCrossed,
  driver: CarFront,
  airport_transfer: Plane,
  grocery: ShoppingBasket,
  spa: HandHeart,
  babysitter: Baby,
  experience: Ticket,
  flowers: Flower2,
  other: ConciergeBell,
};

/** Poste le mieux placé pour chaque prestation (suggestion d'assignation). */
export const SERVICE_POSITION: Record<ServiceKind, StaffPosition> = {
  private_chef: "chef",
  restaurant: "concierge",
  driver: "driver",
  airport_transfer: "driver",
  grocery: "concierge",
  spa: "concierge",
  babysitter: "concierge",
  experience: "concierge",
  flowers: "concierge",
  other: "concierge",
};

/** Personnel trié : poste adapté d'abord. */
export function staffFor(kind: ServiceKind, staff: Member[]) {
  const best = SERVICE_POSITION[kind];
  return [...staff].sort((a, b) => Number(b.position === best) - Number(a.position === best) || a.name.localeCompare(b.name));
}

export function ServiceIcon({ kind, className }: { kind: ServiceKind; className?: string }) {
  const Icon = SERVICE_ICON[kind];
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg bg-vip-soft text-vip", className)} aria-hidden>
      <Icon className="size-5" strokeWidth={1.9} />
    </span>
  );
}

export const SERVICE_STATUS_TONE = { requested: "warning", confirmed: "accent", done: "success", cancelled: "neutral" } as const;
