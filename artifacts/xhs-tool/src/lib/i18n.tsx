import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

type Lang = "zh" | "en";

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const translations: Record<Lang, Record<string, string>> = {
  zh: {
    "app.name": "小红书AI工具",
    "app.version": "v1.0.0 · 小红书内容管理",
    "nav.dashboard": "仪表盘",
    "nav.workflow": "创建发布",
    "nav.accounts": "账号管理",
    "nav.content": "内容管理",
    "nav.assets": "素材库",
    "nav.schedules": "发布计划",
    "nav.sensitiveWords": "敏感词库",
    "nav.settings": "设置",
    "nav.admin": "管理后台",
    "nav.logout": "退出登录",
    "credits.label": "积分",
    "credits.remaining": "剩余积分",
    "credits.insufficient": "积分不足",
    "credits.cost": "消耗积分",
    "credits.free": "免费版",
    "credits.starter": "初级版",
    "credits.pro": "高级版",
    "user.role.admin": "管理员",
    "user.role.user": "用户",
    "landing.title": "用AI打造爆款",
    "landing.titleHighlight": "小红书",
    "landing.titleEnd": "内容",
    "landing.subtitle": "一站式小红书内容创作与管理平台。AI改写、敏感词检测、多账号管理，让你的运营效率翻倍。",
    "landing.cta": "开始使用",
    "landing.login": "登录",
    "landing.register": "免费注册",
    "landing.features": "核心功能",
    "landing.feature1.title": "AI智能改写",
    "landing.feature1.desc": "参考竞品内容，AI一键改写为原创笔记，降低限流风险。",
    "landing.feature2.title": "敏感词检测",
    "landing.feature2.desc": "自动检测违规词汇，降低限流风险。",
    "landing.feature3.title": "AI生成配图",
    "landing.feature3.desc": "根据内容自动生成精美配图。",
    "workflow.title": "创建并发布笔记",
    "workflow.subtitle": "跟随引导，轻松完成从灵感研究到发布的全流程",
    "workflow.step1": "选择账号",
    "workflow.step1.desc": "选择要发布的小红书账号",
    "workflow.step2": "灵感研究",
    "workflow.step2.desc": "AI分析同行，生成内容方案",
    "workflow.step3": "创作内容",
    "workflow.step3.desc": "编辑并完善笔记内容",
    "workflow.step4": "预览检查",
    "workflow.step4.desc": "预览效果并检查敏感词",
    "workflow.step5": "发布",
    "workflow.step5.desc": "发布到小红书",
    "common.next": "下一步",
    "common.prev": "上一步",
    "common.save": "保存",
    "common.cancel": "取消",
    "common.confirm": "确认",
    "common.delete": "删除",
    "common.edit": "编辑",
    "common.search": "搜索",
    "common.loading": "加载中...",
    "common.noData": "暂无数据",
    "common.backToDashboard": "返回仪表盘",
    "admin.title": "管理后台",
    "admin.users": "用户管理",
    "admin.stats": "系统统计",
    "admin.totalUsers": "总用户数",
    "admin.freeUsers": "免费用户",
    "admin.starterUsers": "初级版用户",
    "admin.proUsers": "高级版用户",
    "admin.totalCreditsUsed": "总消耗积分",
    "admin.recharge": "充值积分",
    "admin.deduct": "扣除积分",
    "admin.setRole": "设置角色",
    "admin.setPlan": "设置套餐",
    "admin.creditHistory": "积分记录",
    "admin.amount": "数量",
    "admin.description": "说明",
    "onboarding.welcome": "欢迎使用小红书AI工具！",
    "onboarding.welcomeDesc": "让我们快速了解核心功能，帮你高效运营小红书。",
    "onboarding.step1.title": "AI竞品研究",
    "onboarding.step1.desc": "输入你的业务描述，AI自动分析同行内容策略，生成3套可直接采用的笔记方案。",
    "onboarding.step2.title": "智能内容创作",
    "onboarding.step2.desc": "AI辅助改写、生成标题、标签和配图，一站式完成高质量内容创作。",
    "onboarding.step3.title": "安全检测与发布",
    "onboarding.step3.desc": "自动敏感词检测，预览效果，一键复制到小红书创作中心发布。",
    "onboarding.step4.title": "积分系统",
    "onboarding.step4.desc": "每项AI操作消耗积分，新用户赠送20积分（够完整体验一次发布流程）。可升级套餐或购买积分加油包。",
    "onboarding.skip": "跳过",
    "onboarding.next": "下一步",
    "onboarding.start": "开始使用",
    "onboarding.gotIt": "我知道了",
    "lang.zh": "中文",
    "lang.en": "English",
    "lang.switch": "切换语言",
  },
  en: {
    "app.name": "XHS AI Tool",
    "app.version": "v1.0.0 · XHS Content Manager",
    "nav.dashboard": "Dashboard",
    "nav.workflow": "Create & Publish",
    "nav.accounts": "Accounts",
    "nav.content": "Content",
    "nav.assets": "Assets",
    "nav.schedules": "Schedules",
    "nav.sensitiveWords": "Sensitive Words",
    "nav.settings": "Settings",
    "nav.admin": "Admin",
    "nav.logout": "Sign Out",
    "credits.label": "Credits",
    "credits.remaining": "Credits remaining",
    "credits.insufficient": "Insufficient credits",
    "credits.cost": "Credit cost",
    "credits.free": "Free Plan",
    "credits.starter": "Starter Plan",
    "credits.pro": "Pro Plan",
    "user.role.admin": "Admin",
    "user.role.user": "User",
    "landing.title": "Create Viral ",
    "landing.titleHighlight": "Xiaohongshu",
    "landing.titleEnd": " Content with AI",
    "landing.subtitle": "All-in-one Xiaohongshu content creation & management platform. AI rewriting, sensitive word detection, multi-account management — double your efficiency.",
    "landing.cta": "Get Started",
    "landing.login": "Sign In",
    "landing.register": "Sign Up Free",
    "landing.features": "Core Features",
    "landing.feature1.title": "AI Smart Rewrite",
    "landing.feature1.desc": "Reference competitor content and AI rewrites it into original notes, reducing throttling risk.",
    "landing.feature2.title": "Sensitive Word Detection",
    "landing.feature2.desc": "Auto-detect prohibited words to reduce throttling risk.",
    "landing.feature3.title": "AI Image Generation",
    "landing.feature3.desc": "Auto-generate beautiful images based on your content.",
    "workflow.title": "Create & Publish Note",
    "workflow.subtitle": "Follow the guided flow from research to publishing",
    "workflow.step1": "Select Account",
    "workflow.step1.desc": "Choose which XHS account to publish with",
    "workflow.step2": "Research",
    "workflow.step2.desc": "AI analyzes competitors, generates plans",
    "workflow.step3": "Create Content",
    "workflow.step3.desc": "Edit and refine your note",
    "workflow.step4": "Preview & Check",
    "workflow.step4.desc": "Preview and check for sensitive words",
    "workflow.step5": "Publish",
    "workflow.step5.desc": "Publish to Xiaohongshu",
    "common.next": "Next",
    "common.prev": "Previous",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.search": "Search",
    "common.loading": "Loading...",
    "common.noData": "No data",
    "common.backToDashboard": "Back to Dashboard",
    "admin.title": "Admin Panel",
    "admin.users": "User Management",
    "admin.stats": "System Stats",
    "admin.totalUsers": "Total Users",
    "admin.freeUsers": "Free Users",
    "admin.starterUsers": "Starter Users",
    "admin.proUsers": "Pro Users",
    "admin.totalCreditsUsed": "Total Credits Used",
    "admin.recharge": "Add Credits",
    "admin.deduct": "Deduct Credits",
    "admin.setRole": "Set Role",
    "admin.setPlan": "Set Plan",
    "admin.creditHistory": "Credit History",
    "admin.amount": "Amount",
    "admin.description": "Description",
    "onboarding.welcome": "Welcome to XHS AI Tool!",
    "onboarding.welcomeDesc": "Let's quickly learn the core features to boost your XHS operations.",
    "onboarding.step1.title": "AI Competitor Research",
    "onboarding.step1.desc": "Enter your business description, AI analyzes competitor strategies and generates 3 ready-to-use content plans.",
    "onboarding.step2.title": "Smart Content Creation",
    "onboarding.step2.desc": "AI-assisted rewriting, title/tag/image generation — all-in-one high-quality content creation.",
    "onboarding.step3.title": "Safety Check & Publish",
    "onboarding.step3.desc": "Auto sensitive word detection, preview, one-click copy to XHS Creator Studio.",
    "onboarding.step4.title": "Credits System",
    "onboarding.step4.desc": "Each AI operation costs credits. New users get 20 free credits (enough for 1 full publish workflow). Upgrade your plan or buy credit packs for more.",
    "onboarding.skip": "Skip",
    "onboarding.next": "Next",
    "onboarding.start": "Get Started",
    "onboarding.gotIt": "Got it",
    "lang.zh": "中文",
    "lang.en": "English",
    "lang.switch": "Switch Language",
  },
};

const I18nContext = createContext<I18nContextType>({
  lang: "zh",
  setLang: () => {},
  t: (key: string) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem("app-language");
    return (saved === "en" ? "en" : "zh") as Lang;
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    fetch("/api/user/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((user) => {
        if (user?.language && ["zh", "en"].includes(user.language)) {
          setLangState(user.language as Lang);
          localStorage.setItem("app-language", user.language);
        }
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
  }, [hydrated]);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem("app-language", newLang);
    fetch("/api/user/me", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: newLang }),
    }).catch(() => {});
  }, []);

  const t = useCallback((key: string): string => {
    return translations[lang][key] || translations["zh"][key] || key;
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export type { Lang };
