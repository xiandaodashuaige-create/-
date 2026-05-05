import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FolderOpen, Image as ImageIcon, Video, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type AssetType = "image" | "video";

type AssetPickerProps = {
  type?: AssetType;            // 只显示某类型；默认 image
  multiple?: boolean;          // 多选；默认 true
  triggerLabel?: string;       // 触发按钮文案
  triggerSize?: "sm" | "default";
  onPick: (urls: string[]) => void;
};

function getAssetUrl(asset: any): string {
  return asset.objectPath ? `/api/storage${asset.objectPath}` : "";
}

export function AssetPicker({
  type = "image",
  multiple = true,
  triggerLabel,
  triggerSize = "sm",
  onPick,
}: AssetPickerProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets", type],
    queryFn: () => api.assets.list({ type }),
    enabled: open,
  });

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!multiple) next.clear();
        next.add(id);
      }
      return next;
    });
  }

  function handleConfirm() {
    const picked = (assets as any[])
      .filter((a) => selected.has(a.id))
      .map((a) => getAssetUrl(a))
      .filter(Boolean);
    if (picked.length > 0) onPick(picked);
    setSelected(new Set());
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelected(new Set()); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size={triggerSize} className={triggerSize === "sm" ? "h-7 text-xs" : ""} type="button">
          <FolderOpen className={triggerSize === "sm" ? "h-3 w-3 mr-1" : "h-4 w-4 mr-2"} />
          {triggerLabel ?? (type === "video" ? "从素材库选视频" : "从素材库选图")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{type === "video" ? "选择视频素材" : "选择图片素材"}</DialogTitle>
          <DialogDescription>
            {multiple ? "可多选；" : ""}从你已上传的素材库挑选。素材库可在左侧菜单「素材」中维护。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-96 -mx-2 px-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> 加载中…
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-12">
              {type === "video" ? <Video className="h-10 w-10 mb-3 opacity-50" /> : <ImageIcon className="h-10 w-10 mb-3 opacity-50" />}
              <p className="text-sm">素材库还没有{type === "video" ? "视频" : "图片"}</p>
              <p className="text-xs mt-1">去左侧「素材」页上传后再回来选择</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {(assets as any[]).map((asset) => {
                const url = getAssetUrl(asset);
                const isSel = selected.has(asset.id);
                return (
                  <button
                    type="button"
                    key={asset.id}
                    onClick={() => toggle(asset.id)}
                    className={`group relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                      isSel ? "border-[hsl(var(--platform-primary))] ring-2 ring-[hsl(var(--platform-ring))/40%]" : "border-transparent hover:border-muted-foreground/30"
                    }`}
                  >
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      {asset.type === "image" && url ? (
                        <img src={url} alt={asset.filename} className="w-full h-full object-cover" />
                      ) : asset.type === "video" && url ? (
                        <video src={url} className="w-full h-full object-cover" muted playsInline />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    {isSel && (
                      <div
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center shadow"
                        style={{ background: "hsl(var(--platform-primary))", color: "hsl(var(--platform-primary-fg))" }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 text-left">
                      <p className="text-[10px] text-white truncate">{asset.filename}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {selected.size > 0 ? (
              <Badge variant="secondary">已选 {selected.size}</Badge>
            ) : (
              <span>未选择</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleConfirm} disabled={selected.size === 0}>
              <Check className="h-4 w-4 mr-2" /> 添加到内容
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
