# AutoDL 部署指南 - 鹿联小红书AI工具

## 服务概览

在AutoDL GPU服务器上部署两个核心服务：

1. **小红书数据采集服务** (端口6000) — 基于 ReaJason/xhs，获取真实同行数据
2. **ComfyUI 伪原创图片服务** (端口8188) — 基于 Stable Diffusion img2img，生成伪原创配图

## 部署步骤

### 1. 登录AutoDL JupyterLab

在AutoDL控制台点击你的实例 → JupyterLab → 打开终端

### 2. 上传并运行部署脚本

```bash
# 方法一：直接在终端中粘贴 setup.sh 的内容运行
# 方法二：通过JupyterLab上传 setup.sh 文件后运行
bash setup.sh
```

### 3. 设置小红书Cookie

```bash
# 从浏览器复制小红书Cookie后设置环境变量
export XHS_COOKIE="你的cookie内容"
```

获取Cookie方法：
1. Chrome打开 https://www.xiaohongshu.com 并登录
2. F12 → Network → 随便点一个请求
3. 找到 Request Headers 里的 Cookie 行 → 复制全部内容

### 4. 下载模型文件

```bash
cd /root/lulian-services/ComfyUI/models/checkpoints
# SDXL基础模型
wget https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors

cd /root/lulian-services/ComfyUI/models/ipadapter
# IPAdapter模型
wget https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors

cd /root/lulian-services/ComfyUI/models/clip_vision
# CLIP Vision模型
wget -O CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors
```

### 5. 启动服务

```bash
cd /root/lulian-services
bash start_all.sh
```

### 6. 配置AutoDL自定义服务

在AutoDL控制台 → 你的实例行 → 点击「自定义服务」：
- 添加端口 `6000`（小红书数据服务）
- 添加端口 `8188`（ComfyUI服务）

AutoDL会生成外网访问地址，格式类似：
- `https://u-xxxxx-6000.westc.gpuhub.com`
- `https://u-xxxxx-8188.westc.gpuhub.com`

### 7. 配置Replit环境变量

将以下信息配置到Replit的环境变量中：
- `AUTODL_XHS_URL` = AutoDL小红书服务的外网地址
- `AUTODL_COMFYUI_URL` = AutoDL ComfyUI服务的外网地址
- `AUTODL_API_KEY` = 启动时生成的API密钥

## 管理命令

```bash
# 启动所有服务
cd /root/lulian-services && bash start_all.sh

# 停止所有服务
cd /root/lulian-services && bash stop_all.sh

# 查看日志
tail -f /root/sign_server.log   # 签名服务
tail -f /root/xhs_service.log   # 小红书数据
tail -f /root/comfyui.log       # ComfyUI
```

## API接口说明

### 小红书数据服务 (端口6000)

所有请求需要在Header中添加 `X-API-Key: 你的API密钥`

| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/xhs/search` | POST | 关键词搜索笔记 |
| `/api/xhs/note/:id` | GET | 获取笔记详情 |
| `/api/xhs/user/:id/notes` | GET | 获取用户所有笔记 |

#### 搜索笔记
```json
POST /api/xhs/search
{
  "keyword": "新加坡美食",
  "page": 1,
  "sort": "general"
}
```

#### 返回数据
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

### ComfyUI服务 (端口8188)

| 接口 | 方法 | 说明 |
|------|------|------|
| `/upload/image` | POST | 上传参考图 |
| `/prompt` | POST | 提交img2img工作流 |
| `/view` | GET | 获取生成结果图片 |
| `/history/:id` | GET | 查询生成状态 |

## 注意事项

- 小红书Cookie会过期，需要定期更新（约1-2周）
- ComfyUI首次启动需要加载模型，可能需要1-2分钟
- AutoDL实例关机后需要重新运行 start_all.sh
- 建议将Cookie和API Key写入 ~/.bashrc 以便自动加载
