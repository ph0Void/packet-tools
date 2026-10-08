import type { LucideIcon } from "lucide-react";
import { ItemCard, type Tone } from "./dashboard/item/ItemCard";

export interface StatCardData {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone: Tone;
}

interface StatsCardsProps {
  stats: StatCardData[];
}

export default function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, i) => (
        <ItemCard
          key={stat.label}
          label={stat.label}
          value={stat.value}
          hint={stat.hint}
          icon={<stat.icon />}
          tone={stat.tone}
          delay={i * 60}
        />
      ))}
    </div>
  );
}
