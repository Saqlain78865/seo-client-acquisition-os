import {
  BarChart3,
  BellRing,
  CalendarClock,
  Briefcase,
  FileSearch,
  FileText,
  Globe2,
  KanbanSquare,
  Layers,
  LayoutDashboard,
  MessageSquareText,
  Plug,
  ScanSearch,
  ServerCog,
  Settings,
  UserCog,
  Users,
} from "lucide-react";

export const NAV_GROUPS = [
  {
    label: "Win clients",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/audits/new", label: "New Website Audit", icon: ScanSearch },
      { href: "/audits/bulk", label: "Bulk Audit", icon: Layers },
      { href: "/prospects", label: "Prospects", icon: Users },
      { href: "/audits", label: "Audit Reports", icon: FileSearch },
      { href: "/proposals", label: "SEO Proposals", icon: FileText },
      { href: "/follow-ups", label: "Follow-ups", icon: BellRing },
      { href: "/campaigns", label: "Auto-send", icon: CalendarClock },
      { href: "/deals", label: "Clients and Deals", icon: Briefcase },
      { href: "/work", label: "Client Work", icon: KanbanSquare },
      { href: "/websites", label: "My Websites", icon: Globe2 },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/templates", label: "Message Templates", icon: MessageSquareText },
      { href: "/reports", label: "Reports and Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/account", label: "Account & Team", icon: UserCog },
      { href: "/system", label: "System", icon: ServerCog, adminOnly: true },
    ],
  },
] as const;

type NavItem = (typeof NAV_GROUPS)[number]["items"][number];
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g): readonly NavItem[] => g.items);

/** The most specific nav item that matches the path ("/audits/new" must not also light up "/audits"). */
export function activeNavHref(pathname: string) {
  let best: string | null = null;
  for (const item of NAV_ITEMS) {
    const match = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
    if (match && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}
