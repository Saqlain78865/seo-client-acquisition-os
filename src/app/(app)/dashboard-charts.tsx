"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/utils";

const axis = { fontSize: 11, fill: "var(--text-muted)" };
const tooltipStyle = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--text)",
  },
  cursor: { fill: "var(--surface-2)" },
};

export function ProspectsOverTimeChart({ data }: { data: { label: string; prospects: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} formatter={(v) => [v, "Prospects created"]} labelFormatter={(l) => `Week of ${l}`} />
        <Bar dataKey="prospects" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBarChart({
  data,
  dataKey,
  categoryKey,
  name,
  currency,
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  categoryKey: string;
  name: string;
  /** When set, values are formatted as money in this currency. */
  currency?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(data.length * 34 + 20, 120)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey={categoryKey} tick={axis} tickLine={false} axisLine={false} width={130} />
        <Tooltip {...tooltipStyle} formatter={(v) => [currency ? formatMoney(Number(v), currency) : v, name]} />
        <Bar dataKey={dataKey} fill="var(--primary)" radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DeliveryChart({ data }: { data: { channel: string; accepted: number; failed: number; manual: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="channel" tick={axis} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="accepted" name="Accepted by provider" stackId="a" fill="var(--primary)" maxBarSize={40} />
        <Bar dataKey="manual" name="Opened for manual send" stackId="a" fill="var(--info)" maxBarSize={40} />
        <Bar dataKey="failed" name="Failed" stackId="a" fill="var(--danger)" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}
