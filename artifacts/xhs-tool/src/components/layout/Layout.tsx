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
  Users2,
  BarChart3,
  Sparkles,
  Send,
  ChevronDown,
  Archive,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useI18n, type Lang } from "@/lib/i18n";
import { api } from "@/lib/api";
import { PLATFORM_LIST } from "@/lib/platform-meta";
import { usePlatform } from "@/lib/platform-context";
import { useToast } from "@/hooks/use-toast";

type NavGroup = "main" | "history" | "system";
type NavItem = {
  path: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  highlight?: boolean;
  xhsOnly?: boolean;
  nonXhs?: boolean;
  group: NavGroup;
};

// 分组：
// - main：日常创作 + 发布（核心入口）
// - history：历史与素材库（需要时再展开）
// - system：账号 / 设置（始终可见）
const navItemsConfig: NavItem[] = [
  { path: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, group: "main" },
  { path: "/autopilot", labelKey: "nav.autopilot", icon: Sparkles, highlight: true, nonXhs: true, group: "main" },
  { path: "/quick-publish", labelKey: "nav.quickPublish", icon: Send, highlight: true, nonXhs: true, group: "main" },
  { path: "/workflow", labelKey: "nav.workflow", icon: PenSquare, highlight: true, xhsOnly: true, group: "main" },
  { path: "/market-data", labelKey: "nav.marketData", icon: BarChart3, group: "main" },

  { path: "/competitors", labelKey: "nav.competitors", icon: Users2, group: "history" },
  { path: "/content", labelKey: "nav.content", icon: FileText, group: "history" },
  { path: "/assets", labelKey: "nav.assets", icon: Image, group: "history" },
  { path: "/schedules", labelKey: "nav.schedules", icon: Calendar, group: "history" },
  { path: "/tracking", labelKey: "nav.tracking", icon: TrendingUp, xhsOnly: true, group: "history" },

  { path: "/accounts", labelKey: "nav.accounts", icon: Users, group: "system" },
  { path: "/credits", labelKey: "nav.credits", icon: Coins, group: "system" },
  { path: "/sensitive-words", labelKey: "nav.sensitiveWords", icon: ShieldAlert, xhsOnly: true, group: "system" },
  { path: "/settings", labelKey: "nav.settings", icon: Settings, group: "system" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 历史分组默认折叠；用户进过其中任一页面后会自动展开
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();
  const { t, lang, setLang } = useI18n();
  const { activePlatform, setActivePlatform } = usePlatform();
  const { toast } = useToast();

  const { data: dbUser } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => api.user.me(),
    staleTime: 30000,
  });

  const isAdmin = dbUser?.role === "admin";

  const visibleItems = navItemsConfig.filter((item) => {
    if (item.xhsOnly && activePlatform !== "xhs") return false;
    if (item.nonXhs && activePlatform === "xhs") return false;
    return true;
  });
  const mainItems = visibleItems.filter((i) => i.group === "main");
  const historyItems = visibleItems.filter((i) => i.group === "history");
  const systemItems = [
    ...visibleItems.filter((i) => i.group === "system"),
    ...(isAdmin ? [{ path: "/admin", labelKey: "nav.admin", icon: Shield, group: "system" as NavGroup }] : []),
  ];

  // 当前位置在历史组里 → 自动展开
  const onHistoryRoute = historyItems.some((i) => location.startsWith(i.path));
  const showHistory = historyExpanded || onHistoryRoute;

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
          <BookOpen className="h-6 w-6" style={{ color: "hsl(var(--platform-accent))" }} />
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-base">鹿联 Viral Suite</span>
            <span className="text-[10px] text-muted-foreground">全平台爆款矩阵</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* 平台切换器：当前小红书激活，其他灰显"即将开放"。后续 A/B 项目搬入后逐个解锁 */}
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-2 mb-1.5">
            平台
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PLATFORM_LIST.map((p) => {
              const Icon = p.icon;
              const active = p.id === activePlatform;
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.enabled ? `切换到 ${p.name}` : `${p.name} 授权流程即将开放`}
                  onClick={() => {
                    setActivePlatform(p.id);
                    if (!p.enabled) {
                      toast({
                        title: `已切换到 ${p.name}`,
                        description: "该平台的发布授权流程即将开放，目前可浏览界面。",
                      });
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    active
                      ? `${p.bgClass} ${p.textClass} ${p.borderClass} font-semibold`
                      : p.enabled
                      ? "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                      : "border-dashed border-muted-foreground/20 text-muted-foreground/50 hover:bg-muted/40"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="truncate">{p.shortName}</span>
                  {!p.enabled && (
                    <span className="ml-auto text-[9px] opacity-60">soon</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <ScrollArea className="flex-1 py-4">
          <nav className="space-y-1 px-3">
            {/* —— 主：创作 + 发布 —— */}
            {mainItems.map((item) => {
              const isActive =
                item.path === "/dashboard"
                  ? location === "/dashboard"
                  : location.startsWith(item.path);
              return (
                <Link key={item.path} href={item.path} onClick={() => setSidebarOpen(false)}>
                  <div
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                      isActive ? "" : (item as any).highlight ? "" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    style={
                      isActive
                        ? { background: "hsl(var(--platform-primary))", color: "hsl(var(--platform-primary-fg))" }
                        : (item as any).highlight
                        ? { background: "hsl(var(--platform-soft-bg))", color: "hsl(var(--platform-soft-text))" }
                        : undefined
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {t(item.labelKey)}
                  </div>
                </Link>
              );
            })}

            {/* —— 历史 / 素材库（默认折叠） —— */}
            <button
              type="button"
              onClick={() => setHistoryExpanded((v) => !v)}
              className="w-full mt-3 flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
            >
              <Archive className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{t("nav.historyGroup")}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHistory ? "rotate-180" : ""}`} />
            </button>
            {showHistory && historyItems.map((item) => {
              const isActive = location.startsWith(item.path);
              return (
                <Link key={item.path} href={item.path} onClick={() => setSidebarOpen(false)}>
                  <div
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ml-3 ${
                      isActive ? "" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    style={isActive ? { background: "hsl(var(--platform-primary))", color: "hsl(var(--platform-primary-fg))" } : undefined}
                  >
                    <item.icon className="h-4 w-4" />
                    {t(item.labelKey)}
                  </div>
                </Link>
              );
            })}

            {/* —— 账号 / 设置 —— */}
            <div className="pt-3 mt-3 border-t border-border space-y-1">
              {systemItems.map((item) => {
                const isActive = location.startsWith(item.path);
                return (
                  <Link key={item.path} href={item.path} onClick={() => setSidebarOpen(false)}>
                    <div
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                        isActive ? "" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      style={isActive ? { background: "hsl(var(--platform-primary))", color: "hsl(var(--platform-primary-fg))" } : undefined}
                    >
                      <item.icon className="h-4 w-4" />
                      {t(item.labelKey)}
                    </div>
                  </Link>
                );
              })}
            </div>
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
                className={`h-6 text-[10px] px-2 ${lang === code ? "text-white" : "text-muted-foreground"}`}
                style={lang === code ? { background: "hsl(var(--platform-primary))", color: "hsl(var(--platform-primary-fg))" } : undefined}
                onClick={() => setLang(code as Lang)}
              >
                {label}
              </Button>
            ))}
          </div>

          {user && (
            <div className="flex items-center gap-3 px-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
                style={{ background: "hsl(var(--platform-soft-bg))", color: "hsl(var(--platform-soft-text))" }}
              >
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
