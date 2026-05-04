import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Wand2, ShieldCheck, Image, Calendar, Users,
  Check, Zap, Crown, Sparkles, ArrowRight, Coins, Globe,
  Search, TrendingUp, Video, Brain, Target, Rocket
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function LandingPage() {
  const { t, lang, setLang } = useI18n();

  const features = [
    { icon: Search, title: t("landing.feat.research"), desc: t("landing.feat.researchDesc"), color: "bg-blue-50 text-blue-500" },
    { icon: Brain, title: t("landing.feat.viralContent"), desc: t("landing.feat.viralContentDesc"), color: "bg-purple-50 text-purple-500" },
    { icon: Wand2, title: t("landing.feat.aiRewrite"), desc: t("landing.feat.aiRewriteDesc"), color: "bg-red-50 text-red-500" },
    { icon: Image, title: t("landing.feat.aiImage"), desc: t("landing.feat.aiImageDesc"), color: "bg-pink-50 text-pink-500" },
    { icon: ShieldCheck, title: t("landing.feat.sensitivity"), desc: t("landing.feat.sensitivityDesc"), color: "bg-green-50 text-green-500" },
    { icon: Users, title: t("landing.feat.multiAccount"), desc: t("landing.feat.multiAccountDesc"), color: "bg-orange-50 text-orange-500" },
    { icon: Video, title: t("landing.feat.videoUpload"), desc: t("landing.feat.videoUploadDesc"), color: "bg-cyan-50 text-cyan-500" },
    { icon: Calendar, title: t("landing.feat.schedule"), desc: t("landing.feat.scheduleDesc"), color: "bg-amber-50 text-amber-500" },
  ];

  const howItWorks = [
    { step: "01", title: t("landing.howStep1"), desc: t("landing.howStep1Desc"), icon: Target, gradient: "from-blue-500 to-cyan-500" },
    { step: "02", title: t("landing.howStep2"), desc: t("landing.howStep2Desc"), icon: Brain, gradient: "from-purple-500 to-pink-500" },
    { step: "03", title: t("landing.howStep3"), desc: t("landing.howStep3Desc"), icon: Rocket, gradient: "from-red-500 to-orange-500" },
    { step: "04", title: t("landing.howStep4"), desc: t("landing.howStep4Desc"), icon: TrendingUp, gradient: "from-green-500 to-emerald-500" },
  ];

  const plans = [
    {
      name: t("landing.plan.free"),
      price: "$0",
      period: "",
      desc: t("landing.plan.freeDesc"),
      credits: 20,
      highlight: false,
      badge: t("landing.plan.freeBadge"),
      badgeColor: "bg-green-100 text-green-700",
      features: [
        t("landing.plan.freeFeat1"),
        t("landing.plan.freeFeat2"),
        t("landing.plan.freeFeat3"),
        t("landing.plan.freeFeat4"),
        t("landing.plan.freeFeat5"),
        t("landing.plan.freeFeat6"),
      ],
      cta: t("landing.plan.freeCta"),
      ctaLink: "/sign-up",
      ctaStyle: "bg-gray-900 hover:bg-gray-800 text-white",
    },
    {
      name: t("landing.plan.starter"),
      price: "$12.9",
      period: lang === "zh" ? "/月" : "/mo",
      desc: t("landing.plan.starterDesc"),
      credits: 100,
      highlight: true,
      badge: t("landing.plan.starterBadge"),
      badgeColor: "bg-red-100 text-red-600",
      features: [
        t("landing.plan.starterFeat1"),
        t("landing.plan.starterFeat2"),
        t("landing.plan.starterFeat3"),
        t("landing.plan.starterFeat4"),
        t("landing.plan.starterFeat5"),
        t("landing.plan.starterFeat6"),
        t("landing.plan.starterFeat7"),
      ],
      cta: t("landing.plan.starterCta"),
      ctaLink: "/sign-up",
      ctaStyle: "bg-red-500 hover:bg-red-600 text-white",
    },
    {
      name: t("landing.plan.pro"),
      price: "$39.9",
      period: lang === "zh" ? "/月" : "/mo",
      desc: t("landing.plan.proDesc"),
      credits: 500,
      highlight: false,
      badge: t("landing.plan.proBadge"),
      badgeColor: "bg-purple-100 text-purple-700",
      features: [
        t("landing.plan.proFeat1"),
        t("landing.plan.proFeat2"),
        t("landing.plan.proFeat3"),
        t("landing.plan.proFeat4"),
        t("landing.plan.proFeat5"),
        t("landing.plan.proFeat6"),
        t("landing.plan.proFeat7"),
      ],
      cta: t("landing.plan.proCta"),
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
    { step: t("landing.wf.research"), cost: 5, icon: "🔍" },
    { step: t("landing.wf.rewrite"), cost: 3, icon: "✨" },
    { step: t("landing.wf.title"), cost: 1, icon: "📝" },
    { step: t("landing.wf.hashtags"), cost: 1, icon: "#️⃣" },
    { step: t("landing.wf.image"), cost: 5, icon: "🎨" },
    { step: t("landing.wf.sensitivity"), cost: 1, icon: "🛡️" },
    { step: t("landing.wf.create"), cost: 1, icon: "📄" },
    { step: t("landing.wf.publish"), cost: 2, icon: "🚀" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 via-white to-gray-50">
      <header className="flex items-center justify-between px-6 md:px-12 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <BookOpen className="h-7 w-7 text-red-500" />
          <span className="font-bold text-xl">{t("app.name")}</span>
        </div>
        <div className="flex gap-3 items-center">
          <a href="#features" className="text-sm text-gray-600 hover:text-gray-900 hidden sm:inline">
            {lang === "zh" ? "功能" : "Features"}
          </a>
          <a href="#pricing" className="text-sm text-gray-600 hover:text-gray-900 hidden sm:inline">
            {t("landing.navPricing")}
          </a>
          <button
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
          >
            <Globe className="h-4 w-4" />
            <span className="hidden sm:inline">{lang === "zh" ? "EN" : "中文"}</span>
          </button>
          <Link href="/sign-in">
            <Button variant="outline">{t("landing.navLogin")}</Button>
          </Link>
          <Link href="/sign-up">
            <Button className="bg-red-500 hover:bg-red-600 text-white">{t("landing.navRegister")}</Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="text-center py-20 px-6 max-w-4xl mx-auto relative">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-10 left-10 w-72 h-72 bg-red-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" />
          <div className="absolute top-20 right-10 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: "2s" }} />
          <div className="absolute bottom-10 left-1/2 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: "4s" }} />
        </div>
        <div className="inline-flex items-center gap-2 bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-full px-4 py-1.5 mb-6">
          <Sparkles className="h-4 w-4 text-red-500" />
          <span className="text-sm text-red-700 font-medium">{t("landing.heroBadge")}</span>
        </div>
        <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight tracking-tight">
          {t("landing.heroTitle1")}<br />
          <span className="bg-gradient-to-r from-red-500 via-pink-500 to-purple-500 bg-clip-text text-transparent">{t("landing.heroHighlight")}</span>
          {t("landing.heroTitle2")}
        </h1>
        <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto leading-relaxed">
          {t("landing.heroDesc")}
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link href="/sign-up">
            <Button size="lg" className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white text-lg px-8 shadow-lg shadow-red-500/25">
              {t("landing.heroCta")} <ArrowRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
          <a href="#how-it-works">
            <Button size="lg" variant="outline" className="text-lg px-8">
              {lang === "zh" ? "了解工作流程" : "See How It Works"}
            </Button>
          </a>
        </div>

        <div className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto text-center">
          <div>
            <p className="text-3xl font-bold text-red-500">3</p>
            <p className="text-sm text-gray-500">{lang === "zh" ? "步完成发布" : "Steps to Publish"}</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-red-500">3</p>
            <p className="text-sm text-gray-500">{lang === "zh" ? "套AI方案" : "AI Content Plans"}</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-red-500">3</p>
            <p className="text-sm text-gray-500">{lang === "zh" ? "个地区覆盖" : "Regions Covered"}</p>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="bg-red-100 text-red-600 mb-4">{lang === "zh" ? "AI全自动流程" : "AI Automated Workflow"}</Badge>
            <h2 className="text-3xl font-bold mb-3">{t("landing.howItWorksTitle")}</h2>
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

      {/* Features Section */}
      <section id="features" className="py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="bg-purple-100 text-purple-600 mb-4">{lang === "zh" ? "核心能力" : "Core Capabilities"}</Badge>
            <h2 className="text-3xl font-bold mb-3">{t("landing.featuresTitle")}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <div
                key={i}
                className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-md transition-all hover:-translate-y-1"
              >
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

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="bg-amber-100 text-amber-600 mb-4">{lang === "zh" ? "灵活定价" : "Flexible Pricing"}</Badge>
            <h2 className="text-3xl font-bold mb-3">{t("landing.pricingTitle")}</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              {t("landing.pricingSubtitle")}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {lang === "zh" ? "所有价格以美元 (USD) 显示，适用于所有地区" : "All prices shown in USD, applicable worldwide"}
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
                    <Badge className={`${plan.badgeColor} text-xs px-3 py-0.5 font-medium`}>
                      {plan.badge}
                    </Badge>
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
                      ? t("landing.plan.freeCredits")
                      : (lang === "zh"
                          ? `每月${plan.credits}积分 ≈ ${Math.floor(plan.credits / 20)}次完整发布`
                          : `${plan.credits} credits/mo ≈ ${Math.floor(plan.credits / 20)} full publishes`)}
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
                  <Button className={`w-full ${plan.ctaStyle}`} size="lg">
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-8">
            <div className="flex flex-col md:flex-row gap-8">
              <div className="md:w-1/2">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="h-5 w-5 text-amber-500" />
                  <h3 className="text-xl font-bold">{t("landing.creditPacks")}</h3>
                </div>
                <p className="text-sm text-gray-600 mb-5">
                  {t("landing.creditPacksDesc")}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {creditPacks.map((pack) => (
                    <div
                      key={pack.credits}
                      className={`relative rounded-xl border-2 p-4 text-center transition-shadow hover:shadow-md ${
                        pack.popular ? "border-red-500 bg-red-50" : "border-gray-200"
                      }`}
                    >
                      {pack.popular && (
                        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                          <Badge className="bg-red-500 text-white text-[10px] px-2">{t("landing.creditPackBest")}</Badge>
                        </div>
                      )}
                      <p className="text-2xl font-bold text-amber-600">{pack.credits}</p>
                      <p className="text-xs text-gray-500 mb-2">{t("landing.creditPackUnit")}</p>
                      <p className="text-lg font-bold">${pack.price}</p>
                      <p className="text-[10px] text-gray-400">~${pack.perCredit}/{lang === "zh" ? "积分" : "credit"}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="md:w-1/2">
                <div className="flex items-center gap-2 mb-4">
                  <Coins className="h-5 w-5 text-amber-500" />
                  <h3 className="text-lg font-bold">{t("landing.workflowTitle")}</h3>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  {t("landing.workflowDesc")}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {workflowCosts.map((item) => (
                    <div
                      key={item.step}
                      className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg"
                    >
                      <span className="text-xs text-gray-700">
                        {item.icon} {item.step}
                      </span>
                      <Badge variant="secondary" className="text-[10px] font-bold">
                        {item.cost} {t("landing.creditUnit")}
                      </Badge>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between px-3 py-2 bg-amber-50 rounded-lg border border-amber-200">
                  <span className="text-sm font-medium text-amber-800">{t("landing.workflowTotal")}</span>
                  <Badge className="bg-amber-100 text-amber-800 font-bold">{t("landing.workflowTotalValue")}</Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-6 max-w-4xl mx-auto text-center">
        <div className="bg-gradient-to-r from-red-500 via-pink-500 to-purple-600 rounded-2xl p-10 text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 left-0 w-40 h-40 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute bottom-0 right-0 w-60 h-60 bg-white rounded-full translate-x-1/3 translate-y-1/3" />
          </div>
          <div className="relative z-10">
            <Crown className="h-10 w-10 mx-auto mb-4 opacity-90" />
            <h2 className="text-2xl font-bold mb-3">{t("landing.ctaTitle")}</h2>
            <p className="text-red-100 mb-6 max-w-md mx-auto">
              {t("landing.ctaDesc")}
            </p>
            <Link href="/sign-up">
              <Button size="lg" className="bg-white text-red-600 hover:bg-red-50 text-lg px-8 font-bold shadow-lg">
                {t("landing.ctaButton")} <ArrowRight className="h-5 w-5 ml-1" />
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
