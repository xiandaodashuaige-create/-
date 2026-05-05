import { logger } from "../lib/logger.js";

const ARK_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DEFAULT_MODEL = process.env.SEEDREAM_MODEL || "doubao-seedream-5-0-260128";

export interface SeedreamGenerateInput {
  prompt: string;
  size?: string;
  referenceImageUrls?: string[];
  watermark?: boolean;
  seed?: number;
}

export interface SeedreamResult {
  imageBuffer: Buffer;
  imageUrl: string;
  durationMs: number;
  model: string;
}

export class SeedreamClient {
  constructor(private readonly apiKey: string, private readonly model: string = DEFAULT_MODEL) {}

  static fromEnv(): SeedreamClient | null {
    const key = process.env.ARK_API_KEY;
    if (!key) return null;
    return new SeedreamClient(key);
  }

  private normalizeSize(size: string | undefined): string {
    if (!size) return "2K";
    if (["1K", "2K", "4K"].includes(size)) return size;
    // Map our standard logical sizes to Ark-friendly dimensions
    if (size === "1024x1024") return "2K";
    if (size === "1024x1536") return "1536x2048";
    if (size === "1536x1024") return "2048x1536";
    // Pass through any other explicit WxH (Ark accepts arbitrary supported dims)
    const m = /^(\d+)x(\d+)$/.exec(size);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (w >= 512 && w <= 4096 && h >= 512 && h <= 4096) return size;
    }
    return "2K";
  }

  async generate(input: SeedreamGenerateInput, log?: any): Promise<SeedreamResult> {
    const start = Date.now();
    const body: Record<string, any> = {
      model: this.model,
      prompt: input.prompt,
      size: this.normalizeSize(input.size),
      response_format: "url",
      watermark: input.watermark ?? false,
      sequential_image_generation: "disabled",
      stream: false,
    };
    if (input.referenceImageUrls && input.referenceImageUrls.length > 0) {
      body.image = input.referenceImageUrls.length === 1 ? input.referenceImageUrls[0] : input.referenceImageUrls;
    }
    if (input.seed != null) body.seed = input.seed;

    (log || logger).info(
      { model: this.model, size: body.size, hasRef: !!body.image, promptLen: input.prompt.length },
      "Seedream: requesting image generation",
    );

    const res = await fetch(ARK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      (log || logger).error({ status: res.status, errText: errText.slice(0, 500) }, "Seedream API error");
      throw new Error(`Seedream API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const imgUrl: string | undefined = data?.data?.[0]?.url;
    if (!imgUrl) {
      throw new Error("Seedream returned no image URL");
    }

    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error(`Failed to download Seedream image: ${imgRes.status}`);
    const arrayBuf = await imgRes.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuf);

    return {
      imageBuffer,
      imageUrl: imgUrl,
      durationMs: Date.now() - start,
      model: this.model,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(ARK_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          prompt: "test",
          size: "1K",
          response_format: "url",
          watermark: false,
        }),
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }
}
