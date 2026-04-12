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
  Crown,
  Cog,
  Brain,
  Handshake,
  Wallet,
  Sparkles,
  Telescope,
  Stethoscope,
  Gavel,
  MessageSquare,
  Clock,
  BarChart2,
  Database,
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

// Three-pillar navigation: Mission Control, Agent's Office, Database Management
export const navigation: NavSection[] = [
  // ── MISSION CONTROL ──────────────────────────────────────
  {
    section: "Mission Control",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/monitor", label: "System Monitor", icon: Activity },
    ],
  },

  // ── AGENT'S OFFICE ───────────────────────────────────────
  {
    section: "CEO",
    items: [
      { href: "/agents/ceo", label: "CEO Office", icon: Crown },
    ],
  },
  {
    section: "Operations Team",
    items: [
      { href: "/agents/coo", label: "COO — Productivity", icon: Cog },
      { href: "/agents/cpo", label: "CPO — Psychology", icon: Brain },
      { href: "/agents/cro", label: "CRO — Relations", icon: Handshake },
      { href: "/agents/cfo", label: "CFO — Finance", icon: Wallet },
      { href: "/agents/cmo", label: "CMO — Content", icon: Sparkles },
      { href: "/agents/cio", label: "CIO — Intelligence", icon: Telescope },
      { href: "/agents/physician", label: "Physician — Health", icon: Stethoscope },
    ],
  },
  {
    section: "Agent Operations",
    items: [
      { href: "/meetings", label: "Board Meetings", icon: Gavel },
      { href: "/messages", label: "Messages", icon: MessageSquare },
      { href: "/sessions", label: "Agent Sessions", icon: Cpu },
      { href: "/ops-reports", label: "Reports", icon: BarChart2 },
    ],
  },

  // ── DATABASE MANAGEMENT ──────────────────────────────────
  {
    section: "Strategic",
    items: [
      { href: "/goals", label: "Goals", icon: Target },
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
    ],
  },
  {
    section: "Productivity",
    items: [
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
      { href: "/people", label: "People", icon: Users },
      { href: "/kanban", label: "Kanban Board", icon: Columns },
      { href: "/calendar", label: "Calendar", icon: Calendar },
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
    section: "Journaling",
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
      { href: "/content", label: "Content Pipeline", icon: FileText },
    ],
  },

  // ── SYSTEM ───────────────────────────────────────────────
  {
    section: "",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, separator: true },
    ],
  },
];

export const allNavItems = navigation.flatMap((s) => s.items);
export const navItemMap = new Map(allNavItems.map((item) => [item.href, item]));
