import type { Contact, SalesStage } from "@/types/crm";

/**
 * 联系人批量导入解析层（纯函数，无 store 依赖，可单测）。
 *
 * 输入是任意文本（粘贴框）或 CSV 文件内容；自动识别分隔符：
 * - 制表符 \t：Excel / Google Sheets / WPS 直接复制单元格粘贴
 * - 逗号   , ：标准 CSV
 * - 分号   ; ：部分区域设置导出的 CSV
 *
 * 表头自动别名映射（中/英），无表头时按位置猜列；
 * 电话统一归一化（复用 normalizeIngestPhone 语义），已存在/批内重复则跳过。
 */

/** 导入时每行可接受的字段 */
export type ImportContactInput = {
  name?: string;
  phone?: string;
  company?: string;
  country?: string;
  source?: string;
  owner?: string;
  stage?: string;
  tags?: string[];
  notes?: string;
  nextFollowUpAt?: string;
  accountId?: string;
};

export type ImportRowStatus = "ready" | "skip_dup" | "skip_no_phone" | "error";

export type ImportRowResult = {
  /** 原始行号（1-based，含表头） */
  line: number;
  status: ImportRowStatus;
  reason?: string;
  /** status=ready 时可直接 addContact 的载荷 */
  input?: ImportContactInput;
};

export type ContactImportResult = {
  rows: ImportRowResult[];
  created: ImportRowResult[];
  skipped: ImportRowResult[];
  errors: ImportRowResult[];
  detectedDelimiter: string;
  headers: string[];
  hasHeader: boolean;
};

export type ImportNameRule = {
  prefix: string;
  suffix: string;
  fallback: "phone" | "sequence";
};

/** 生成最终联系人姓名：已有姓名可批量加前后缀，无姓名时按号码或序号补齐。 */
export function applyImportNameRule(
  name: string | undefined,
  phone: string | undefined,
  index: number,
  rule: ImportNameRule
): string {
  const fallback = rule.fallback === "sequence"
    ? `客户-${String(index + 1).padStart(3, "0")}`
    : `客户-${(phone || "").replace(/\D/g, "").slice(-4) || String(index + 1).padStart(3, "0")}`;
  return `${rule.prefix}${name?.trim() || fallback}${rule.suffix}`.trim();
}

const HEADER_ALIASES: Record<string, keyof ImportContactInput> = {
  name: "name",
  姓名: "name",
  名字: "name",
  客户名: "name",
  联系人: "name",
  联系人姓名: "name",
  phone: "phone",
  电话: "phone",
  手机: "phone",
  手机号: "phone",
  手机号码: "phone",
  number: "phone",
  mobile: "phone",
  tel: "phone",
  company: "company",
  公司: "company",
  公司名: "company",
  单位: "company",
  企业: "company",
  客户公司: "company",
  country: "country",
  国家: "country",
  地区: "country",
  source: "source",
  来源: "source",
  渠道: "source",
  owner: "owner",
  负责人: "owner",
  归属: "owner",
  sales: "owner",
  stage: "stage",
  阶段: "stage",
  tags: "tags",
  标签: "tags",
  标记: "tags",
  notes: "notes",
  备注: "notes",
  说明: "notes",
  nextFollowUpAt: "nextFollowUpAt",
  下次跟进: "nextFollowUpAt",
  跟进时间: "nextFollowUpAt",
  下次跟进时间: "nextFollowUpAt",
  accountId: "accountId",
  账号: "accountId",
  账号id: "accountId",
};

function normalizeHeaderKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/** 无表头时的列位猜测（按最常出现的顺序） */
const POSITIONAL_FIELDS: (keyof ImportContactInput)[] = [
  "name",
  "phone",
  "company",
  "stage",
  "tags",
  "notes",
];

/** 解析一行 CSV（支持引号转义与内嵌换行）。返回字段数组，含引号已剥离。 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/**
 * 检测整段文本的主分隔符。
 * 优先 Tab（Excel 复制）；其次统计逗号/分号在首行的出现次数。
 */
export function detectDelimiter(text: string): string {
  const firstLine = (text || "").split(/\r?\n/)[0] || "";
  if (firstLine.includes("\t")) return "\t";
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  return commas >= semis && commas > 0 ? "," : ";";
}

export function normalizeImportPhone(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.includes("@lid")) return "";
  if (s.includes("@s.whatsapp.net") || s.includes("@c.us")) {
    const d = s.split("@")[0].split(":")[0];
    return d && /^\d{7,15}$/.test(d) ? `+${d}` : "";
  }
  if (s.startsWith("+") && /^\+\d{7,15}$/.test(s)) return s;
  if (/^\d{7,15}$/.test(s)) return `+${s}`;
  if (/^\d{16,}$/.test(s)) return "";
  return "";
}

function mapHeaderToField(header: string): keyof ImportContactInput | null {
  const key = normalizeHeaderKey(header);
  const hit = HEADER_ALIASES[key];
  if (hit) return hit;
  // 兜底：去掉常见前缀后缀再试（如 "客户手机号"、"公司名称"）
  for (const [alias, field] of Object.entries(HEADER_ALIASES)) {
    if (normalizeHeaderKey(alias) && key.includes(normalizeHeaderKey(alias)))
      return field;
  }
  return null;
}

function parseTags(raw: string): string[] {
  return String(raw || "")
    .split(/[|,，;；]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeRow(
  fields: Record<keyof ImportContactInput, string>
): ImportContactInput {
  const input: ImportContactInput = {
    name: fields.name || undefined,
    phone: normalizeImportPhone(fields.phone || "") || undefined,
    company: fields.company || undefined,
    country: fields.country || undefined,
    source: fields.source || undefined,
    owner: fields.owner || undefined,
    notes: fields.notes || undefined,
    nextFollowUpAt: fields.nextFollowUpAt || undefined,
    accountId: fields.accountId || undefined,
  };
  const stageRaw = (fields.stage || "").trim().toLowerCase();
  if (stageRaw) {
    // 接受阶段中文名/英文 id
    const stageMap: Record<string, SalesStage> = {
      new: "new",
      新客户: "new",
      未跟进: "new",
      contacted: "contacted",
      已联系: "contacted",
      联系中: "contacted",
      quoting: "quoting",
      报价中: "quoting",
      询价: "quoting",
      won: "won",
      成交: "won",
      已成交: "won",
      after_sales: "after_sales",
      售后: "after_sales",
    };
    const st = stageMap[stageRaw];
    if (st) input.stage = st;
  }
  const tagsRaw = fields.tags || "";
  if (tagsRaw.trim()) input.tags = parseTags(tagsRaw);
  return input;
}

/**
 * 主入口：把文本解析为可导入的行列表。
 *
 * @param text       粘贴内容或文件内容
 * @param existing   当前 store 内的联系人（用于手机号去重）
 * @param opts.hasHeader 是否含表头；缺省自动判断（首行包含已识别的表头字段）
 */
export function parseContactsImport(
  text: string,
  existing: Contact[],
  opts?: { hasHeader?: boolean }
): ContactImportResult {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (!lines.length) {
    return emptyResult();
  }
  const delimiter = detectDelimiter(lines.join("\n"));
  const firstCells = splitCsvLine(lines[0]!, delimiter);

  // 表头判定：显式给定；否则首行识别出 phone/name 关键列即视为表头
  // （无表头时首行通常是数据，不会命中别名；单列"电话"也成立）
  let hasHeader: boolean;
  if (opts?.hasHeader !== undefined) {
    hasHeader = opts.hasHeader;
  } else {
    const detected = firstCells
      .map((c) => mapHeaderToField(c))
      .filter((f): f is keyof ImportContactInput => f !== null);
    hasHeader = detected.includes("phone") || detected.includes("name");
  }

  // 字段名 → 列索引
  const fieldToIndex: Partial<Record<keyof ImportContactInput, number>> = {};
  const headers: string[] = [];
  const start = hasHeader ? 1 : 0;
  if (hasHeader) {
    headers.push(...firstCells);
    firstCells.forEach((cell, i) => {
      const field = mapHeaderToField(cell);
      if (field) fieldToIndex[field] = i;
    });
    // 必填的电话列没识别到 → 报错（返回全 error 行）
    if (fieldToIndex.phone === undefined) {
      const errorRows: ImportRowResult[] = lines
        .slice(start)
        .map((_, i) => ({
          line: start + i + 1,
          status: "error" as const,
          reason: "未识别到电话列，请确认表头含「电话/手机号/phone」",
        }));
      return {
        rows: errorRows,
        created: [],
        skipped: [],
        errors: errorRows,
        detectedDelimiter: delimiter,
        headers,
        hasHeader: true,
      };
    }
  } else {
    // 单列纯号码是最高频粘贴方式；多列再按 name/phone/company/... 猜测。
    if (firstCells.length === 1 && normalizeImportPhone(firstCells[0] || "")) {
      fieldToIndex.phone = 0;
    } else {
      firstCells.forEach((_, i) => {
        const field = POSITIONAL_FIELDS[i];
        if (field) fieldToIndex[field] = i;
      });
    }
    headers.push(...firstCells.map((_, i) => `col${i + 1}`));
  }

  const existingPhones = new Set<string>();
  for (const c of existing) {
    const p = normalizeImportPhone(c.phone || "");
    if (p) existingPhones.add(p);
  }
  const seenInBatch = new Set<string>();
  const rows: ImportRowResult[] = [];

  for (let i = start; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = splitCsvLine(lines[i]!, delimiter);
    const fields = {} as Record<keyof ImportContactInput, string>;
    for (const [field, idx] of Object.entries(fieldToIndex) as [
      keyof ImportContactInput,
      number
    ][]) {
      fields[field] = cells[idx] || "";
    }
    const input = normalizeRow(fields);

    if (!input.phone) {
      rows.push({
        line: lineNo,
        status: "skip_no_phone",
        reason: input.name ? "无有效手机号" : "无姓名且无手机号",
      });
      continue;
    }
    if (existingPhones.has(input.phone) || seenInBatch.has(input.phone)) {
      rows.push({ line: lineNo, status: "skip_dup", reason: "手机号已存在" });
      continue;
    }
    seenInBatch.add(input.phone);
    rows.push({ line: lineNo, status: "ready", input });
  }

  const created = rows.filter((r) => r.status === "ready");
  const skipped = rows.filter(
    (r) => r.status === "skip_dup" || r.status === "skip_no_phone"
  );
  const errors = rows.filter((r) => r.status === "error");
  return { rows, created, skipped, errors, detectedDelimiter: delimiter, headers, hasHeader };
}

function emptyResult(): ContactImportResult {
  return {
    rows: [],
    created: [],
    skipped: [],
    errors: [],
    detectedDelimiter: ",",
    headers: [],
    hasHeader: false,
  };
}
