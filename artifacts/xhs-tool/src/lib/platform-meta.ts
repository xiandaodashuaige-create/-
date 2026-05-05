import { Heart, Music2, Instagram, Facebook, type LucideIcon } from "lucide-react";

export type PlatformId = "xhs" | "tiktok" | "instagram" | "facebook";

export type PlatformMeta = {
  id: PlatformId;
  name: string;
  shortName: string;
  icon: LucideIcon;
  // Tailwind 色彩 token
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
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
