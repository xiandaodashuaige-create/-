import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Wand2, ShieldCheck, Image as ImageIcon, Calendar, Users,
  Check, Zap, Crown, Sparkles, ArrowRight, Coins,
  TrendingUp, Video, Brain, Target, Rocket, BarChart3,
  Bot, Send, Layers, Heart, Music2, Instagram, Facebook,
} from "lucide-react";
import { useI18n, type Lang } from "@/lib/i18n";

export default function LandingPage() {
  const { t, lang, setLang } = useI18n();
  const en = lang === "en";

  // ── 平台 ────────────────────────────────────────────────
  const platforms = [
    { id: "xhs", name: "小红书", nameEn: "Xiaohongshu", icon: Heart, color: "from-red-500 to-pink-500", bg: "bg-red-50", border: "border-red-200", text: "text-red-600", desc: en ? "Manual deep-link publish · Asia top discovery" : "深度链接发布 · 亚洲首选种草", market: en ? "Asia / CN" : "亚洲 / 中国" },
    { id: "tiktok", name: "TikTok", nameEn: "TikTok", icon: Music2, color: "from-slate-800 to-slate-900", bg: "bg-slate-50", border: "border-slate-300", text: "text-slate-800", desc: en ? "OAuth direct publish · Global short video" : "OAuth 一键直发 · 全球短视频", market: en ? "Global" : "全球" },
    { id: "instagram", name: "Instagram", nameEn: "Instagram", icon: Instagram, color: "from-fuchsia-500 to-orange-400", bg: "bg-fuchsia-50", border: "border-fuchsia-200", text: "text-fuchsia-600", desc: en ? "Meta Graph API · Reels & Posts" : "Meta Graph 直发 · Reels / Posts", market: en ? "Global" : "全球" },
    { id: "facebook", name: "Facebook", nameEn: "Facebook", icon: Facebook, color: "from-blue-500 to-blue-700", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600", desc: en ? "Page direct publish · Meta Ads ready" : "Page 一键直发 · Meta 广告对接", market: en ? "Global" : "全球" },
  ] as const;

  // ── 卖点功能 ────────────────────────────────────────────
  const features = [
    { icon: Send, title: en ? "Multi-Platform One-Click Publish" : "多平台一键发布", desc: en ? "Connect XHS / TikTok / Instagram / Facebook with OAuth and publish the same post — or platform-tailored variants — to all of them in one click." : "OAuth 授权后，XHS / TikTok / IG / FB 同一文案一键分发；可针对每个平台自动调整标题/标签/封面尺寸。", color: "bg-rose-50 text-rose-500" },
    { icon: BarChart3, title: en ? "Industry Aggregate Insights" : "行业聚合分析", desc: en ? "AI scans all your tracked competitors per platform, mining viral formula, hot hashtags, BGM, best posting hours and 5 evidence-backed insights." : "AI 跨账号聚合同行真实数据，提炼爆款公式、高频标签、热门 BGM、最佳发布时段，并给出 5 条带数字证据的关键洞察。", color: "bg-violet-50 text-violet-500" },
    { icon: Calendar, title: en ? "Smart Scheduling" : "智能定时发布", desc: en ? "Drag-and-drop calendar; pick the AI-recommended best hour for each platform's local timezone. Cron worker fires publish jobs reliably." : "拖拽日历安排发布；AI 按各平台当地时区推荐最佳时段；后台 Cron 自动执行发布任务。", color: "bg-amber-50 text-amber-500" },
    { icon: Brain, title: en ? "Imitate-and-Originalize" : "模仿原创工作流", desc: en ? "Reference one viral post → AI extracts its structure (hook, beats, CTA) and rewrites a fully-original version in your brand voice." : "选一条同行爆款 → AI 提炼其结构（钩子/节奏/CTA）→ 用你的品牌口吻重写为全新原创笔记。", color: "bg-purple-50 text-purple-500" },
    { icon: ImageIcon, title: en ? "Reference-Driven AI Image" : "参考图驱动 AI 配图", desc: en ? "Upload a viral cover; Seedream regenerates the same composition / palette / mood with your product. Edit / retry / feedback loop built in." : "上传爆款封面，Seedream 用同款构图、配色、情绪重绘你的产品；支持局部编辑、重试、反馈打分。", color: "bg-pink-50 text-pink-500" },
    { icon: Video, title: en ? "AI Video Generation" : "AI 视频生成", desc: en ? "Text-to-video and image-to-video with Doubao Seedance — short clips ready for TikTok / Reels straight from your editor." : "文字 / 图生视频（豆包 Seedance），编辑器内直接产出 TikTok / Reels 适配的短视频。", color: "bg-cyan-50 text-cyan-500" },
    { icon: ShieldCheck, title: en ? "Sensitivity Guard" : "敏感词检测", desc: en ? "Real-time scan for risky words / claims per platform policy; one-click rewrite to safer wording before publishing." : "依各平台政策实时扫描违规词与风险表述，一键改写为安全话术再发布。", color: "bg-green-50 text-green-500" },
    { icon: Bot, title: en ? "Autopilot" : "AI 自动驾驶", desc: en ? "Set niche + region + cadence — Autopilot researches competitors, drafts content, generates assets and schedules everything for you." : "设定行业 / 地区 / 节奏，Autopilot 自动研究同行、起草内容、生成素材并安排好整周发布计划。", color: "bg-indigo-50 text-indigo-500" },
    { icon: Layers, title: en ? "Multi-Account Matrix" : "多账号矩阵", desc: en ? "Manage unlimited accounts across 4 platforms in one workspace; per-account isolation, switch with one click." : "一个工作台管理 4 平台不限数量账号；各账号数据隔离，一键切换。", color: "bg-orange-50 text-orange-500" },
    { icon: Wand2, title: en ? "AI Title / Hashtag / Caption" : "AI 标题 / 标签 / 文案", desc: en ? "Generate platform-tailored titles, hashtags and captions in your brand voice; learns from your past viral posts." : "为每个平台分别生成符合调性的标题、标签、正文；持续学习你过去的爆款风格。", color: "bg-blue-50 text-blue-500" },
    { icon: TrendingUp, title: en ? "Post Tracking" : "发布数据追踪", desc: en ? "Auto-poll views/likes/comments after publish; dashboard reveals what's working across platforms." : "发布后自动轮询播放/点赞/评论；总览面板告诉你哪个平台、哪类内容最有效。", color: "bg-teal-50 text-teal-500" },
    { icon: Users, title: en ? "Competitor Library" : "同行库", desc: en ? "Add competitors per platform, sync their latest posts, drill into top samples and feed them back into your workflow." : "按平台添加同行，自动抓取最新内容，钻取爆款样本并反哺你的创作流。", color: "bg-yellow-50 text-yellow-500" },
  ];

  // ── 4 步流程 ────────────────────────────────────────────
  const howItWorks = [
    { step: "01", title: en ? "Connect Accounts" : "授权账号", desc: en ? "OAuth-link your TikTok / Instagram / Facebook; deep-link your Xiaohongshu. One-time setup." : "OAuth 连接 TikTok / IG / FB；小红书走深度链接。一次设置，长期生效。", icon: Target, gradient: "from-blue-500 to-cyan-500" },
    { step: "02", title: en ? "Analyze Industry" : "分析行业", desc: en ? "Add competitors, sync data, run aggregate analysis — AI surfaces the cross-account viral formula." : "添加同行 → 抓取数据 → 运行行业聚合分析，AI 一句话告诉你跨账号爆款公式。", icon: BarChart3, gradient: "from-violet-500 to-fuchsia-500" },
    { step: "03", title: en ? "Imitate & Create" : "模仿原创", desc: en ? "Pick a viral reference; AI rewrites text + regenerates image / video in your brand voice." : "选定一条爆款参考，AI 用你的口吻重写文案并重绘配图 / 生成视频。", icon: Brain, gradient: "from-purple-500 to-pink-500" },
    { step: "04", title: en ? "Schedule & Publish" : "定时发布", desc: en ? "Pick best time per platform, hit Schedule — Autopilot or Cron handles the rest." : "为每个平台挑最佳时段，点定时发布——Autopilot / Cron 后台自动执行。", icon: Rocket, gradient: "from-red-500 to-orange-500" },
  ];

  // ── 价格 ────────────────────────────────────────────────
  const plans = [
    {
      name: en ? "Free" : "体验版",
      price: "$0",
      period: "",
      desc: en ? "Try the full pipeline — no card required" : "注册即享完整功能体验",
      credits: 20,
      highlight: false,
      badge: en ? "New User" : "新用户专享",
      badgeColor: "bg-green-100 text-green-700",
      features: [
        en ? "20 credits ≈ 1 full publish" : "赠送20积分 = 1次完整发布",
        en ? "All 4 platforms unlocked" : "4 平台全部解锁",
        en ? "Industry insights + AI rewrite" : "行业分析 + AI 改写",
        en ? "AI image / video / sensitivity guard" : "AI 图片/视频/敏感词检测",
        en ? "1 account per platform" : "每平台 1 个账号",
        en ? "AI assistant guidance" : "AI 运营助手指导",
      ],
      cta: en ? "Sign up free" : "免费注册体验",
      ctaLink: "/sign-up",
      ctaStyle: "bg-gray-900 hover:bg-gray-800 text-white",
    },
    {
      name: en ? "Starter" : "续费版",
      price: "$12.9",
      period: en ? "/mo" : "/月",
      desc: en ? "Solo creators · ongoing operation" : "个人博主 · 持续运营",
      credits: 100,
      highlight: true,
      badge: en ? "Recommended" : "推荐",
      badgeColor: "bg-red-100 text-red-600",
      features: [
        en ? "100 credits/mo ≈ 4-5 full publishes" : "每月100积分 ≈ 4-5 次完整发布",
        en ? "Unlimited AI usage" : "全部 AI 功能无限制",
        en ? "Industry aggregate insights" : "行业聚合分析（无限刷新）",
        en ? "AI video generation" : "AI 视频生成",
        en ? "2 accounts per platform" : "每平台 2 个账号",
        en ? "Smart scheduling + cron worker" : "智能定时发布 + 后台 Cron",
        en ? "Top-up credit packs available" : "积分不足可购买加油包",
      ],
      cta: en ? "Start now" : "立即开通",
      ctaLink: "/sign-up",
      ctaStyle: "bg-red-500 hover:bg-red-600 text-white",
    },
    {
      name: en ? "Pro" : "定制版",
      price: "$39.9",
      period: en ? "/mo" : "/月",
      desc: en ? "Teams · multi-account matrix" : "团队运营 · 多账号矩阵",
      credits: 500,
      highlight: false,
      badge: en ? "Flagship" : "旗舰",
      badgeColor: "bg-purple-100 text-purple-700",
      features: [
        en ? "500 credits/mo ≈ 25 full publishes" : "每月500积分 ≈ 25 次完整发布",
        en ? "Unlimited AI usage" : "全部 AI 功能无限制",
        en ? "Unlimited accounts across 4 platforms" : "4 平台不限账号数量",
        en ? "Autopilot weekly auto-pipeline" : "Autopilot 自动驾驶（周计划）",
        en ? "Multi-region account matrix" : "多地区账号矩阵运营",
        en ? "Priority AI assistant" : "AI 运营助手优先响应",
        en ? "Dedicated onboarding + WeChat group" : "专属对接 + 客户微信群",
      ],
      cta: en ? "Contact us" : "联系开通",
      ctaLink: "/sign-up",
      ctaStyle: "bg-purple-600 hover:bg-purple-700 text-white",
    },
  ];

  const creditPacks = [
    { credits: 50, price: 3.9, perCredit: "0.078" },
    { credits: 200, price: 12.9, perCredit: "0.065", popular: true },
    { credits: 500, price: 24.9, perCredit: "0.050" },
  ];

  const workflowCosts = [
    { step: en ? "Industry analysis" : "行业分析", cost: 5, icon: "📊" },
    { step: en ? "Competitor research" : "同行研究", cost: 5, icon: "🔍" },
    { step: en ? "AI rewrite" : "AI 改写", cost: 3, icon: "✨" },
    { step: en ? "Title + hashtags" : "标题+标签", cost: 2, icon: "📝" },
    { step: en ? "AI image" : "AI 配图", cost: 5, icon: "🎨" },
    { step: en ? "AI video (5s)" : "AI 视频(5秒)", cost: 8, icon: "🎬" },
    { step: en ? "Sensitivity scan" : "敏感词扫描", cost: 1, icon: "🛡️" },
    { step: en ? "Multi-platform publish" : "多平台发布", cost: 2, icon: "🚀" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 via-white to-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between px-6 md:px-12 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <BookOpen className="h-7 w-7 text-red-500" />
          <span className="font-bold text-xl">{t("app.name")}</span>
          <Badge variant="outline" className="ml-2 text-[10px] border-red-200 text-red-600 hidden sm:inline-flex">
            {en ? "Viral Suite · 4 Platforms" : "Viral Suite · 四平台"}
          </Badge>
        </div>
        <div className="flex gap-3 items-center">
          <a href="#platforms" className="text-sm text-gray-600 hover:text-gray-900 hidden md:inline">{en ? "Platforms" : "平台"}</a>
          <a href="#features" className="text-sm text-gray-600 hover:text-gray-900 hidden md:inline">{en ? "Features" : "功能"}</a>
          <a href="#pricing" className="text-sm text-gray-600 hover:text-gray-900 hidden md:inline">{en ? "Pricing" : "价格"}</a>
          <div className="flex items-center gap-0.5">
            {([["zh", "简体"], ["zh-HK", "繁體"], ["en", "EN"]] as const).map(([code, label]) => (
              <button
                key={code}
                onClick={() => setLang(code as Lang)}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${
                  lang === code ? "bg-red-500 text-white" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Link href="/sign-in"><Button variant="outline">{en ? "Log in" : "登录"}</Button></Link>
          <Link href="/sign-up"><Button className="bg-red-500 hover:bg-red-600 text-white">{en ? "Sign up" : "免费注册"}</Button></Link>
        </div>
      </header>

      {/* Hero */}
      <section className="text-center py-20 px-6 max-w-5xl mx-auto relative">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-10 left-10 w-72 h-72 bg-red-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" />
          <div className="absolute top-20 right-10 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: "2s" }} />
          <div className="absolute bottom-10 left-1/2 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: "4s" }} />
        </div>
        <div className="inline-flex items-center gap-2 bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-full px-4 py-1.5 mb-6">
          <Sparkles className="h-4 w-4 text-red-500" />
          <span className="text-sm text-red-700 font-medium">
            {en ? "Sign up free · 20 credits included · 4 platforms unlocked" : "鹿联 Viral Suite · 注册即送 20 积分 · 四平台同时解锁"}
          </span>
        </div>
        <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight tracking-tight">
          {en ? "One workflow for " : "一套工作流 · 同时运营 "}
          <span className="bg-gradient-to-r from-red-500 via-pink-500 to-purple-500 bg-clip-text text-transparent">
            {en ? "XHS · TikTok · IG · FB" : "小红书 · TikTok · IG · FB"}
          </span>
          {en ? " viral content" : " 四大平台爆款"}
        </h1>
        <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto leading-relaxed">
          {en
            ? "Imitate competitors' verified viral formula → AI rewrites in your voice → schedule publish to all 4 platforms in one click. Industry insights, AI image / video, autopilot, multi-account — all included."
            : "模仿同行已验证的爆款公式 → AI 用你的口吻重写 → 一键定时发布到四大平台。行业分析、AI 图/视频、自动驾驶、多账号矩阵全部内置。"}
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link href="/sign-up">
            <Button size="lg" className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white text-lg px-8 shadow-lg shadow-red-500/25">
              {en ? "Start free" : "免费开始体验"} <ArrowRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
          <a href="#how-it-works">
            <Button size="lg" variant="outline" className="text-lg px-8">
              {en ? "See how it works" : "了解工作流程"}
            </Button>
          </a>
        </div>

        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl mx-auto text-center">
          <div><p className="text-3xl font-bold text-red-500">4</p><p className="text-sm text-gray-500">{en ? "Platforms" : "大平台"}</p></div>
          <div><p className="text-3xl font-bold text-red-500">4</p><p className="text-sm text-gray-500">{en ? "Steps · OAuth → Publish" : "步 · 授权到发布"}</p></div>
          <div><p className="text-3xl font-bold text-red-500">∞</p><p className="text-sm text-gray-500">{en ? "Accounts" : "个账号"}</p></div>
          <div><p className="text-3xl font-bold text-red-500">24/7</p><p className="text-sm text-gray-500">{en ? "Cron worker" : "后台 Cron"}</p></div>
        </div>
      </section>

      {/* Platforms */}
      <section id="platforms" className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <Badge className="bg-blue-100 text-blue-600 mb-4">{en ? "Supported Platforms" : "支持平台"}</Badge>
            <h2 className="text-3xl font-bold mb-3">{en ? "Publish to all 4 platforms — same workflow" : "一套流程，四平台同发"}</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              {en
                ? "Switch platforms with a single dropdown. Each platform's publish path is built natively — direct API where possible, deep-link where required."
                : "顶部下拉切换平台，编辑器自动适配该平台的字数限制、媒体格式与发布路径——能直发的直发，不能的走深度链接。"}
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {platforms.map((p) => (
              <div key={p.id} className={`relative rounded-2xl p-6 border-2 ${p.border} ${p.bg} hover:shadow-lg transition-all`}>
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center mb-4 shadow-md`}>
                  <p.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className={`font-bold text-lg mb-1 ${p.text}`}>{en ? p.nameEn : p.name}</h3>
                <p className="text-xs text-gray-500 mb-2">{p.market}</p>
                <p className="text-sm text-gray-700 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Badge variant="outline" className="text-xs"><Send className="h-3 w-3 mr-1" />{en ? "One-click multi-publish" : "一键多平台发布"}</Badge>
            <Badge variant="outline" className="text-xs"><Calendar className="h-3 w-3 mr-1" />{en ? "Per-platform best time" : "各平台最佳时段"}</Badge>
            <Badge variant="outline" className="text-xs"><Layers className="h-3 w-3 mr-1" />{en ? "Per-account isolation" : "账号数据隔离"}</Badge>
            <Badge variant="outline" className="text-xs"><ShieldCheck className="h-3 w-3 mr-1" />{en ? "Per-platform sensitivity rules" : "平台政策检测"}</Badge>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-6 bg-gradient-to-b from-white to-red-50/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="bg-red-100 text-red-600 mb-4">{en ? "AI Automated Workflow" : "AI 自动化流程"}</Badge>
            <h2 className="text-3xl font-bold mb-3">{en ? "From OAuth to Publish in 4 steps" : "从授权到发布，4 步搞定"}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {howItWorks.map((item, i) => (
              <div key={i} className="relative group">
                <div className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-lg transition-all h-full">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                    <item.icon className="h-6 w-6 text-white" />
                  </div>
                  <div className="text-xs font-bold text-gray-300 mb-2">{item.step}</div>
                  <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                  <p className="text-gray-600 text-sm">{item.desc}</p>
                </div>
                {i < howItWorks.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                    <ArrowRight className="h-5 w-5 text-gray-300" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="bg-purple-100 text-purple-600 mb-4">{en ? "Core Capabilities" : "核心能力"}</Badge>
            <h2 className="text-3xl font-bold mb-3">{en ? "Everything you need to scale 4-platform content ops" : "四平台内容运营所需的全部能力"}</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              {en ? "Each module works with every platform; switch platforms and the workflow re-tunes automatically." : "每个模块都跨平台可用，切换平台后工作流自动重新匹配。"}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div key={i} className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-md transition-all hover:-translate-y-1">
                <div className={`w-12 h-12 ${f.color.split(" ")[0]} rounded-lg flex items-center justify-center mb-4`}>
                  <f.icon className={`h-6 w-6 ${f.color.split(" ")[1]}`} />
                </div>
                <h3 className="font-semibold text-base mb-2">{f.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="bg-amber-100 text-amber-600 mb-4">{en ? "Flexible Pricing" : "灵活定价"}</Badge>
            <h2 className="text-3xl font-bold mb-3">{en ? "Pick the plan that fits your scale" : "选择适合你的方案"}</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              {en ? "All plans unlock all 4 platforms. Upgrade only when you need more accounts or higher monthly publish volume." : "所有方案都解锁全部 4 平台，只在需要更多账号或更高发布量时再升级。"}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {en ? "All prices in USD, applicable worldwide" : "所有价格以美元 (USD) 显示，全球适用"}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-white rounded-2xl p-6 border-2 transition-shadow hover:shadow-lg flex flex-col ${
                  plan.highlight ? "border-red-500 shadow-md shadow-red-500/10" : "border-gray-100"
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-6">
                    <Badge className={`${plan.badgeColor} text-xs px-3 py-0.5 font-medium`}>{plan.badge}</Badge>
                  </div>
                )}

                <div className="mb-5 pt-2">
                  <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                  <p className="text-xs text-gray-500">{plan.desc}</p>
                </div>

                <div className="mb-5">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  {plan.period && <span className="text-gray-500 text-sm">{plan.period}</span>}
                </div>

                <div className="flex items-center gap-2 mb-5 px-3 py-2 bg-amber-50 rounded-lg">
                  <Coins className="h-4 w-4 text-amber-600 shrink-0" />
                  <span className="text-sm font-medium text-amber-700">
                    {plan.credits === 20
                      ? (en ? "20 credits = 1 full publish" : "赠送 20 积分 = 1 次完整发布")
                      : (en ? `${plan.credits} credits/mo ≈ ${Math.floor(plan.credits / 20)} full publishes` : `每月 ${plan.credits} 积分 ≈ ${Math.floor(plan.credits / 20)} 次完整发布`)}
                  </span>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <span className="text-gray-700">{f}</span>
                    </li>
                  ))}
                </ul>

                <Link href={plan.ctaLink}>
                  <Button className={`w-full ${plan.ctaStyle}`} size="lg">{plan.cta}</Button>
                </Link>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-8">
            <div className="flex flex-col md:flex-row gap-8">
              <div className="md:w-1/2">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="h-5 w-5 text-amber-500" />
                  <h3 className="text-xl font-bold">{en ? "Top-up credit packs" : "积分加油包"}</h3>
                </div>
                <p className="text-sm text-gray-600 mb-5">
                  {en ? "Run out mid-month? Buy a pack — never expires, no subscription bump required." : "本月不够用？随时加购，永不过期，无需升级订阅。"}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {creditPacks.map((pack) => (
                    <div key={pack.credits} className={`relative rounded-xl border-2 p-4 text-center transition-shadow hover:shadow-md ${pack.popular ? "border-red-500 bg-red-50" : "border-gray-200"}`}>
                      {pack.popular && (
                        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                          <Badge className="bg-red-500 text-white text-[10px] px-2">{en ? "Best value" : "推荐"}</Badge>
                        </div>
                      )}
                      <p className="text-2xl font-bold text-amber-600">{pack.credits}</p>
                      <p className="text-xs text-gray-500 mb-2">{en ? "credits" : "积分"}</p>
                      <p className="text-lg font-bold">${pack.price}</p>
                      <p className="text-[10px] text-gray-400">~${pack.perCredit}/{en ? "credit" : "积分"}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="md:w-1/2">
                <div className="flex items-center gap-2 mb-4">
                  <Coins className="h-5 w-5 text-amber-500" />
                  <h3 className="text-lg font-bold">{en ? "Per-step credit cost" : "各功能积分消耗"}</h3>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  {en ? "Transparent pricing — only pay for what you actually run." : "用多少扣多少，全程透明。"}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {workflowCosts.map((item) => (
                    <div key={item.step} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <span className="text-xs text-gray-700">{item.icon} {item.step}</span>
                      <Badge variant="secondary" className="text-[10px] font-bold">{item.cost} {en ? "cr" : "积分"}</Badge>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between px-3 py-2 bg-amber-50 rounded-lg border border-amber-200">
                  <span className="text-sm font-medium text-amber-800">{en ? "Full pipeline (1 publish)" : "完整流程一次发布"}</span>
                  <Badge className="bg-amber-100 text-amber-800 font-bold">~ 20-30 {en ? "cr" : "积分"}</Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6 max-w-4xl mx-auto text-center">
        <div className="bg-gradient-to-r from-red-500 via-pink-500 to-purple-600 rounded-2xl p-10 text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 left-0 w-40 h-40 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute bottom-0 right-0 w-60 h-60 bg-white rounded-full translate-x-1/3 translate-y-1/3" />
          </div>
          <div className="relative z-10">
            <Crown className="h-10 w-10 mx-auto mb-4 opacity-90" />
            <h2 className="text-2xl font-bold mb-3">
              {en ? "Stop juggling 4 apps. Run them all from one workspace." : "别再 4 个 App 来回切。一个工作台搞定全部。"}
            </h2>
            <p className="text-red-100 mb-6 max-w-md mx-auto">
              {en ? "Sign up free — 20 credits, all 4 platforms, full workflow. No card required." : "免费注册 · 赠送 20 积分 · 解锁全部 4 平台 · 无需信用卡。"}
            </p>
            <Link href="/sign-up">
              <Button size="lg" className="bg-white text-red-600 hover:bg-red-50 text-lg px-8 font-bold shadow-lg">
                {en ? "Start free now" : "立即免费开始"} <ArrowRight className="h-5 w-5 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-100 py-8 text-center text-sm text-gray-400">
        {t("landing.footer")}
      </footer>
    </div>
  );
}
