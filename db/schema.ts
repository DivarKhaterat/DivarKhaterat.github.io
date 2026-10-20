import { pgTable, text, boolean, bigint, primaryKey, index, serial } from "drizzle-orm/pg-core";

export const memories = pgTable("memories", {
  id: text().primaryKey(),
  emotion: text().notNull(),
  text: text().notNull(),
  anon: boolean().notNull().default(false),
  name: text().notNull().default(""),
  avatar: text().notNull().default(""),
  ts: bigint({ mode: "number" }).notNull(),
}, t => [index("memories_ts_idx").on(t.ts)]);

export const likes = pgTable("likes", {
  memoryId: text("memory_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
  cid: text().notNull(),
}, t => [primaryKey({ columns: [t.memoryId, t.cid] })]);

export const comments = pgTable("comments", {
  id: text().primaryKey(),
  memoryId: text("memory_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
  name: text().notNull(),
  text: text().notNull(),
  ts: bigint({ mode: "number" }).notNull(),
}, t => [index("comments_memory_idx").on(t.memoryId)]);

// برای محدودیت تعداد درخواست هر آی‌پی (فانکشن‌ها حافظه‌ی مشترک ندارن)
export const hits = pgTable("hits", {
  id: serial().primaryKey(),
  key: text().notNull(),
  ts: bigint({ mode: "number" }).notNull(),
}, t => [index("hits_key_ts_idx").on(t.key, t.ts)]);
