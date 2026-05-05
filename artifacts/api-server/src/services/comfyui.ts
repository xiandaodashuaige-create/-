import { logger } from "../lib/logger.js";

export interface ComfyUIConfig {
  baseUrl: string;
  timeout?: number;
}

export interface FluxRefluxParams {
  referenceImageBase64: string;
  prompt: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  reduxStrength?: number;
  controlnetStrength?: number;
  seed?: number;
}

export interface AnyTextOverlayParams {
  baseImageBase64: string;
  textItems: Array<{
    text: string;
    position: "top" | "center" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
    fontSize?: number;
    color?: string;
    backgroundColor?: string;
  }>;
}

export interface ComfyUIResult {
  imageBase64: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT = 180_000;

export class ComfyUIClient {
  private baseUrl: string;
  private timeout: number;
  private clientId: string;

  constructor(config: ComfyUIConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.clientId = `xhs-tool-${Math.random().toString(36).slice(2, 10)}`;
  }

  static isConfigured(): boolean {
    return !!process.env.COMFYUI_URL;
  }

  static fromEnv(): ComfyUIClient | null {
    const url = process.env.COMFYUI_URL;
    if (!url) return null;
    return new ComfyUIClient({ baseUrl: url });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async uploadImage(base64: string, filename: string): Promise<string> {
    const buffer = Buffer.from(base64, "base64");
    const blob = new Blob([buffer], { type: "image/png" });
    const form = new FormData();
    form.append("image", blob, filename);
    form.append("overwrite", "true");

    const res = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`ComfyUI upload failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { name: string };
    return data.name;
  }

  private async queuePrompt(workflow: any): Promise<string> {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`ComfyUI queue failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { prompt_id: string };
    return data.prompt_id;
  }

  private async waitForResult(promptId: string): Promise<{ filename: string; subfolder: string; type: string }> {
    const startTime = Date.now();
    const pollIntervalMs = 1500;

    while (Date.now() - startTime < this.timeout) {
      const res = await fetch(`${this.baseUrl}/history/${promptId}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const history = (await res.json()) as Record<string, any>;
        const entry = history[promptId];
        if (entry?.status?.completed) {
          const outputs = entry.outputs || {};
          for (const nodeId of Object.keys(outputs)) {
            const images = outputs[nodeId]?.images;
            if (Array.isArray(images) && images.length > 0) {
              return images[0];
            }
          }
          throw new Error("ComfyUI workflow completed but no image output found");
        }
        if (entry?.status?.status_str === "error") {
          throw new Error(`ComfyUI workflow error: ${JSON.stringify(entry.status.messages || [])}`);
        }
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(`ComfyUI timeout after ${this.timeout}ms`);
  }

  private async downloadImage(filename: string, subfolder: string, type: string): Promise<string> {
    const url = new URL(`${this.baseUrl}/view`);
    url.searchParams.set("filename", filename);
    url.searchParams.set("subfolder", subfolder);
    url.searchParams.set("type", type);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`ComfyUI download failed: ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString("base64");
  }

  async generateWithReference(params: FluxRefluxParams): Promise<ComfyUIResult> {
    const startTime = Date.now();
    const refFilename = `ref_${Date.now()}.png`;
    const uploadedName = await this.uploadImage(params.referenceImageBase64, refFilename);

    const workflow = buildFluxReduxControlNetWorkflow({
      referenceFilename: uploadedName,
      prompt: params.prompt,
      width: params.width ?? 768,
      height: params.height ?? 1152,
      steps: params.steps ?? 25,
      cfg: params.cfg ?? 3.5,
      reduxStrength: params.reduxStrength ?? 0.7,
      controlnetStrength: params.controlnetStrength ?? 0.5,
      seed: params.seed ?? Math.floor(Math.random() * 1_000_000_000),
    });

    const promptId = await this.queuePrompt(workflow);
    logger.info({ promptId, baseUrl: this.baseUrl }, "ComfyUI prompt queued");

    const imageInfo = await this.waitForResult(promptId);
    const imageBase64 = await this.downloadImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type);

    return {
      imageBase64,
      durationMs: Date.now() - startTime,
    };
  }

  async overlayChineseText(params: AnyTextOverlayParams): Promise<ComfyUIResult> {
    const startTime = Date.now();
    const baseFilename = `base_${Date.now()}.png`;
    const uploadedName = await this.uploadImage(params.baseImageBase64, baseFilename);

    const workflow = buildAnyTextOverlayWorkflow({
      baseFilename: uploadedName,
      textItems: params.textItems,
    });

    const promptId = await this.queuePrompt(workflow);
    const imageInfo = await this.waitForResult(promptId);
    const imageBase64 = await this.downloadImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type);

    return {
      imageBase64,
      durationMs: Date.now() - startTime,
    };
  }
}

function buildFluxReduxControlNetWorkflow(opts: {
  referenceFilename: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  reduxStrength: number;
  controlnetStrength: number;
  seed: number;
}): any {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "flux1-dev-fp8.safetensors" },
    },
    "2": {
      class_type: "LoadImage",
      inputs: { image: opts.referenceFilename },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: opts.prompt, clip: ["1", 1] },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: "", clip: ["1", 1] },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: opts.width, height: opts.height, batch_size: 1 },
    },
    "6": {
      class_type: "StyleModelLoader",
      inputs: { style_model_name: "flux1-redux-dev.safetensors" },
    },
    "7": {
      class_type: "CLIPVisionLoader",
      inputs: { clip_name: "sigclip_vision_patch14_384.safetensors" },
    },
    "8": {
      class_type: "CLIPVisionEncode",
      inputs: { clip_vision: ["7", 0], image: ["2", 0] },
    },
    "9": {
      class_type: "StyleModelApply",
      inputs: {
        conditioning: ["3", 0],
        style_model: ["6", 0],
        clip_vision_output: ["8", 0],
        strength: opts.reduxStrength,
        strength_type: "multiply",
      },
    },
    "10": {
      class_type: "ControlNetLoader",
      inputs: { control_net_name: "FLUX.1-dev-Controlnet-Union-Pro.safetensors" },
    },
    "11": {
      class_type: "CannyEdgePreprocessor",
      inputs: { image: ["2", 0], low_threshold: 100, high_threshold: 200, resolution: 1024 },
    },
    "12": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["9", 0],
        negative: ["4", 0],
        control_net: ["10", 0],
        image: ["11", 0],
        strength: opts.controlnetStrength,
        start_percent: 0.0,
        end_percent: 0.6,
        vae: ["1", 2],
      },
    },
    "13": {
      class_type: "KSampler",
      inputs: {
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
        model: ["1", 0],
        positive: ["12", 0],
        negative: ["12", 1],
        latent_image: ["5", 0],
      },
    },
    "14": {
      class_type: "VAEDecode",
      inputs: { samples: ["13", 0], vae: ["1", 2] },
    },
    "15": {
      class_type: "SaveImage",
      inputs: { images: ["14", 0], filename_prefix: "xhs_flux" },
    },
  };
}

function buildAnyTextOverlayWorkflow(opts: {
  baseFilename: string;
  textItems: AnyTextOverlayParams["textItems"];
}): any {
  const positionMap: Record<string, [number, number]> = {
    top: [0.5, 0.1],
    center: [0.5, 0.5],
    bottom: [0.5, 0.9],
    "top-left": [0.15, 0.1],
    "top-right": [0.85, 0.1],
    "bottom-left": [0.15, 0.9],
    "bottom-right": [0.85, 0.9],
  };

  const textPrompt = opts.textItems
    .map((item, i) => {
      const [x, y] = positionMap[item.position] || [0.5, 0.5];
      return `text ${i + 1} at position (${x.toFixed(2)}, ${y.toFixed(2)}): "${item.text}" in ${item.color || "black"} ${item.fontSize ? `size ${item.fontSize}px` : "large"}`;
    })
    .join("; ");

  return {
    "1": { class_type: "LoadImage", inputs: { image: opts.baseFilename } },
    "2": {
      class_type: "AnyTextNode",
      inputs: {
        image: ["1", 0],
        prompt: textPrompt,
        mode: "text-editing",
        font: "SourceHanSansSC-Bold.otf",
      },
    },
    "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "xhs_text" } },
  };
}
