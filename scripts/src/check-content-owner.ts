/**
 * 静态守卫：检查 routes/*.ts 里所有 contentTable.insert(...).values({...}) 调用都写了 ownerUserId 字段。
 *
 * 背景：content 表的 owner_user_id 字段 nullable，漏写不会报错；但 /api/content 列表
 * 严格按 c.owner_user_id 过滤 → 漏写直接导致内容在管理页消失（孤儿）。曾在 schedules.ts
 * bulk-create / duplicate-weeks 两处发生过。本脚本作为 CI 防回归。
 *
 * 用法：pnpm --filter @workspace/scripts run check-content-owner
 * 退出码：0 = 全部 OK；1 = 至少一处缺失。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const SCAN_DIRS = [
  "artifacts/api-server/src/routes",
  "artifacts/api-server/src/services",
];

type Hit = { file: string; lineNo: number; snippet: string; reason: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/**
 * 找形如 `db.insert(contentTable)` 起始处，向后看 ~30 行直到第一个 `;`/`)` 收口的 .values 语句块。
 * 若该块文本中不包含 `ownerUserId`，记一笔。
 */
function check(file: string): Hit[] {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const hits: Hit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/db\s*\.\s*insert\s*\(\s*contentTable\s*\)/.test(line)) continue;

    // 抓后续 30 行作为窗口（足够覆盖一个 .values({...}) 块）
    const window = lines.slice(i, Math.min(i + 30, lines.length)).join("\n");
    // 必须见到 .values 才算插入语句（否则可能是赋值给变量后续调用）
    if (!/\.values\s*\(\s*\{/.test(window)) continue;
    if (!/ownerUserId\s*:/.test(window)) {
      hits.push({
        file: relative(ROOT, file),
        lineNo: i + 1,
        snippet: lines.slice(i, Math.min(i + 5, lines.length)).join("\n  "),
        reason: "db.insert(contentTable).values({...}) 块内未发现 `ownerUserId:` 字段",
      });
    }
  }
  return hits;
}

let allHits: Hit[] = [];
for (const rel of SCAN_DIRS) {
  const dir = join(ROOT, rel);
  try {
    statSync(dir);
  } catch {
    continue;
  }
  for (const f of walk(dir)) {
    allHits = allHits.concat(check(f));
  }
}

if (allHits.length === 0) {
  console.log("[check-content-owner] OK — 所有 contentTable.insert 都包含 ownerUserId");
  process.exit(0);
}

console.error(`[check-content-owner] 发现 ${allHits.length} 处可疑插入语句缺失 ownerUserId：\n`);
for (const h of allHits) {
  console.error(`  ${h.file}:${h.lineNo}`);
  console.error(`    ${h.snippet.split("\n").join("\n    ")}`);
  console.error(`    → ${h.reason}\n`);
}
console.error("修复：在 .values({ ... }) 里加 `ownerUserId: u.id`（或当前用户 id 变量）。");
console.error("规则细节见 replit.md → Gotchas → Bulk Schedule Creation。");
process.exit(1);
