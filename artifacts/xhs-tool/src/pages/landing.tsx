import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Wand2, ShieldCheck, Image, Calendar, Users,
  Check, Zap, Crown, Sparkles, ArrowRight, Coins
} from "lucide-react";

const features = [
  {
    icon: Wand2,
    title: "AI智能改写",
    desc: "参考竞品内容，AI一键改写为原创笔记",
  },
  {
    icon: ShieldCheck,
    title: "敏感词检测",
    desc: "自动检测违规词汇，降低限流风险",
  },
  {
    icon: Image,
    title: "AI生成配图",
    desc: "根据内容自动生成精美配图",
  },
  {
    icon: Users,
    title: "多账号管理",
    desc: "支持新加坡、香港、马来西亚多地区账号",
  },
  {
    icon: Calendar,
    title: "定时发布",
    desc: "提前规划发布时间，高效管理内容排期",
  },
  {
    icon: BookOpen,
    title: "素材管理",
    desc: "集中管理图片视频素材，随时调用",
  },
];

const plans = [
  {
    name: "免费体验",
    price: "¥0",
    period: "",
    desc: "注册即享完整功能体验",
    credits: 20,
    highlight: false,
    badge: "新用户专享",
    badgeColor: "bg-green-100 text-green-700",
    features: [
      "赠送20积分（完整体验1次发布流程）",
      "AI竞品分析 + AI改写",
      "AI生成标题、标签、配图",
      "敏感词安全检测",
      "1个小红书账号",
      "AI运营助手指导",
    ],
    cta: "免费注册体验",
    ctaLink: "/sign-up",
    ctaStyle: "bg-gray-900 hover:bg-gray-800 text-white",
  },
  {
    name: "初级版",
    price: "¥99",
    period: "/月",
    desc: "个人博主 · 每周发布1篇",
    credits: 100,
    highlight: true,
    badge: "推荐",
    badgeColor: "bg-red-100 text-red-600",
    features: [
      "每月100积分（约4-5次完整发布）",
      "全部AI功能无限制",
      "AI竞品分析 + 内容方案生成",
      "AI配图生成（DALL-E 3）",
      "1个小红书账号",
      "AI运营助手无限咨询",
      "积分不足可购买加油包",
    ],
    cta: "立即开通",
    ctaLink: "/sign-up",
    ctaStyle: "bg-red-500 hover:bg-red-600 text-white",
  },
  {
    name: "高级版",
    price: "¥299",
    period: "/月",
    desc: "团队运营 · 多账号矩阵",
    credits: 500,
    highlight: false,
    badge: "专业",
    badgeColor: "bg-purple-100 text-purple-700",
    features: [
      "每月500积分（约25次完整发布）",
      "全部AI功能无限制",
      "不限小红书账号数量",
      "多地区账号矩阵运营",
      "AI运营助手优先响应",
      "专属积分价格优惠",
      "定制化需求支持",
    ],
    cta: "联系开通",
    ctaLink: "/sign-up",
    ctaStyle: "bg-purple-600 hover:bg-purple-700 text-white",
  },
];

const creditPacks = [
  { credits: 50, price: 29, perCredit: "0.58" },
  { credits: 200, price: 99, perCredit: "0.50", popular: true },
  { credits: 500, price: 199, perCredit: "0.40" },
];

const workflowCosts = [
  { step: "AI竞品分析", cost: 5, icon: "🔍" },
  { step: "AI智能改写", cost: 3, icon: "✨" },
  { step: "AI生成标题", cost: 1, icon: "📝" },
  { step: "AI生成标签", cost: 1, icon: "#️⃣" },
  { step: "AI生成配图", cost: 5, icon: "🎨" },
  { step: "敏感词检测", cost: 1, icon: "🛡️" },
  { step: "创建内容", cost: 1, icon: "📄" },
  { step: "发布内容", cost: 2, icon: "🚀" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-white">
      <header className="flex items-center justify-between px-6 md:px-12 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <BookOpen className="h-7 w-7 text-red-500" />
          <span className="font-bold text-xl">小红书AI工具</span>
        </div>
        <div className="flex gap-3 items-center">
          <a href="#pricing" className="text-sm text-gray-600 hover:text-gray-900 hidden sm:inline">
            价格方案
          </a>
          <Link href="/sign-in">
            <Button variant="outline">登录</Button>
          </Link>
          <Link href="/sign-up">
            <Button className="bg-red-500 hover:bg-red-600 text-white">免费注册</Button>
          </Link>
        </div>
      </header>

      <section className="text-center py-20 px-6 max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 mb-6">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-sm text-amber-700 font-medium">新用户注册即送20积分，免费体验完整流程</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
          用AI打造爆款<span className="text-red-500">小红书</span>内容
        </h1>
        <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
          一站式小红书内容创作与管理平台。AI改写、敏感词检测、多账号管理，让你的运营效率翻倍。
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/sign-up">
            <Button size="lg" className="bg-red-500 hover:bg-red-600 text-white text-lg px-8">
              免费开始体验 <ArrowRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>

      <section className="py-16 px-6 max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-12">核心功能</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-md transition-shadow"
            >
              <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center mb-4">
                <f.icon className="h-6 w-6 text-red-500" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-gray-600 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-3">选择适合你的方案</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              首次注册免费体验完整发布流程，按需选择付费方案持续运营
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-white rounded-2xl p-6 border-2 transition-shadow hover:shadow-lg flex flex-col ${
                  plan.highlight ? "border-red-500 shadow-md" : "border-gray-100"
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
                      ? "赠送20积分 = 1次完整发布"
                      : `每月${plan.credits}积分 ≈ ${Math.floor(plan.credits / 20)}次完整发布`}
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
                  <h3 className="text-xl font-bold">积分加油包</h3>
                </div>
                <p className="text-sm text-gray-600 mb-5">
                  积分不够？随时购买加油包补充。买得越多，单价越优惠。
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
                          <Badge className="bg-red-500 text-white text-[10px] px-2">超值</Badge>
                        </div>
                      )}
                      <p className="text-2xl font-bold text-amber-600">{pack.credits}</p>
                      <p className="text-xs text-gray-500 mb-2">积分</p>
                      <p className="text-lg font-bold">¥{pack.price}</p>
                      <p className="text-[10px] text-gray-400">约¥{pack.perCredit}/积分</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="md:w-1/2">
                <div className="flex items-center gap-2 mb-4">
                  <Coins className="h-5 w-5 text-amber-500" />
                  <h3 className="text-lg font-bold">一次完整发布消耗明细</h3>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  以下为使用全部AI功能完成一篇笔记的积分消耗参考（约19-20积分）
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
                        {item.cost}积分
                      </Badge>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between px-3 py-2 bg-amber-50 rounded-lg border border-amber-200">
                  <span className="text-sm font-medium text-amber-800">完整发布合计</span>
                  <Badge className="bg-amber-100 text-amber-800 font-bold">~20积分/次</Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 px-6 max-w-4xl mx-auto text-center">
        <div className="bg-gradient-to-r from-red-500 to-red-600 rounded-2xl p-10 text-white">
          <Crown className="h-10 w-10 mx-auto mb-4 opacity-90" />
          <h2 className="text-2xl font-bold mb-3">现在注册，免费体验完整流程</h2>
          <p className="text-red-100 mb-6 max-w-md mx-auto">
            20积分足够完成一次从竞品分析到发布的完整体验，感受AI运营的效率提升
          </p>
          <Link href="/sign-up">
            <Button size="lg" className="bg-white text-red-600 hover:bg-red-50 text-lg px-8 font-bold">
              免费注册开始 <ArrowRight className="h-5 w-5 ml-1" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-gray-100 py-8 text-center text-sm text-gray-400">
        小红书AI工具 · 高效内容管理平台
      </footer>
    </div>
  );
}
