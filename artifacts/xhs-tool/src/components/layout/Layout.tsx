import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  FileText,
  Image,
  Calendar,
  ShieldAlert,
  Settings,
  BookOpen,
  Menu,
  X,
  LogOut,
  PenSquare,
  Shield,
  Coins,
  Globe,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useI18n, type Lang } from "@/lib/i18n";
import { api } from "@/lib/api";

const navItemsConfig = [
  { path: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { path: "/workflow", labelKey: "nav.workflow", icon: PenSquare, highlight: true },
  { path: "/tracking", labelKey: "nav.tracking", icon: TrendingUp },
  { path: "/accounts", labelKey: "nav.accounts", icon: Users },
  { path: "/content", labelKey: "nav.content", icon: FileText },
  { path: "/assets", labelKey: "nav.assets", icon: Image },
  { path: "/schedules", labelKey: "nav.schedules", icon: Calendar },
  { path: "/sensitive-words", labelKey: "nav.sensitiveWords", icon: ShieldAlert },
  { path: "/settings", labelKey: "nav.settings", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();
  const { t, lang, setLang } = useI18n();

  const { data: dbUser } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => api.user.me(),
    staleTime: 30000,
  });

  const isAdmin = dbUser?.role === "admin";

  const navItems = [
    ...navItemsConfig,
    ...(isAdmin ? [{ path: "/admin", labelKey: "nav.admin", icon: Shield }] : []),
  ];

  return (
    <div className="flex h-screen bg-background">
      <div
        className={`fixed inset-0 z-40 bg-black/50 lg:hidden transition-opacity ${
          sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        className={`fixed lg:static z-50 inset-y-0 left-0 w-64 bg-card border-r border-border transform transition-transform lg:translate-x-0 flex flex-col ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-6 h-16 border-b border-border">
          <BookOpen className="h-6 w-6 text-red-500" />
          <span className="font-bold text-lg">{t("app.name")}</span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <ScrollArea className="flex-1 py-4">
          <nav className="space-y-1 px-3">
            {navItems.map((item) => {
              const isActive =
                item.path === "/dashboard"
                  ? location === "/dashboard"
                  : location.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setSidebarOpen(false)}
                >
                  <div
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : (item as any).highlight
                        ? "text-red-600 bg-red-50 hover:bg-red-100"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {t(item.labelKey)}
                  </div>
                </Link>
              );
            })}
          </nav>
        </ScrollArea>

        <div className="p-4 border-t border-border space-y-3">
          {dbUser && (
            <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-xs font-medium text-amber-700">{t("credits.remaining")}</span>
              </div>
              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-xs font-bold">
                {dbUser.credits}
              </Badge>
            </div>
          )}

          <div className="flex items-center justify-center gap-1">
            {([["zh", "简体"], ["zh-HK", "繁體"], ["en", "EN"]] as const).map(([code, label]) => (
              <Button
                key={code}
                variant={lang === code ? "default" : "ghost"}
                size="sm"
                className={`h-6 text-[10px] px-2 ${lang === code ? "bg-red-500 hover:bg-red-600 text-white" : "text-muted-foreground"}`}
                onClick={() => setLang(code as Lang)}
              >
                {label}
              </Button>
            ))}
          </div>

          {user && (
            <div className="flex items-center gap-3 px-2">
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-sm font-medium">
                {user.firstName?.[0] || user.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user.firstName || user.emailAddresses?.[0]?.emailAddress || "用户"}
                </p>
                {isAdmin && (
                  <p className="text-[10px] text-purple-600 font-medium">{t("user.role.admin")}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => signOut()}
                title={t("nav.logout")}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="text-xs text-muted-foreground text-center">
            {t("app.version")}
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-4 px-6 h-16 border-b border-border bg-card lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-bold">{t("app.name")}</span>
          {dbUser && (
            <div className="ml-auto flex items-center gap-1">
              <Coins className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-xs font-bold text-amber-700">{dbUser.credits}</span>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
