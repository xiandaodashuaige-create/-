import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Image, Video, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { ObjectUploader } from "@workspace/object-storage-web";

export default function Assets() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets", typeFilter],
    queryFn: () => api.assets.list({ type: typeFilter }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.assets.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast({ title: "素材已删除" });
    },
  });

  const createAssetMutation = useMutation({
    mutationFn: (data: any) => api.assets.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast({ title: "素材上传成功" });
    },
    onError: (e: Error) => {
      toast({ title: "保存失败", description: e.message, variant: "destructive" });
    },
  });

  async function handleGetUploadParameters(file: any) {
    const res = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        contentType: file.type,
      }),
    });
    if (!res.ok) throw new Error("Failed to get upload URL");
    const data = await res.json();
    (file as any)._objectPath = data.objectPath;
    (file as any)._size = file.size;
    return {
      method: "PUT" as const,
      url: data.uploadURL,
      headers: { "Content-Type": file.type },
    };
  }

  function handleUploadComplete(result: any) {
    const files = result.successful || [];
    for (const file of files) {
      const objectPath = (file as any)._objectPath;
      const size = (file as any)._size || file.size || 0;
      const isVideo = file.type?.startsWith("video/");
      if (objectPath) {
        createAssetMutation.mutate({
          filename: file.name,
          objectPath,
          size,
          type: isVideo ? "video" : "image",
          tags: [],
        });
      }
    }
  }

  function getAssetUrl(asset: any): string {
    if (asset.objectPath) {
      return `/api/storage${asset.objectPath}`;
    }
    return "";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">素材库</h1>
          <p className="text-muted-foreground">管理图片和视频素材</p>
        </div>
        <ObjectUploader
          maxNumberOfFiles={10}
          maxFileSize={52428800}
          onGetUploadParameters={handleGetUploadParameters}
          onComplete={handleUploadComplete}
          buttonClassName="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-red-500 text-white hover:bg-red-600 h-10 px-4 py-2"
        >
          <Upload className="h-4 w-4 mr-2" />
          上传素材
        </ObjectUploader>
      </div>

      <div className="flex gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="image">图片</SelectItem>
            <SelectItem value="video">视频</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="pt-6 h-40" />
            </Card>
          ))}
        </div>
      ) : assets.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground py-12">
            <Image className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>暂无素材</p>
            <p className="text-xs mt-1">点击"上传素材"按钮添加图片和视频</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {assets.map((asset: any) => {
            const url = getAssetUrl(asset);
            return (
              <Card key={asset.id} className="overflow-hidden hover:shadow-md transition-shadow">
                <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                  {url && asset.type === "image" ? (
                    <img
                      src={url}
                      alt={asset.filename}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : asset.type === "video" ? (
                    <Video className="h-8 w-8 text-muted-foreground" />
                  ) : (
                    <Image className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <CardContent className="p-3">
                  <p className="text-sm font-medium truncate">{asset.filename}</p>
                  <div className="flex items-center justify-between mt-2">
                    <Badge variant="outline" className="text-xs">
                      {asset.type === "image" ? "图片" : "视频"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => {
                        if (confirm("确定删除？")) deleteMutation.mutate(asset.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {asset.tags?.map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
