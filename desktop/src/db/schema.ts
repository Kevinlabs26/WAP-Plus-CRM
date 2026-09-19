/**
 * Drizzle ORM schema — SQLite（结构说明 / 演进参考）
 *
 * 注意：桌面运行时的读写真源是 `appStore` + `lib/storage`（SQLite/IndexedDB 封装），
 * 不是本文件生成的 query 层。字段若落后于 `types/crm.ts`，以 types + store 为准。
 * 本文件保留用于文档对齐与未来正式迁移，避免再出现「界面有、schema 无」的双真源误解。
 *
 * 实体：Phones / Contacts / Chats / Messages / FollowUps / Tags / AIHistory / Settings
 */
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const phones = sqliteTable("phones", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  model: text("model"),
  remark: text("remark"),
  online: integer("online", { mode: "boolean" }).default(false),
  battery: integer("battery").default(0),
  boundRegion: text("bound_region"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  country: text("country"),
  company: text("company"),
  source: text("source"),
  owner: text("owner"),
  /** JSON array string */
  tags: text("tags").default("[]"),
  stage: text("stage").notNull().default("new"),
  notes: text("notes"),
  aiSummary: text("ai_summary"),
  /** 永久绑定手机 — 核心壁垒 */
  boundPhoneId: text("bound_phone_id").references(() => phones.id),
  nextFollowUpAt: text("next_follow_up_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chats = sqliteTable("chats", {
  id: text("id").primaryKey(),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id),
  phoneId: text("phone_id")
    .notNull()
    .references(() => phones.id),
  lastMessage: text("last_message"),
  unread: integer("unread").default(0),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id),
  direction: text("direction").notNull(), // in | out
  body: text("body").notNull(),
  sentAt: text("sent_at").notNull(),
  rawJson: text("raw_json"),
});

export const followUps = sqliteTable("follow_ups", {
  id: text("id").primaryKey(),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id),
  dueAt: text("due_at").notNull(),
  note: text("note"),
  done: integer("done", { mode: "boolean" }).default(false),
  createdAt: text("created_at").notNull(),
});

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"),
});

export const aiHistory = sqliteTable("ai_history", {
  id: text("id").primaryKey(),
  contactId: text("contact_id").references(() => contacts.id),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(), // suggest | summary | translate | ...
  prompt: text("prompt"),
  response: text("response"),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
