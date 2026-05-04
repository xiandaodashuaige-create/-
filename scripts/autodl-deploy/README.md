# AutoDL 部署指南 - 鹿联小红书AI工具

## 服务概览

在AutoDL GPU服务器上部署两个核心服务：

1. **小红书数据采集服务** (端口6006) — 基于 ReaJason/xhs，获取真实同行数据
2. **ComfyUI 伪原创图片服务** (端口6008) — 基于 Stable Diffusion img2img，生成伪原创配图

## 你的AutoDL外网地址

- 小红书数据: `https://u711560-88e3-c9b28838.cqa1.seetacloud.com:8443`
- ComfyUI: `https://u2711560-88e3-c9b28838.cqa1.seetacloud.com:8443`

## 部署步骤

### 第1步：打开AutoDL终端

在AutoDL控制台点击你的实例 → **JupyterLab** → 打开终端(Terminal)

### 第2步：获取小红书Cookie

1. Chrome浏览器打开 https://www.xiaohongshu.com 并登录
2. 按 F12 打开开发者工具
3. 点击顶部 **Network** 标签
4. 点击 **Fetch/XHR** 按钮过滤（只显示API请求）
5. 刷新页面，左边会出现新的请求
6. 点击任意一个请求（比如叫 "me" 或 "homefeed" 的）
7. 右边面板点击 **Headers** 标签
8. 往下滚动找到 **Request Headers** 区域
9. 找到 **cookie:** 那一行 → 选中全部cookie值 → 右键复制

### 第3步：运行部署脚本

在AutoDL终端中依次运行：

```bash
# 1. 创建工作目录
mkdir -p /root/lulian-services && cd /root/lulian-services

# 2. 把 setup.sh 的内容粘贴到终端运行
# （或者通过JupyterLab上传setup.sh文件后运行）
bash setup.sh

# 3. 设置Cookie（把下面的内容替换成你复制的Cookie）
export XHS_COOKIE="粘贴你的Cookie内容"

# 4. 启动所有服务
cd /root/lulian-services && bash start_all.sh
```

### 第4步：下载AI模型（首次需要）

```bash
cd /root/lulian-services/ComfyUI/models/checkpoints
# SDXL基础模型（约6.5GB）
wget https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors

cd /root/lulian-services/ComfyUI/models/ipadapter
# IPAdapter模型
wget https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors

cd /root/lulian-services/ComfyUI/models/clip_vision
# CLIP Vision模型
wget -O CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors
```

### 第5步：告诉Replit你的服务地址

部署完成后，需要在Replit中配置三个环境变量：
- `AUTODL_XHS_URL` = `https://u711560-88e3-c9b28838.cqa1.seetacloud.com:8443`
- `AUTODL_COMFYUI_URL` = `https://u2711560-88e3-c9b28838.cqa1.seetacloud.com:8443`
- `AUTODL_API_KEY` = 启动时终端显示的API密钥

## 日常管理

```bash
# 启动所有服务
cd /root/lulian-services && bash start_all.sh

# 停止所有服务
cd /root/lulian-services && bash stop_all.sh

# 查看日志
tail -f /root/sign_server.log   # 签名服务
tail -f /root/xhs_service.log   # 小红书数据
tail -f /root/comfyui.log       # ComfyUI

# 更新Cookie（Cookie过期后需要重新设置）
export XHS_COOKIE="新的cookie内容"
# 然后重启服务
bash stop_all.sh && bash start_all.sh
```

## API接口说明

### 小红书数据服务 (端口6006)

所有请求需要在Header中添加 `X-API-Key: 你的API密钥`

| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/xhs/search` | POST | 关键词搜索笔记 |
| `/api/xhs/note/:id` | GET | 获取笔记详情 |
| `/api/xhs/user/:id/notes` | GET | 获取用户所有笔记 |

#### 搜索笔记示例
```json
POST /api/xhs/search
{
  "keyword": "新加坡美食",
  "page": 1,
  "sort": "general"
}
```

#### 返回数据示例
```json
{
  "notes": [
    {
      "id": "笔记ID",
      "title": "标题",
      "liked_count": "1234",
      "collected_count": "567",
      "comment_count": "89",
      "author": "作者昵称",
      "cover": "封面图URL",
      "tags": ["标签1", "标签2"]
    }
  ]
}
```

### ComfyUI服务 (端口6008)

| 接口 | 方法 | 说明 |
|------|------|------|
| `/upload/image` | POST | 上传参考图 |
| `/prompt` | POST | 提交img2img工作流 |
| `/view` | GET | 获取生成结果图片 |
| `/history/:id` | GET | 查询生成状态 |

## 注意事项

- 小红书Cookie会过期，需要定期更新（约1-2周）
- ComfyUI首次启动需要加载模型到GPU，可能需要30秒-2分钟
- AutoDL实例关机后需要重新运行 start_all.sh
- 建议将Cookie写入 ~/.bashrc 以便开机自动加载：
  ```bash
  echo 'export XHS_COOKIE="你的cookie"' >> ~/.bashrc
  echo 'export LULIAN_API_KEY="你的密钥"' >> ~/.bashrc
  ```
