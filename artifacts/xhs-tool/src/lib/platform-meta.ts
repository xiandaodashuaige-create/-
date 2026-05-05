import { Heart, Music2, Instagram, Facebook, type LucideIcon } from "lucide-react";

export type PlatformId = "xhs" | "tiktok" | "instagram" | "facebook";

// 每个平台的主题色板（HSL 字符串，可塞进 CSS 变量 + hsl(var(...)) 使用）
export type PlatformTheme = {
  primary: string;        // 主色 (按钮/进度条/active nav)
  primaryFg: string;      // 主色上的前景色
  ring: string;           // focus ring
  gradientFrom: string;   // hero 渐变起点
  gradientVia: string;    // hero 渐变中段
  gradientTo: string;     // hero 渐变终点
  softBg: string;         // 浅底（badge/标签底）
  softBorder: string;     // 浅边框
  softText: string;       // 浅底上的文字
  accent: string;         // 强调辅色（如 logo / icon）
};

export type PlatformMeta = {
  id: PlatformId;
  name: string;
  shortName: string;
  icon: LucideIcon;
  // Tailwind 色彩 token（Tailwind 静态类，用于无法走变量的场景，如 markdown 配色）
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  // 主题色板（驱动整个 UI 换肤）
  theme: PlatformTheme;
  // 当前是否上线
  enabled: boolean;
  // 发布模式：manual = 用户手动跳转；api = 通过 API 自动发布
  publishMode: "manual" | "api";
  // 自动发布走哪一条管道
  publishVia?: "ayrshare" | "meta_direct" | "tiktok_direct";
  // 内容形态偏好
  preferredMedia: "image" | "video" | "mixed";
  // 国内/海外（决定文案、tag 风格、地区选项）
  market: "cn" | "global";
};

export const PLATFORMS: Record<PlatformId, PlatformMeta> = {
  xhs: {
    id: "xhs",
    name: "小红书",
    shortName: "小红书",
    icon: Heart,
    color: "#ff2741",
    bgClass: "bg-red-50",
    textClass: "text-red-600",
    borderClass: "border-red-200",
    theme: {
      primary: "350 90% 55%",
      primaryFg: "0 0% 100%",
      ring: "350 90% 55%",
      gradientFrom: "350 90% 55%",
      gradientVia: "340 85% 60%",
      gradientTo: "330 80% 65%",
      softBg: "350 90% 97%",
      softBorder: "350 80% 88%",
      softText: "350 75% 40%",
      accent: "350 90% 55%",
    },
    enabled: true,
    publishMode: "manual",
    preferredMedia: "image",
    market: "cn",
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    shortName: "TikTok",
    icon: Music2,
    color: "#000000",
    bgClass: "bg-zinc-50",
    textClass: "text-zinc-900",
    borderClass: "border-zinc-300",
    theme: {
      // TikTok 经典：黑底 + 青(#25F4EE) + 玫红(#FE2C55)
      primary: "220 13% 12%",          // 深色按钮
      primaryFg: "0 0% 100%",
      ring: "348 95% 58%",             // 玫红 ring
      gradientFrom: "178 88% 55%",     // 青
      gradientVia: "220 13% 18%",      // 黑
      gradientTo: "348 95% 58%",       // 玫红
      softBg: "220 14% 96%",
      softBorder: "220 13% 85%",
      softText: "220 25% 18%",
      accent: "348 95% 58%",
    },
    enabled: true,
    publishMode: "api",
    publishVia: "ayrshare",
    preferredMedia: "video",
    market: "global",
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    shortName: "IG",
    icon: Instagram,
    color: "#E4405F",
    bgClass: "bg-pink-50",
    textClass: "text-pink-600",
    borderClass: "border-pink-200",
    theme: {
      // Instagram 经典：紫→粉→橙渐变
      primary: "327 73% 56%",
      primaryFg: "0 0% 100%",
      ring: "327 73% 56%",
      gradientFrom: "264 70% 55%",     // 紫
      gradientVia: "327 73% 56%",      // 粉
      gradientTo: "20 95% 60%",        // 橙
      softBg: "327 80% 97%",
      softBorder: "327 60% 88%",
      softText: "300 60% 35%",
      accent: "327 73% 56%",
    },
    enabled: true,
    publishMode: "api",
    publishVia: "meta_direct",
    preferredMedia: "mixed",
    market: "global",
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    shortName: "FB",
    icon: Facebook,
    color: "#1877F2",
    bgClass: "bg-blue-50",
    textClass: "text-blue-600",
    borderClass: "border-blue-200",
    theme: {
      // Facebook 经典：蓝→深蓝
      primary: "214 89% 52%",
      primaryFg: "0 0% 100%",
      ring: "214 89% 52%",
      gradientFrom: "214 89% 52%",
      gradientVia: "218 80% 45%",
      gradientTo: "224 70% 35%",
      softBg: "214 90% 97%",
      softBorder: "214 70% 88%",
      softText: "214 80% 32%",
      accent: "214 89% 52%",
    },
    enabled: true,
    publishMode: "api",
    publishVia: "meta_direct",
    preferredMedia: "mixed",
    market: "global",
  },
};

export const PLATFORM_LIST: PlatformMeta[] = [
  PLATFORMS.xhs,
  PLATFORMS.tiktok,
  PLATFORMS.instagram,
  PLATFORMS.facebook,
];

export const ENABLED_PLATFORMS = PLATFORM_LIST.filter((p) => p.enabled);

// 把平台 theme 转成 CSS 变量映射，用于 <html> 注入或 inline style
export function themeToCssVars(theme: PlatformTheme): Record<string, string> {
  return {
    "--platform-primary": theme.primary,
    "--platform-primary-fg": theme.primaryFg,
    "--platform-ring": theme.ring,
    "--platform-from": theme.gradientFrom,
    "--platform-via": theme.gradientVia,
    "--platform-to": theme.gradientTo,
    "--platform-soft-bg": theme.softBg,
    "--platform-soft-border": theme.softBorder,
    "--platform-soft-text": theme.softText,
    "--platform-accent": theme.accent,
  };
}
