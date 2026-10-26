import {
  AirVent, Baby, Bath, BedDouble, Briefcase, Car, CookingPot, Coffee, Flame, FlameKindling, Refrigerator, Shirt, Snowflake,
  Sofa, Sprout, ShieldCheck, Sun, Thermometer, Tv, Utensils, WashingMachine, Waves, Wifi, Wind, Zap, ArrowUpDown,
  Microwave, Lock, BriefcaseMedical, Trees, CircleDot, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  terrace: Sun, balcony: Sun, garden: Trees, pool: Waves, hot_tub: Bath, bbq: FlameKindling, outdoor_furniture: Sofa,
  parking: Car, garage: Car, ev_charger: Zap,
  oven: CookingPot, microwave: Microwave, hob: Flame, fridge: Refrigerator, freezer: Snowflake, dishwasher: Utensils,
  coffee_machine: Coffee, kettle: Coffee, toaster: Utensils, cookware: CookingPot,
  washing_machine: WashingMachine, dryer: WashingMachine, iron: Shirt, vacuum: Wind, hair_dryer: Wind,
  wifi: Wifi, tv: Tv, air_conditioning: AirVent, heating: Thermometer, fireplace: Flame, fan: Wind, workspace: Briefcase, elevator: ArrowUpDown,
  baby_cot: Baby, high_chair: Baby, baby_bath: Bath, safety_gates: ShieldCheck,
  smoke_detector: ShieldCheck, co_detector: ShieldCheck, fire_extinguisher: ShieldCheck, first_aid_kit: BriefcaseMedical, safe: Lock,
  bed: BedDouble, plant: Sprout,
};

export function AmenityIcon({ amenity, className }: { amenity: string; className?: string }) {
  const Icon = ICONS[amenity] ?? CircleDot;
  return <Icon className={className ?? "size-4"} strokeWidth={1.8} aria-hidden />;
}
