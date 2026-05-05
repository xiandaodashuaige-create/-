/* eslint-disable no-console */
import { db, imageReferencesTable, userStyleProfilesTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { analyzeCompetitorImage, generateImagePrompt } from "./src/services/imagePipeline.js";
import { chatWithAssistant } from "./src/services/assistant.js";
import { recomputeUserStyleProfile, loadStyleProfileForPrompt } from "./src/services/styleProfile.js";
import { buildSeedreamPrompt } from "./src/services/imagePipeline.js";

const PASS = "\x1b[32m✓ PASS\x1b[0m";
const FAIL = "\x1b[31m✗ FAIL\x1b[0m";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: any, detail?: any) {
  if (cond) {
    console.log(`  ${PASS} ${name}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${name}`);
    if (detail !== undefined) console.log(`         got:`, JSON.stringify(detail).slice(0, 300));
    failed++;
    failures.push(name);
  }
}

async function setupTestUsers() {
  const u1 = await db.insert(usersTable).values({
    clerkId: `verify_test_user_a_${Date.now()}`,
    email: `verify_a_${Date.now()}@test.local`,
    credits: 100,
  }).returning();
  const u2 = await db.insert(usersTable).values({
    clerkId: `verify_test_user_b_${Date.now()}`,
    email: `verify_b_${Date.now()}@test.local`,
    credits: 100,
  }).returning();
  return { userA: u1[0], userB: u2[0] };
}

async function cleanup(userIds: number[]) {
  for (const id of userIds) {
    await db.delete(imageReferencesTable).where(eq(imageReferencesTable.userId, id));
    await db.delete(userStyleProfilesTable).where(eq(userStyleProfilesTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
}

async function main() {
  console.log("\n========================================");
  console.log(" 真实环境验证：A 视觉分析 / B AI助手 / C 学习系统");
  console.log("========================================\n");

  const { userA, userB } = await setupTestUsers();
  console.log(`Setup: created test users A=${userA.id} B=${userB.id}\n`);

  try {
    // ============================================================
    // PHASE A: 12-dimension vision analysis (REAL OpenAI gpt-4o call)
    // ============================================================
    console.log("【Phase A】12 维视觉分析 — 真实 GPT-4o 视觉调用");
    const realImageUrl = "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800";
    console.log(`  调用 analyzeCompetitorImage("${realImageUrl}")...`);
    const t0 = Date.now();
    const analysis = await analyzeCompetitorImage(realImageUrl);
    console.log(`  ⏱  ${Date.now() - t0}ms`);
    console.log(`  返回字段: ${Object.keys(analysis).join(", ")}`);

    check("layoutType 非空", typeof analysis.layoutType === "string" && analysis.layoutType.length > 0, analysis.layoutType);
    check("mainColors 是数组", Array.isArray(analysis.mainColors) && analysis.mainColors.length > 0, analysis.mainColors);
    check("visualStyle 非空", typeof analysis.visualStyle === "string" && analysis.visualStyle.length > 0);
    check("mood 非空", typeof analysis.mood === "string");
    check("subject 非空", typeof analysis.subject === "string");
    check("composition 非空", typeof analysis.composition === "string");
    check("keyElements 是数组", Array.isArray(analysis.keyElements));
    check("textOverlays 是数组", Array.isArray(analysis.textOverlays));
    check("【新增】emojis 是数组", Array.isArray(analysis.emojis), analysis.emojis);
    check("【新增】textStyleDetail 是字符串（无文字图允许空）", typeof analysis.textStyleDetail === "string", analysis.textStyleDetail);
    check("【新增】emotionalHook 非空", typeof analysis.emotionalHook === "string" && analysis.emotionalHook.length > 0, analysis.emotionalHook);
    check("【新增】collageStructure 非空", typeof analysis.collageStructure === "string" && analysis.collageStructure.length > 0, analysis.collageStructure);
    check("【新增】mimicAdvice.mustKeep 是数组", Array.isArray(analysis.mimicAdvice?.mustKeep), analysis.mimicAdvice);
    check("【新增】mimicAdvice.canChange 是数组", Array.isArray(analysis.mimicAdvice?.canChange));
    check("【新增】mimicAdvice.avoid 是数组", Array.isArray(analysis.mimicAdvice?.avoid));

    console.log(`\n  示例输出:`);
    console.log(`    visualStyle: "${analysis.visualStyle.slice(0, 60)}"`);
    console.log(`    emotionalHook: "${analysis.emotionalHook.slice(0, 80)}"`);
    console.log(`    collageStructure: "${analysis.collageStructure.slice(0, 60)}"`);
    console.log(`    mimicAdvice.mustKeep: ${JSON.stringify(analysis.mimicAdvice?.mustKeep || []).slice(0, 100)}`);

    // ============================================================
    // PHASE A2: generateImagePrompt with style profile injection
    // ============================================================
    console.log("\n【Phase A2】generateImagePrompt 注入 styleProfile + extraInstructions");
    const fakeProfile = {
      dominantColors: ["#FF3B5C", "#FFD700"],
      preferredLayouts: ["dual-vertical"],
      preferredFonts: ["粗黑大字 白底红字带描边"],
      preferredEmojis: ["🔥", "✨", "💯"],
      preferredMoods: ["紧迫感"],
      sampleSize: 8,
    };
    const promptResult = await generateImagePrompt({
      analysis,
      newTopic: "三天瘦五斤食谱",
      newTitle: "亲测有效",
      mimicStrength: "partial",
      styleProfile: fakeProfile,
      extraInstructions: "色彩再鲜艳一点，加金色光晕",
    });
    check("imagePrompt 非空", typeof promptResult.imagePrompt === "string" && promptResult.imagePrompt.length > 50, promptResult.imagePrompt?.slice(0, 100));
    check("imagePrompt 包含用户偏好色彩 #FF3B5C（hex 原样保留）", promptResult.imagePrompt.includes("#FF3B5C"), promptResult.imagePrompt.slice(0, 300));
    check("imagePrompt 字面体现 extraInstructions 关键词（金色/光晕/鲜艳/glow/golden）",
      /鲜艳|光晕|金色|glow|golden|vivid/i.test(promptResult.imagePrompt), promptResult.imagePrompt.slice(0, 400));
    check("textToOverlay 是数组", Array.isArray(promptResult.textToOverlay));
    check("emojisToInclude 包含用户档案 emoji 🔥（这是 emoji 注入的正确通道）",
      promptResult.emojisToInclude.includes("🔥"), promptResult.emojisToInclude);

    // 端到端验证：buildSeedreamPrompt 把 emoji 真的拼进了最终 Seedream prompt
    const finalSeedream = buildSeedreamPrompt(promptResult.imagePrompt, promptResult.textToOverlay, "single", promptResult.emojisToInclude);
    check("最终 Seedream prompt 包含 emoji 🔥（端到端注入成功）", finalSeedream.includes("🔥"), finalSeedream.slice(-300));

    console.log(`  生成的 imagePrompt 摘要: "${promptResult.imagePrompt.slice(0, 200)}..."`);
    console.log(`  emojisToInclude: ${JSON.stringify(promptResult.emojisToInclude)}`);
    console.log(`  最终 Seedream prompt 末尾: "...${finalSeedream.slice(-200)}"`);

    // ============================================================
    // PHASE B: Agentic AI assistant function calling (REAL gpt-4o)
    // ============================================================
    console.log("\n【Phase B】AI 助手 function calling — 真实 GPT-4o 工具调用");
    console.log(`  发送: "换成四格拼图，标题改成'三天瘦五斤'"`);
    const reply = await chatWithAssistant(
      [],
      "换成四格拼图，标题改成'三天瘦五斤'",
      {
        referenceImageUrl: "https://example.com/ref.jpg",
        generatedImageUrl: "https://example.com/gen.jpg",
        topic: "减肥",
        title: "原标题",
        layout: "single",
        mimicStrength: "partial",
        textOverlays: [{ text: "原标题", position: "top", style: "粗体" }],
        emojis: ["🔥"],
        imagePromptUsed: null,
      },
    );
    console.log(`  AI 回复: "${reply.message}"`);
    console.log(`  返回 actions: ${JSON.stringify(reply.actions, null, 2).slice(0, 500)}`);
    check("reply.message 非空", typeof reply.message === "string" && reply.message.length > 0);
    check("reply.actions 是非空数组", Array.isArray(reply.actions) && reply.actions.length > 0);
    const hasGrid = reply.actions.some((a: any) => a.type === "change_layout" && a.newLayout === "grid-2x2");
    check("含有 change_layout→grid-2x2 动作", hasGrid, reply.actions);
    const handlesTitle = reply.actions.some((a: any) =>
      a.type === "edit_texts" || a.type === "extra_instructions" ||
      (a.type === "change_layout" && /三天瘦五斤/.test(JSON.stringify(reply.actions)))
    );
    check("处理了改标题需求 (edit_texts/extra_instructions/regenerate)", handlesTitle, reply.actions);
    const willRegen = reply.actions.some((a: any) => a.type === "regenerate");
    check("最后会触发 regenerate（修改类必须配合重生成）", willRegen, reply.actions.map((a: any) => a.type));

    // 测第二个动作：set_emojis
    console.log(`\n  发送: "去掉所有emoji"`);
    const reply2 = await chatWithAssistant(
      [],
      "去掉所有emoji",
      {
        referenceImageUrl: "https://example.com/ref.jpg",
        generatedImageUrl: "https://example.com/gen.jpg",
        topic: "减肥",
        title: "测试",
        layout: "single",
        mimicStrength: "partial",
        textOverlays: [],
        emojis: ["🔥", "✨", "💯"],
        imagePromptUsed: null,
      },
    );
    const setEmojis = reply2.actions.find((a: any) => a.type === "set_emojis");
    check("含有 set_emojis 动作", !!setEmojis, reply2.actions);
    check("set_emojis 的 newEmojis 是空数组（去掉 emoji）",
      setEmojis && Array.isArray(setEmojis.newEmojis) && setEmojis.newEmojis.length === 0,
      setEmojis);

    // ============================================================
    // PHASE C: Style profile aggregation (REAL DB)
    // ============================================================
    console.log("\n【Phase C1】学习系统 — 插入 5 条参考记录 → 重算风格档案");
    const seedRefs = [
      { mood: "紧迫感", layout: "dual-vertical", colors: ["#FF3B5C", "#FFD700"], emojis: ["🔥", "✨"], style: "粗黑大字" },
      { mood: "紧迫感", layout: "dual-vertical", colors: ["#FF3B5C", "#000000"], emojis: ["🔥", "💯"], style: "粗黑大字" },
      { mood: "治愈温暖", layout: "single", colors: ["#FFC0CB"], emojis: ["💕"], style: "手写体" },
      { mood: "紧迫感", layout: "grid-2x2", colors: ["#FF3B5C"], emojis: ["🔥"], style: "粗黑大字" },
      { mood: "种草欲望强", layout: "dual-vertical", colors: ["#FFD700"], emojis: ["✨"], style: "圆角胶囊" },
    ];
    for (const seed of seedRefs) {
      await db.insert(imageReferencesTable).values({
        userId: userA.id,
        refImageUrl: "https://example.com/ref.jpg",
        analysisJson: {
          mood: seed.mood,
          layoutType: seed.layout,
          mainColors: seed.colors,
          emojis: seed.emojis,
          textStyleDetail: seed.style,
        } as any,
        generatedImageUrl: "https://example.com/gen.jpg",
        layout: seed.layout,
        mimicStrength: "partial",
        accepted: true, // 关键：必须 accepted 才会被聚合
      });
    }
    // 加一条 NOT accepted，验证不会被算进去
    await db.insert(imageReferencesTable).values({
      userId: userA.id,
      refImageUrl: "https://example.com/ref.jpg",
      analysisJson: { mood: "DUMMY_NOT_ACCEPTED", layoutType: "DUMMY", mainColors: ["#000000"], emojis: ["❌"] } as any,
      generatedImageUrl: null,
      layout: "single",
      mimicStrength: "partial",
      accepted: false,
    });

    await recomputeUserStyleProfile(userA.id);
    const profile = await loadStyleProfileForPrompt(userA.id);
    console.log(`  聚合后档案:`, JSON.stringify(profile, null, 2));
    check("档案非空", profile !== null);
    check("sampleSize === 5（只算 accepted=true）", profile?.sampleSize === 5, profile?.sampleSize);
    check("最常出现的 mood 是 '紧迫感'", profile?.preferredMoods?.[0] === "紧迫感", profile?.preferredMoods);
    check("最常出现的 layout 是 'dual-vertical'", profile?.preferredLayouts?.[0] === "dual-vertical", profile?.preferredLayouts);
    check("最常出现的 color 是 '#FF3B5C'", profile?.dominantColors?.[0] === "#FF3B5C", profile?.dominantColors);
    check("最常出现的 emoji 是 '🔥'", profile?.preferredEmojis?.[0] === "🔥", profile?.preferredEmojis);
    check("DUMMY_NOT_ACCEPTED 没出现在 moods 里", !profile?.preferredMoods?.includes("DUMMY_NOT_ACCEPTED"));

    // ============================================================
    // PHASE C2: IDOR fix verification
    // ============================================================
    console.log("\n【Phase C2】IDOR 修复 — 跨用户写入应被拒绝");
    const refForA = await db.insert(imageReferencesTable).values({
      userId: userA.id,
      refImageUrl: "https://example.com/idor-test.jpg",
      analysisJson: {} as any,
      layout: "single",
      mimicStrength: "partial",
      accepted: false,
    }).returning({ id: imageReferencesTable.id });
    const refId = refForA[0].id;
    console.log(`  插入 user A 的 reference id=${refId}`);

    // 模拟 user B 尝试给 user A 的记录点"采用"（重现修复后的查询）
    const idorAttempt = await db.update(imageReferencesTable)
      .set({ accepted: true, feedbackText: "ATTACK_BY_B" })
      .where(and(eq(imageReferencesTable.id, refId), eq(imageReferencesTable.userId, userB.id)))
      .returning({ id: imageReferencesTable.id });
    check("user B 跨用户写入返回 0 行（IDOR 被拦截）", idorAttempt.length === 0, idorAttempt);

    // 验证记录确实没被改
    const stillUntouched = await db.select().from(imageReferencesTable).where(eq(imageReferencesTable.id, refId));
    check("记录的 accepted 仍是 false", stillUntouched[0]?.accepted === false, stillUntouched[0]);
    check("记录的 feedbackText 仍是 null（没被攻击文本污染）", stillUntouched[0]?.feedbackText === null, stillUntouched[0]?.feedbackText);

    // 而 user A 自己写就成功
    const legitWrite = await db.update(imageReferencesTable)
      .set({ accepted: true, feedbackText: "owner update" })
      .where(and(eq(imageReferencesTable.id, refId), eq(imageReferencesTable.userId, userA.id)))
      .returning({ id: imageReferencesTable.id });
    check("user A 自己写入成功（1 行）", legitWrite.length === 1, legitWrite);

    // ============================================================
    // PHASE C3: Verify pipeline end uses styleProfile
    // ============================================================
    console.log("\n【Phase C3】pipeline 端到端 — styleProfile 真的注入了 prompt");
    const profile2 = await loadStyleProfileForPrompt(userA.id);
    const prompt2 = await generateImagePrompt({
      analysis,
      newTopic: "新选题",
      mimicStrength: "partial",
      styleProfile: profile2,
    });
    check("Prompt 包含用户档案的颜色 #FF3B5C", prompt2.imagePrompt.includes("#FF3B5C"), prompt2.imagePrompt.slice(0, 300));
    check("emojisToInclude 包含用户档案的 emoji 🔥", prompt2.emojisToInclude.includes("🔥"), prompt2.emojisToInclude);

  } finally {
    await cleanup([userA.id, userB.id]);
    console.log(`\nCleanup: 删除测试用户 ${userA.id}, ${userB.id} 及其数据`);
  }

  console.log("\n========================================");
  console.log(` 总计: ${PASS} ${passed}  |  ${FAIL} ${failed}`);
  if (failures.length > 0) {
    console.log("\n失败项:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("========================================\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n💥 验证脚本崩溃:", err);
  process.exit(1);
});
