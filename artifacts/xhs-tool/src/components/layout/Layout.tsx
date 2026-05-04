import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
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
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const navItems = [
  { path: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { path: "/accounts", label: "账号管理", icon: Users },
  { path: "/content", label: "内容管理", icon: FileText },
  { path: "/assets", label: "素材库", icon: Image },
  { path: "/schedules", label: "发布计划", icon: Calendar },
  { path: "/sensitive-words", label: "敏感词库", icon: ShieldAlert },
  { path: "/settings", label: "设置", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();

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
          <span className="font-bold text-lg">小红书AI工具</span>
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
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </nav>
        </ScrollArea>

        <div className="p-4 border-t border-border space-y-3">
          {user && (
            <div className="flex items-center gap-3 px-2">
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-sm font-medium">
                {user.firstName?.[0] || user.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user.firstName || user.emailAddresses?.[0]?.emailAddress || "用户"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => signOut()}
                title="退出登录"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="text-xs text-muted-foreground text-center">
            v1.0.0 · 小红书内容管理
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
          <span className="font-bold">小红书AI工具</span>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
