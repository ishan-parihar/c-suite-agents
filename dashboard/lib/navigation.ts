import {
  LayoutDashboard,
  Activity,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Sun,
  FolderKanban,
  CheckSquare,
  Users,
  Columns,
  BarChart3,
  Receipt,
  Landmark,
  Megaphone,
  FileText,
  Pen,
  UsersRound,
  Network,
  Apple,
  Mail,
  Cpu,
  FileBarChart,
  Settings,
  Target,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  separator?: boolean;
}

export interface NavSection {
  section: string;
  items: NavItem[];
}

export const navigation: NavSection[] = [
  {
    section: "Overview",
    items: [
      { href: "/", label: "Daily Briefing", icon: LayoutDashboard },
      { href: "/monitor", label: "Project Monitor", icon: Activity },
    ],
  },
  {
    section: "Temporal",
    items: [
      { href: "/years", label: "Years", icon: Calendar },
      { href: "/quarters", label: "Quarters", icon: CalendarClock },
      { href: "/months", label: "Months", icon: CalendarDays },
      { href: "/weeks", label: "Weeks", icon: CalendarRange },
      { href: "/days", label: "Days", icon: Sun },
    ],
  },
  {
    section: "Operations",
    items: [
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
      { href: "/people", label: "People", icon: Users },
      { href: "/kanban", label: "Kanban Board", icon: Columns },
    ],
  },
  {
    section: "Financial",
    items: [
      { href: "/financial", label: "Dashboard", icon: BarChart3 },
      { href: "/financial/transactions", label: "Transactions", icon: Receipt },
      { href: "/financial/accounts", label: "Accounts", icon: Landmark },
    ],
  },
  {
    section: "Marketing",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/content", label: "Content Pipeline", icon: FileText },
      { href: "/calendar", label: "Calendar", icon: Calendar },
    ],
  },
  {
    section: "Journals",
    items: [
      { href: "/journals/subjective", label: "Subjective", icon: Pen },
      { href: "/journals/relational", label: "Relational", icon: UsersRound },
      { href: "/journals/systemic", label: "Systemic", icon: Network },
      { href: "/journals/diet", label: "Diet Log", icon: Apple },
    ],
  },
  {
    section: "Knowledge",
    items: [
      { href: "/notes", label: "Notes", icon: FileText },
    ],
  },
  {
    section: "Goals",
    items: [
      { href: "/goals", label: "Goals Dashboard", icon: Target },
    ],
  },
  {
    section: "Ops",
    items: [
      { href: "/meetings", label: "Board Meetings", icon: Users },
      { href: "/messages", label: "Messages", icon: Mail },
      { href: "/sessions", label: "Agent Sessions", icon: Cpu },
      { href: "/ops-reports", label: "Reports", icon: FileBarChart },
    ],
  },
  {
    section: "",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, separator: true },
    ],
  },
];

export const allNavItems = navigation.flatMap((s) => s.items);
export const navItemMap = new Map(allNavItems.map((item) => [item.href, item]));
