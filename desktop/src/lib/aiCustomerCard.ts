import type { Contact, Message, SalesStage } from "@/types/crm";
import type { AppSettings } from "@/store/appStore";
import type { AiSource } from "@/lib/aiSuggest";
import { geminiGenerate } from "./gemini.ts";
import { getOpenAiCompatibleConfig, hasAiCredentials } from "./aiProviders.ts";

export interface CustomerInsight {
  /** 2–5 句中文/客户语言摘要，可写回 aiSummary */
  summary: string;
  /** 一句话需求/意向 */
  intent: string;
  /** 建议下一步动作 */
  nextStep: string;
  /** 可选：建议阶段（不自动改） */
  suggestedStage?: SalesStage;
  /** 0–3 风险点 */
  risks: string[];
}

export interface GenerateInsightResult {
  insight: CustomerInsight;
  source: AiSource;
  fallback: boolean;
  error?: string;
}

const STAGES: SalesStage[] = [
  "new",
  "contacted",
  "quoting",
  "won",
  "after_sales",
];

const STAGE_HINT: Record<string, string> = {
  new: "new lead",
  contacted: "already contacted",
  quoting: "quoting / negotiation",
  won: "won",
  after_sales: "after-sales",
};

function hasKey(s: AppSettings) {
  return hasAiCredentials(s);
}

function parseStage(raw: unknown): SalesStage | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim() as SalesStage;
  return STAGES.includes(s) ? s : undefined;
}

function normalizeInsight(raw: Partial<CustomerInsight> & Record<string, unknown>): CustomerInsight {
  const risksIn = raw.risks;
  const risks = Array.isArray(risksIn)
    ? risksIn.map((x) => String(x).trim()).filter(Boolean).slice(0, 3)
    : typeof risksIn === "string" && (risksIn as string).trim()
      ? [(risksIn as string).trim()]
      : [];
  return {
    summary: String(raw.summary || raw.aiSummary || "").trim() || "暂无足够对话可总结。",
    intent: String(raw.intent || "").trim() || "意向待明确",
    nextStep: String(raw.nextStep || raw.next_step || "").trim() || "跟进确认需求与决策时间",
    suggestedStage: parseStage(raw.suggestedStage ?? raw.suggested_stage),
    risks,
  };
}

function extractJsonObject(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function mockInsight(contact: Contact | undefined, messages: Message[]): CustomerInsight {
  const sorted = [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const lastIn = [...sorted].reverse().find((m) => m.direction === "in");
  const lastOut = [...sorted].reverse().find((m) => m.direction === "out");
  const name = contact?.name || "客户";
  const cue = (lastIn?.body || "").trim().slice(0, 80);
  const zh =
    /[\u4e00-\u9fff]/.test(cue) ||
    /[\u4e00-\u9fff]/.test(name) ||
    /[\u4e00-\u9fff]/.test(contact?.notes || "");

  if (zh) {
    const intent = cue
      ? `对方最近提到：${cue}${ (lastIn?.body || "").length > 80 ? "…" : ""}`
      : contact?.stage === "quoting"
        ? "报价沟通中，需确认数量/交期"
        : "需求尚未在对话中写清";
    return {
      summary: [
        `${name} · 阶段「${STAGE_HINT[contact?.stage || "new"] || contact?.stage}」。`,
        cue ? `最近入站：${cue}${(lastIn?.body || "").length > 80 ? "…" : ""}。` : "近期无入站消息。",
        lastOut ? `我方最近已回复过。` : `我方尚未有效跟进回复。`,
        contact?.company ? `公司：${contact.company}。` : "",
      ]
        .filter(Boolean)
        .join(""),
      intent,
      nextStep: contact?.stage === "quoting"
        ? "确认报价反馈与目标数量，约定回复时间"
        : contact?.stage === "won"
          ? "确认交付/售后节点，询问复购"
          : "用一句话确认核心需求与预算/数量",
      suggestedStage:
        contact?.stage === "new" && sorted.some((m) => m.direction === "out")
          ? "contacted"
          : cue && /报价|价格|price|quote|cif/i.test(cue)
            ? "quoting"
            : undefined,
      risks: !lastIn
        ? ["对方较久未回复"]
        : !lastOut
          ? ["我方可能未及时回复"]
          : [],
    };
  }

  return {
    summary: [
      `${name} · stage ${contact?.stage || "new"}.`,
      cue ? `Latest inbound: ${cue}${(lastIn?.body || "").length > 80 ? "…" : ""}.` : "No recent inbound.",
      lastOut ? "We have replied recently." : "No solid outbound follow-up yet.",
    ].join(" "),
    intent: cue || "Need still unclear",
    nextStep:
      contact?.stage === "quoting"
        ? "Confirm quote feedback and target qty"
        : "Clarify core need, qty, and timeline",
    suggestedStage:
      cue && /price|quote|cif|moq/i.test(cue) ? "quoting" : undefined,
    risks: !lastIn ? ["Customer silent"] : !lastOut ? ["We may owe a reply"] : [],
  };
}

function buildInsightSystem(): string {
  return [
    "You are a B2B sales CRM copilot for WhatsApp Business.",
    "Return ONLY one JSON object (no markdown) with keys:",
    'summary (string, 2-5 sentences), intent (string, one line),',
    "nextStep (string, one concrete action),",
    'suggestedStage (optional: "new"|"contacted"|"quoting"|"won"|"after_sales"),',
    "risks (array of 0-3 short strings).",
    "Be factual from the chat; do not invent company facts.",
    "Match the customer's language when obvious (Chinese/English/etc).",
  ].join(" ");
}

function buildInsightUser(contact: Contact | undefined, messages: Message[]): string {
  const hist = messages
    .slice(-20)
    .map((m) => `${m.direction === "in" ? "Customer" : "Me"}: ${(m.body || "").slice(0, 280)}`)
    .join("\n");
  return [
    `Contact: ${contact?.name ?? "Unknown"}`,
    `Company: ${contact?.company ?? "-"}`,
    `Country: ${contact?.country ?? "-"}`,
    `Stage: ${contact?.stage ?? "-"} (${STAGE_HINT[contact?.stage || ""] || ""})`,
    `Tags: ${(contact?.tags ?? []).join(", ") || "-"}`,
    `Notes: ${(contact?.notes ?? "-").slice(0, 400)}`,
    `Existing AI summary: ${(contact?.aiSummary ?? "-").slice(0, 400)}`,
    "",
    "Recent chat:",
    hist || "(empty)",
  ].join("\n");
}

async function openAiCompatibleInsight(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  contact?: Contact;
  messages: Message[];
  label: string;
}): Promise<CustomerInsight> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: buildInsightSystem() },
        {
          role: "user",
          content: buildInsightUser(opts.contact, opts.messages),
        },
      ],
    }),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      detail = errBody.error?.message || detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${opts.label} ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${opts.label} 空响应`);
  const obj = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
  return normalizeInsight(obj);
}

async function geminiInsight(
  contact: Contact | undefined,
  messages: Message[],
  settings: AppSettings
): Promise<CustomerInsight> {
  const content = await geminiGenerate({
    apiKey: settings.geminiKey,
    model: settings.aiModel.trim() || undefined,
    system: buildInsightSystem(),
    user: buildInsightUser(contact, messages),
    temperature: 0.4,
    json: true,
  });
  const obj = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
  return normalizeInsight(obj);
}

async function ollamaInsight(
  settings: AppSettings,
  contact: Contact | undefined,
  messages: Message[]
): Promise<CustomerInsight> {
  const base = settings.ollamaUrl;
  const res = await fetch(`${base.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.aiModel.trim() || "llama3.2",
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: buildInsightSystem() },
        { role: "user", content: buildInsightUser(contact, messages) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = (await res.json()) as {
    message?: { content?: string };
    response?: string;
  };
  const content = data.message?.content ?? data.response;
  if (!content) throw new Error("Ollama 空响应");
  const obj = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
  return normalizeInsight(obj);
}

/**
 * 生成可写回联系人的客户卡洞察（摘要/意向/下一步）。
 * 与回复建议分离，失败回退本地启发式。
 */
export async function generateCustomerInsight(
  contact: Contact | undefined,
  recent: Message[],
  settings: AppSettings
): Promise<GenerateInsightResult> {
  const sorted = [...recent].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const provider = settings.aiProvider;

  if (provider === "mock" || !hasKey(settings)) {
    return {
      insight: mockInsight(contact, sorted),
      source: "mock",
      fallback: provider !== "mock",
      error:
        provider !== "mock"
          ? provider === "openai"
            ? "未配置 OpenAI API Key"
            : provider === "groq"
              ? "未配置 Groq API Key"
              : provider === "gemini"
                ? "未配置 Gemini API Key"
                : provider === "deepseek"
                  ? "未配置 DeepSeek API Key"
                  : provider === "qwen"
                    ? "未配置通义千问 API Key"
                    : provider === "zhipu"
                      ? "未配置智谱 API Key"
                      : provider === "openrouter"
                        ? "未配置 OpenRouter API Key"
                : "未配置 AI"
          : undefined,
    };
  }

  try {
    if (provider === "ollama") {
      const insight = await ollamaInsight(settings, contact, sorted);
      return { insight, source: "ollama", fallback: false };
    }
    if (provider === "gemini") {
      const insight = await geminiInsight(contact, sorted, settings);
      return { insight, source: "gemini", fallback: false };
    }
    const config = getOpenAiCompatibleConfig(settings);
    if (config) {
      if (!config.model) throw new Error("自定义提供商缺少模型名");
      const insight = await openAiCompatibleInsight({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        contact,
        messages: sorted,
        label: config.label,
      });
      return { insight, source: provider as AiSource, fallback: false };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      insight: mockInsight(contact, sorted),
      source: "mock",
      fallback: true,
      error: msg,
    };
  }

  return {
    insight: mockInsight(contact, sorted),
    source: "mock",
    fallback: false,
  };
}

/** 把洞察落到 Contact 可持久化字段 */
export function insightToContactPatch(insight: CustomerInsight): Partial<Contact> {
  return {
    aiSummary: insight.summary.slice(0, 2000),
    aiIntent: insight.intent.slice(0, 400),
    aiNextStep: insight.nextStep.slice(0, 400),
    aiSuggestedStage: insight.suggestedStage,
    aiInsightAt: new Date().toISOString(),
  };
}
