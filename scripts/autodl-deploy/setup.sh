#!/bin/bash
set -e

echo "=========================================="
echo "  鹿联小红书AI工具 - AutoDL一键部署脚本"
echo "  同行数据采集 + ComfyUI伪原创图片"
echo "=========================================="

DEPLOY_DIR="/root/lulian-services"
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

echo ""
echo "[1/6] 安装Python依赖..."
pip install flask gunicorn xhs playwright requests pillow -q
playwright install chromium

echo ""
echo "[2/6] 部署小红书数据采集服务..."
mkdir -p xhs-service
cat > xhs-service/app.py << 'XHSEOF'
import os
import json
import time
import threading
from flask import Flask, request, jsonify
from functools import wraps

app = Flask(__name__)

API_KEY = os.environ.get("LULIAN_API_KEY", "lulian-default-key-change-me")
XHS_COOKIE = os.environ.get("XHS_COOKIE", "")

sign_server_ready = False
xhs_client = None

def init_xhs_client():
    global xhs_client, sign_server_ready
    try:
        import requests as req
        from xhs import XhsClient

        def sign(uri, data=None, a1="", web_session=""):
            res = req.post("http://localhost:5005/sign", json={
                "uri": uri, "data": data, "a1": a1, "web_session": web_session
            }, timeout=10)
            signs = res.json()
            return {"x-s": signs["x-s"], "x-t": signs["x-t"]}

        xhs_client = XhsClient(cookie=XHS_COOKIE, sign=sign)
        sign_server_ready = True
        print("[XHS] Client initialized successfully")
    except Exception as e:
        print(f"[XHS] Client init failed: {e}")

def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get("X-API-Key", "")
        if key != API_KEY:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "xhs_ready": sign_server_ready,
        "services": ["xhs-data", "comfyui-image"]
    })

@app.route("/api/xhs/search", methods=["POST"])
@require_api_key
def search_notes():
    if not xhs_client:
        return jsonify({"error": "XHS client not ready"}), 503
    data = request.json
    keyword = data.get("keyword", "")
    page = data.get("page", 1)
    sort = data.get("sort", "general")
    if not keyword:
        return jsonify({"error": "keyword is required"}), 400
    try:
        result = xhs_client.get_note_by_keyword(
            keyword=keyword,
            page=page,
            sort=sort
        )
        notes = []
        if result and "items" in result:
            for item in result["items"][:20]:
                note_card = item.get("note_card", {})
                interact_info = note_card.get("interact_info", {})
                user = note_card.get("user", {})
                notes.append({
                    "id": item.get("id", ""),
                    "title": note_card.get("display_title", ""),
                    "desc": note_card.get("desc", ""),
                    "type": note_card.get("type", ""),
                    "liked_count": interact_info.get("liked_count", "0"),
                    "collected_count": interact_info.get("collected_count", "0"),
                    "comment_count": interact_info.get("comment_count", "0"),
                    "share_count": interact_info.get("share_count", "0"),
                    "author": user.get("nickname", ""),
                    "author_id": user.get("user_id", ""),
                    "cover": note_card.get("cover", {}).get("url_default", ""),
                    "tags": [t.get("name", "") for t in note_card.get("tag_list", [])],
                })
        return jsonify({"notes": notes, "total": len(notes)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/xhs/note/<note_id>", methods=["GET"])
@require_api_key
def get_note_detail(note_id):
    if not xhs_client:
        return jsonify({"error": "XHS client not ready"}), 503
    try:
        result = xhs_client.get_note_by_id(note_id)
        if not result:
            return jsonify({"error": "Note not found"}), 404
        note = result.get("note_card", result)
        interact_info = note.get("interact_info", {})
        user = note.get("user", {})
        image_list = []
        for img in note.get("image_list", []):
            url = img.get("url_default", "") or img.get("url", "")
            if url:
                image_list.append(url)
        return jsonify({
            "id": note_id,
            "title": note.get("display_title", note.get("title", "")),
            "desc": note.get("desc", ""),
            "content": note.get("desc", ""),
            "type": note.get("type", ""),
            "liked_count": interact_info.get("liked_count", "0"),
            "collected_count": interact_info.get("collected_count", "0"),
            "comment_count": interact_info.get("comment_count", "0"),
            "share_count": interact_info.get("share_count", "0"),
            "author": user.get("nickname", ""),
            "author_id": user.get("user_id", ""),
            "images": image_list,
            "tags": [t.get("name", "") for t in note.get("tag_list", [])],
            "time": note.get("time", ""),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/xhs/user/<user_id>/notes", methods=["GET"])
@require_api_key
def get_user_notes(user_id):
    if not xhs_client:
        return jsonify({"error": "XHS client not ready"}), 503
    try:
        cursor = request.args.get("cursor", "")
        result = xhs_client.get_user_notes(user_id=user_id, cursor=cursor)
        notes = []
        if result and "notes" in result:
            for note in result["notes"][:30]:
                interact_info = note.get("interact_info", {})
                notes.append({
                    "id": note.get("note_id", ""),
                    "title": note.get("display_title", ""),
                    "type": note.get("type", ""),
                    "liked_count": interact_info.get("liked_count", "0"),
                    "cover": note.get("cover", {}).get("url", ""),
                })
        return jsonify({
            "notes": notes,
            "cursor": result.get("cursor", ""),
            "has_more": result.get("has_more", False)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    threading.Thread(target=init_xhs_client, daemon=True).start()
    app.run(host="0.0.0.0", port=6000, debug=False)
XHSEOF

echo ""
echo "[3/6] 创建签名服务..."
cat > xhs-service/sign_server.py << 'SIGNEOF'
import json
from flask import Flask, request, jsonify
from playwright.sync_api import sync_playwright

app = Flask(__name__)
context_page = None
cookie_dict = {}

def init_browser():
    global context_page, cookie_dict
    import os
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    xhs_cookie = os.environ.get("XHS_COOKIE", "")
    if xhs_cookie:
        cookies = []
        for item in xhs_cookie.split(";"):
            item = item.strip()
            if "=" in item:
                name, value = item.split("=", 1)
                cookies.append({
                    "name": name.strip(),
                    "value": value.strip(),
                    "domain": ".xiaohongshu.com",
                    "path": "/"
                })
                cookie_dict[name.strip()] = value.strip()
        context.add_cookies(cookies)
    context_page = context.new_page()
    context_page.goto("https://www.xiaohongshu.com/explore", wait_until="domcontentloaded", timeout=30000)
    context_page.wait_for_timeout(3000)
    print("[Sign Server] Browser initialized, ready to sign requests")

@app.route("/sign", methods=["POST"])
def sign():
    data = request.json
    uri = data.get("uri", "")
    payload = data.get("data", None)
    try:
        encrypt_params = context_page.evaluate(
            "([url, data]) => window._webmsxyw(url, data)",
            [uri, json.dumps(payload) if payload else None]
        )
        return jsonify({
            "x-s": encrypt_params.get("X-s", ""),
            "x-t": str(encrypt_params.get("X-t", ""))
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    init_browser()
    app.run(host="0.0.0.0", port=5005, debug=False)
SIGNEOF

echo ""
echo "[4/6] 安装ComfyUI..."
if [ ! -d "ComfyUI" ]; then
    git clone https://github.com/comfyanonymous/ComfyUI.git
    cd ComfyUI
    pip install -r requirements.txt -q
    cd custom_nodes
    git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus.git
    git clone https://github.com/ltdrdata/ComfyUI-Manager.git
    cd ../..
    echo "[ComfyUI] Installed successfully"
else
    echo "[ComfyUI] Already installed, skipping"
fi

echo ""
echo "[5/6] 下载必要模型..."
COMFY_DIR="$DEPLOY_DIR/ComfyUI"
mkdir -p "$COMFY_DIR/models/checkpoints"
mkdir -p "$COMFY_DIR/models/ipadapter"
mkdir -p "$COMFY_DIR/models/clip_vision"

if [ ! -f "$COMFY_DIR/models/checkpoints/sd_xl_base_1.0.safetensors" ]; then
    echo "正在下载SDXL基础模型（约6.5GB）..."
    echo "请手动下载以下模型到对应目录："
    echo "  SDXL Base: https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
    echo "  → 放到: $COMFY_DIR/models/checkpoints/"
    echo ""
    echo "  IPAdapter SDXL: https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors"
    echo "  → 放到: $COMFY_DIR/models/ipadapter/"
    echo ""
    echo "  CLIP Vision: https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors"
    echo "  → 放到: $COMFY_DIR/models/clip_vision/ (重命名为 CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors)"
    echo ""
    echo "提示: 在AutoDL上可以用 wget 或 huggingface-cli 下载"
else
    echo "模型已存在，跳过下载"
fi

echo ""
echo "[6/6] 创建启动脚本..."
cat > start_all.sh << 'STARTEOF'
#!/bin/bash
echo "=========================================="
echo "  启动鹿联AI服务"
echo "=========================================="

if [ -z "$XHS_COOKIE" ]; then
    echo "⚠️  请先设置小红书Cookie:"
    echo '  export XHS_COOKIE="你的cookie内容"'
    echo ""
fi

if [ -z "$LULIAN_API_KEY" ]; then
    export LULIAN_API_KEY="lulian-$(date +%s)-key"
    echo "🔑 已生成API密钥: $LULIAN_API_KEY"
    echo "   请将此密钥配置到Replit的环境变量中"
fi

DEPLOY_DIR="/root/lulian-services"

echo ""
echo "[1/3] 启动签名服务 (端口5005)..."
cd "$DEPLOY_DIR/xhs-service"
nohup python sign_server.py > /root/sign_server.log 2>&1 &
echo "  PID: $!"
sleep 5

echo "[2/3] 启动小红书数据服务 (端口6000)..."
nohup python app.py > /root/xhs_service.log 2>&1 &
echo "  PID: $!"

echo "[3/3] 启动ComfyUI (端口8188)..."
cd "$DEPLOY_DIR/ComfyUI"
nohup python main.py --listen 0.0.0.0 --port 8188 > /root/comfyui.log 2>&1 &
echo "  PID: $!"

echo ""
echo "=========================================="
echo "  所有服务已启动！"
echo "=========================================="
echo ""
echo "服务端口:"
echo "  - 签名服务: localhost:5005 (内部)"
echo "  - 小红书数据: localhost:6000"
echo "  - ComfyUI:   localhost:8188"
echo ""
echo "AutoDL自定义服务映射:"
echo "  在AutoDL控制台 → 你的实例 → 自定义服务"
echo "  映射端口6000即可通过外网访问小红书数据服务"
echo "  映射端口8188即可通过外网访问ComfyUI服务"
echo ""
echo "查看日志:"
echo "  tail -f /root/sign_server.log"
echo "  tail -f /root/xhs_service.log"
echo "  tail -f /root/comfyui.log"
STARTEOF
chmod +x start_all.sh

cat > stop_all.sh << 'STOPEOF'
#!/bin/bash
echo "停止所有服务..."
pkill -f "sign_server.py" 2>/dev/null
pkill -f "xhs-service/app.py" 2>/dev/null
pkill -f "ComfyUI/main.py" 2>/dev/null
echo "所有服务已停止"
STOPEOF
chmod +x stop_all.sh

echo ""
echo "=========================================="
echo "  部署脚本创建完成！"
echo "=========================================="
echo ""
echo "📋 接下来的步骤："
echo ""
echo "1. 将此脚本上传到AutoDL服务器"
echo "   或者在AutoDL JupyterLab终端中粘贴运行"
echo ""
echo "2. 设置小红书Cookie环境变量:"
echo '   export XHS_COOKIE="你从浏览器复制的cookie"'
echo ""
echo "3. 启动所有服务:"
echo "   cd /root/lulian-services && bash start_all.sh"
echo ""
echo "4. 在AutoDL控制台设置自定义服务端口映射"
echo "   映射端口: 6000 (小红书数据) 和 8188 (ComfyUI)"
echo ""
