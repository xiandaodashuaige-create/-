#!/bin/bash
set -e
echo "=========================================="
echo "  鹿联小红书AI工具 - AutoDL快速部署"
echo "=========================================="

DEPLOY_DIR="/root/lulian-services"
mkdir -p "$DEPLOY_DIR/xhs-service"
cd "$DEPLOY_DIR"

echo "[1/4] 安装依赖..."
pip install flask gunicorn xhs playwright requests pillow -q 2>/dev/null
playwright install chromium 2>/dev/null
echo "  依赖安装完成"

echo "[2/4] 创建小红书数据服务..."
cat > xhs-service/sign_server.py << 'EOF1'
import json, os
from flask import Flask, request, jsonify
from playwright.sync_api import sync_playwright
app = Flask(__name__)
context_page = None
def init_browser():
    global context_page
    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    xhs_cookie = os.environ.get("XHS_COOKIE", "")
    if xhs_cookie:
        cookies = []
        for item in xhs_cookie.split(";"):
            item = item.strip()
            if "=" in item:
                n, v = item.split("=", 1)
                cookies.append({"name": n.strip(), "value": v.strip(), "domain": ".xiaohongshu.com", "path": "/"})
        ctx.add_cookies(cookies)
    context_page = ctx.new_page()
    context_page.goto("https://www.xiaohongshu.com/explore", wait_until="domcontentloaded", timeout=30000)
    context_page.wait_for_timeout(3000)
    print("[Sign] Ready")
@app.route("/sign", methods=["POST"])
def sign():
    data = request.json
    uri = data.get("uri", "")
    payload = data.get("data", None)
    try:
        r = context_page.evaluate("([url,data])=>window._webmsxyw(url,data)", [uri, json.dumps(payload) if payload else None])
        return jsonify({"x-s": r.get("X-s",""), "x-t": str(r.get("X-t",""))})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
if __name__ == "__main__":
    init_browser()
    app.run(host="0.0.0.0", port=5005)
EOF1

cat > xhs-service/app.py << 'EOF2'
import os, json, threading
from flask import Flask, request, jsonify
from functools import wraps
app = Flask(__name__)
API_KEY = os.environ.get("LULIAN_API_KEY", "lulian-default-key")
XHS_COOKIE = os.environ.get("XHS_COOKIE", "")
xhs_client = None
xhs_ready = False
def init_xhs():
    global xhs_client, xhs_ready
    try:
        import requests as req
        from xhs import XhsClient
        def sign(uri, data=None, a1="", web_session=""):
            r = req.post("http://localhost:5005/sign", json={"uri":uri,"data":data,"a1":a1,"web_session":web_session}, timeout=10)
            s = r.json()
            return {"x-s": s["x-s"], "x-t": s["x-t"]}
        xhs_client = XhsClient(cookie=XHS_COOKIE, sign=sign)
        xhs_ready = True
        print("[XHS] Client ready")
    except Exception as e:
        print(f"[XHS] Init failed: {e}")
def need_key(f):
    @wraps(f)
    def d(*a, **k):
        if request.headers.get("X-API-Key","") != API_KEY:
            return jsonify({"error":"Unauthorized"}), 401
        return f(*a, **k)
    return d
@app.route("/health")
def health():
    return jsonify({"status":"ok","xhs_ready":xhs_ready})
@app.route("/api/xhs/search", methods=["POST"])
@need_key
def search():
    if not xhs_client: return jsonify({"error":"Not ready"}), 503
    d = request.json
    kw = d.get("keyword","")
    if not kw: return jsonify({"error":"keyword required"}), 400
    try:
        r = xhs_client.get_note_by_keyword(keyword=kw, page=d.get("page",1), sort=d.get("sort","general"))
        notes = []
        for item in (r or {}).get("items",[])[:20]:
            nc = item.get("note_card",{})
            ii = nc.get("interact_info",{})
            u = nc.get("user",{})
            notes.append({"id":item.get("id",""),"title":nc.get("display_title",""),"desc":nc.get("desc","")[:200],"type":nc.get("type",""),"liked_count":ii.get("liked_count","0"),"collected_count":ii.get("collected_count","0"),"comment_count":ii.get("comment_count","0"),"share_count":ii.get("share_count","0"),"author":u.get("nickname",""),"author_id":u.get("user_id",""),"cover":nc.get("cover",{}).get("url_default",""),"tags":[t.get("name","") for t in nc.get("tag_list",[])]})
        return jsonify({"notes":notes,"total":len(notes)})
    except Exception as e:
        return jsonify({"error":str(e)}), 500
@app.route("/api/xhs/note/<nid>")
@need_key
def detail(nid):
    if not xhs_client: return jsonify({"error":"Not ready"}), 503
    try:
        r = xhs_client.get_note_by_id(nid)
        if not r: return jsonify({"error":"Not found"}), 404
        n = r.get("note_card", r)
        ii = n.get("interact_info",{})
        u = n.get("user",{})
        imgs = [img.get("url_default","") or img.get("url","") for img in n.get("image_list",[]) if img.get("url_default","") or img.get("url","")]
        return jsonify({"id":nid,"title":n.get("display_title",n.get("title","")),"content":n.get("desc",""),"type":n.get("type",""),"liked_count":ii.get("liked_count","0"),"collected_count":ii.get("collected_count","0"),"comment_count":ii.get("comment_count","0"),"share_count":ii.get("share_count","0"),"author":u.get("nickname",""),"author_id":u.get("user_id",""),"images":imgs,"tags":[t.get("name","") for t in n.get("tag_list",[])],"time":n.get("time","")})
    except Exception as e:
        return jsonify({"error":str(e)}), 500
@app.route("/api/xhs/user/<uid>/notes")
@need_key
def user_notes(uid):
    if not xhs_client: return jsonify({"error":"Not ready"}), 503
    try:
        r = xhs_client.get_user_notes(user_id=uid, cursor=request.args.get("cursor",""))
        notes = []
        for n in (r or {}).get("notes",[])[:30]:
            ii = n.get("interact_info",{})
            notes.append({"id":n.get("note_id",""),"title":n.get("display_title",""),"type":n.get("type",""),"liked_count":ii.get("liked_count","0"),"cover":n.get("cover",{}).get("url","")})
        return jsonify({"notes":notes,"cursor":r.get("cursor",""),"has_more":r.get("has_more",False)})
    except Exception as e:
        return jsonify({"error":str(e)}), 500
if __name__ == "__main__":
    threading.Thread(target=init_xhs, daemon=True).start()
    app.run(host="0.0.0.0", port=6006)
EOF2

echo "[3/4] 安装ComfyUI..."
if [ ! -d "ComfyUI" ]; then
    git clone https://github.com/comfyanonymous/ComfyUI.git
    cd ComfyUI && pip install -r requirements.txt -q 2>/dev/null
    cd custom_nodes
    git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus.git
    git clone https://github.com/ltdrdata/ComfyUI-Manager.git
    cd ../..
    echo "  ComfyUI安装完成"
else
    echo "  ComfyUI已存在"
fi

echo "[4/4] 创建启动/停止脚本..."
cat > start_all.sh << 'SEOF'
#!/bin/bash
echo "========= 启动鹿联AI服务 ========="
if [ -z "$XHS_COOKIE" ]; then
    echo "⚠️  请先: export XHS_COOKIE=\"你的cookie\""
    exit 1
fi
if [ -z "$LULIAN_API_KEY" ]; then
    export LULIAN_API_KEY="lulian-$(date +%s)-key"
    echo "🔑 API密钥: $LULIAN_API_KEY"
    echo "   请把这个密钥配置到Replit环境变量 AUTODL_API_KEY 中"
fi
D="/root/lulian-services"
echo "[1/3] 签名服务..."
cd "$D/xhs-service" && nohup python sign_server.py > /root/sign_server.log 2>&1 &
sleep 5
echo "[2/3] 小红书数据服务 (端口6006)..."
nohup python app.py > /root/xhs_service.log 2>&1 &
echo "[3/3] ComfyUI (端口6008)..."
cd "$D/ComfyUI" && nohup python main.py --listen 0.0.0.0 --port 6008 > /root/comfyui.log 2>&1 &
echo ""
echo "✅ 所有服务已启动！"
echo "  小红书数据: https://u711560-88e3-c9b28838.cqa1.seetacloud.com:8443"
echo "  ComfyUI:   https://u2711560-88e3-c9b28838.cqa1.seetacloud.com:8443"
echo ""
echo "查看日志: tail -f /root/xhs_service.log"
SEOF
chmod +x start_all.sh

cat > stop_all.sh << 'PEOF'
#!/bin/bash
pkill -f "sign_server.py" 2>/dev/null
pkill -f "xhs-service/app.py" 2>/dev/null
pkill -f "ComfyUI/main.py" 2>/dev/null
echo "所有服务已停止"
PEOF
chmod +x stop_all.sh

echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo ""
echo "接下来运行："
echo ""
echo "  export XHS_COOKIE=\"你的cookie\""
echo "  cd /root/lulian-services && bash start_all.sh"
echo ""
echo "ComfyUI需要下载模型，运行："
echo "  cd /root/lulian-services/ComfyUI/models/checkpoints"
echo "  wget https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
echo ""
