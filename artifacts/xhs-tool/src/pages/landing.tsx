import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BookOpen, Wand2, ShieldCheck, Image, Calendar, Users } from "lucide-react";

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

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-white">
      <header className="flex items-center justify-between px-6 md:px-12 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <BookOpen className="h-7 w-7 text-red-500" />
          <span className="font-bold text-xl">小红书AI工具</span>
        </div>
        <div className="flex gap-3">
          <Link href="/sign-in">
            <Button variant="outline">登录</Button>
          </Link>
          <Link href="/sign-up">
            <Button className="bg-red-500 hover:bg-red-600 text-white">免费注册</Button>
          </Link>
        </div>
      </header>

      <section className="text-center py-20 px-6 max-w-4xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
          用AI打造爆款<span className="text-red-500">小红书</span>内容
        </h1>
        <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
          一站式小红书内容创作与管理平台。AI改写、敏感词检测、多账号管理，让你的运营效率翻倍。
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/sign-up">
            <Button size="lg" className="bg-red-500 hover:bg-red-600 text-white text-lg px-8">
              开始使用
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

      <footer className="border-t border-gray-100 py-8 text-center text-sm text-gray-400">
        小红书AI工具 · 高效内容管理平台
      </footer>
    </div>
  );
}
