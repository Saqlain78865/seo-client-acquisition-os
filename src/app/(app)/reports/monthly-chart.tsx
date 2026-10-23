"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { fontSize: 11, fill: "var(--text-muted)" };

export function MonthlyChart({ data }: { data: { label: string; prospects: number; audits: number; proposals: number; won: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" }} cursor={{ fill: "var(--surface-2)" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="prospects" name="Prospects" fill="var(--border)" maxBarSize={14} radius={[3, 3, 0, 0]} />
        <Bar dataKey="audits" name="Audits" fill="var(--info)" maxBarSize={14} radius={[3, 3, 0, 0]} />
        <Bar dataKey="proposals" name="Proposals" fill="var(--primary)" maxBarSize={14} radius={[3, 3, 0, 0]} />
        <Bar dataKey="won" name="Won" fill="var(--success)" maxBarSize={14} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
