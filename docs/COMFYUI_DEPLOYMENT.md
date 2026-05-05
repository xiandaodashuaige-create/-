# ComfyUI 部署指南 (AutoDL RTX 4090D × 2)

针对鹿联小红书AI工具的"复刻同行爆款图"功能，本指南指导你在 AutoDL RTX 4090D × 2 实例上部署 ComfyUI + FLUX.1-dev + Redux + ControlNet + AnyText2 完整工作流。

## 硬件适配 (RTX 4090D × 2 / 48GB 总显存)

每张 4090D 24GB 显存，推荐分卡布局：

- **GPU 0**: FLUX.1-dev fp8 (主生成器, ~17GB) + Redux + ControlNet
- **GPU 1**: AnyText2 (中文文字渲染, ~6GB) + 备用预留

`fp8` 量化版本在 4090D 上速度最优、画质损失可忽略。

---

## 1. 系统准备

```bash
# SSH 进入 AutoDL 实例
ssh -p <端口> root@<AutoDL地址>

# 切换到数据盘
cd /root/autodl-tmp

# 系统包
apt update && apt install -y git wget aria2 ffmpeg libgl1
```

## 2. 安装 ComfyUI

```bash
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI

# Python 环境
pip install --upgrade pip
pip install torch==2.4.0 torchvision --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

## 3. 安装必备节点 (Custom Nodes)

```bash
cd custom_nodes

# ComfyUI Manager (插件管理器)
git clone https://github.com/ltdrdata/ComfyUI-Manager.git

# ControlNet 预处理器 (Canny/Depth)
git clone https://github.com/Fannovel16/comfyui_controlnet_aux.git
cd comfyui_controlnet_aux && pip install -r requirements.txt && cd ..

# AnyText2 中文文字渲染
git clone https://github.com/zhangp365/ComfyUI-AnyText.git
cd ComfyUI-AnyText && pip install -r requirements.txt && cd ..
```

## 4. 下载模型 (~40GB)

```bash
cd /root/autodl-tmp/ComfyUI/models

# FLUX.1-dev fp8 主模型 (16GB)
aria2c -x 16 -d checkpoints \
  "https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors"

# FLUX.1 Redux 风格参考模型 (1.2GB)
mkdir -p style_models
aria2c -x 16 -d style_models \
  "https://huggingface.co/black-forest-labs/FLUX.1-Redux-dev/resolve/main/flux1-redux-dev.safetensors"

# CLIP Vision (Redux 必需, 3.4GB)
mkdir -p clip_vision
aria2c -x 16 -d clip_vision \
  "https://huggingface.co/Comfy-Org/sigclip_vision_384/resolve/main/sigclip_vision_patch14_384.safetensors"

# FLUX ControlNet Union Pro (统一controlnet, 6.6GB)
mkdir -p controlnet
aria2c -x 16 -d controlnet \
  "https://huggingface.co/Shakker-Labs/FLUX.1-dev-ControlNet-Union-Pro/resolve/main/diffusion_pytorch_model.safetensors" \
  -o FLUX.1-dev-Controlnet-Union-Pro.safetensors

# AnyText2 模型 (中文文字, ~2GB)
# 按 ComfyUI-AnyText 节点的 README 下载到 models/anytext/
```

## 5. 启动 ComfyUI

```bash
cd /root/autodl-tmp/ComfyUI

# 后台启动, 监听所有 IP, 默认 8188 端口
nohup python main.py --listen 0.0.0.0 --port 8188 > comfyui.log 2>&1 &
```

## 6. AutoDL 端口暴露给鹿联后端

AutoDL 默认不暴露公网端口，有两种方案：

### 方案 A: AutoDL 自带的"自定义服务" (推荐)

1. 控制台 → 容器实例 → "自定义服务" → 填入端口 `8188`
2. 拿到形如 `https://u<id>-<hash>.autodl.cloud/` 的 HTTPS 地址
3. 在鹿联 Replit 的 Secrets 里设置: `COMFYUI_URL=https://u<id>-<hash>.autodl.cloud`

### 方案 B: Cloudflare Tunnel (永久免费, 更稳)

```bash
# 在 AutoDL 实例上
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared-linux-amd64 && mv cloudflared-linux-amd64 /usr/local/bin/cloudflared

# 临时隧道 (测试用)
cloudflared tunnel --url http://localhost:8188

# 拿到形如 https://xxx-xxx-xxx.trycloudflare.com 的地址
# 设置到 Replit Secrets: COMFYUI_URL=<上面的地址>
```

## 7. 验证连通性

```bash
# 在 Replit Shell 测试
curl $COMFYUI_URL/system_stats
# 应返回 JSON, 包含 GPU 信息
```

## 8. 鹿联后端集成

环境变量已支持，**只要设置 `COMFYUI_URL` 这个 secret，后端会自动**：
- 优先调用 ComfyUI (FLUX + Redux + ControlNet)
- ComfyUI 不可达时自动降级到 OpenAI gpt-image-1
- 健康检查每次调用前执行，5秒超时不阻塞用户

## 9. 单图生成耗时参考

| 配置 | 耗时 |
|---|---|
| FLUX fp8 + Redux + ControlNet, 25步, 768×1152 | 18-25秒 |
| + AnyText2 文字叠加 | +5-8秒 |
| **总计** | **~25-35秒/张** |

## 10. 成本对比

| 方案 | 单图成本 |
|---|---|
| OpenAI gpt-image-1 (high quality, 1024×1536) | $0.19 |
| AutoDL RTX 4090D × 2 (~¥3000/月，假设月生成 1万张) | ¥0.3 ≈ $0.04 |
| **节省** | **~80%** |

---

## 故障排查

### Q: ComfyUI 启动报"CUDA out of memory"
A: 加 `--lowvram` 或 `--medvram` 启动参数。

### Q: AnyText2 节点装不上
A: 可以暂不装，pipeline 会降级用 GPT-image-1 渲染文字（gpt-image-1 中文文字目前业内最强）。

### Q: 文字渲染依然崩
A: 短期建议：FLUX 出图（无文字）+ 后端用 Pillow 库直接叠中文字（最稳，0失败率）。
