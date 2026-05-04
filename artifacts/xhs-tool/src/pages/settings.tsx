import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Database, Brain, Globe } from "lucide-react";

export default function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">设置</h1>
        <p className="text-muted-foreground">系统配置与信息</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">AI模型</span>
              <Badge variant="outline">GPT-4o Mini</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">内容改写</span>
              <Badge variant="default">已启用</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">敏感词检测</span>
              <Badge variant="default">已启用</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">标题生成</span>
              <Badge variant="default">已启用</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">标签生成</span>
              <Badge variant="default">已启用</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4" />
              支持地区
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">🇸🇬 新加坡 (SG)</span>
              <Badge variant="default">已启用</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">🇭🇰 香港 (HK)</span>
              <Badge variant="default">已启用</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">🇲🇾 马来西亚 (MY)</span>
              <Badge variant="default">已启用</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" />
              数据库
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">数据库类型</span>
              <Badge variant="outline">PostgreSQL</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">连接状态</span>
              <Badge variant="default">已连接</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <SettingsIcon className="h-4 w-4" />
              系统信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">版本</span>
              <Badge variant="outline">v1.0.0</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">框架</span>
              <Badge variant="outline">React + Vite</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">后端</span>
              <Badge variant="outline">Express + Drizzle</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
