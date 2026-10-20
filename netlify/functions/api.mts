// نسخه‌ی Netlify از API همون server.js — همون مسیرها، همون اعتبارسنجی‌ها، ولی با دیتابیس Netlify
import type { Config, Context } from "@netlify/functions";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { comments, hits, likes, memories } from "../../db/schema.js";

const EMOTIONS = ["joy", "sad", "anger", "disgust", "fear"];
const MAX_BODY = 60 * 1024;          // حداکثر حجم درخواست
const MAX_AVATAR = 30 * 1024;        // حداکثر حجم عکس پروفایل
const LIMIT_COUNT = 100;             // حداکثر ۱۰۰ درخواست
const LIMIT_WINDOW = 10 * 60 * 1000; // در هر ۱۰ دقیقه برای هر آی‌پی

const json = (code: number, obj: unknown) =>
  new Response(JSON.stringify(obj), {
    status: code,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const newId = (n: number) => Date.now().toString(36) + Math.random().toString(36).slice(2, 2 + n);

async function limited(key: string) {
  const since = Date.now() - LIMIT_WINDOW;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(hits).where(and(eq(hits.key, key), gt(hits.ts, since)));
  if (n >= LIMIT_COUNT) return true;
  await db.insert(hits).values({ key, ts: Date.now() });
  if (Math.random() < 0.05) await db.delete(hits).where(lt(hits.ts, since));
  return false;
}

async function readBody(req: Request) {
  const s = await req.text();
  if (new TextEncoder().encode(s).length > MAX_BODY) throw new Error("big");
  return JSON.parse(s);
}

function clean(b: any) {
  if (!b || typeof b !== "object") return null;
  if (!EMOTIONS.includes(b.emotion)) return null;
  const text = String(b.text || "").trim().slice(0, 1500);
  if (text.length < 5) return null;
  const anon = !!b.anon;
  const name = anon ? "" : String(b.name || "").trim().slice(0, 30) || "یه سربندری";
  let avatar = "";
  if (!anon && typeof b.avatar === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.avatar) && b.avatar.length <= MAX_AVATAR) avatar = b.avatar;
  return { id: newId(5), emotion: b.emotion, text, anon, name, avatar, ts: Date.now() };
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const ip = context.ip || "";

  if (url.pathname === "/api/memories") {
    if (req.method === "GET") {
      const sc = (url.searchParams.get("cid") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 80);
      const rows = await db.select().from(memories).orderBy(desc(memories.ts)).limit(200);
      const ids = rows.map(m => m.id);
      const likeRows = ids.length ? await db.select().from(likes).where(inArray(likes.memoryId, ids)) : [];
      const commentRows = ids.length ? await db.select().from(comments).where(inArray(comments.memoryId, ids)).orderBy(comments.ts) : [];
      return json(200, rows.map(m => {
        const ml = likeRows.filter(l => l.memoryId === m.id);
        return {
          id: m.id, emotion: m.emotion, text: m.text, anon: m.anon, name: m.name, avatar: m.avatar, ts: m.ts,
          likes: ml.length, liked: !!sc && ml.some(l => l.cid === sc),
          comments: commentRows.filter(c => c.memoryId === m.id).map(c => ({ id: c.id, name: c.name, text: c.text, ts: c.ts })),
        };
      }));
    }
    if (req.method === "POST") {
      if (await limited(ip)) return json(429, { error: "too_many" });
      try {
        const m = clean(await readBody(req));
        if (!m) return json(400, { error: "invalid" });
        await db.insert(memories).values(m);
        return json(201, { ok: true });
      } catch (e) { return json(400, { error: "bad_request" }); }
    }
    return json(405, { error: "method" });
  }

  const mm = url.pathname.match(/^\/api\/memories\/([a-z0-9]+)\/(like|comments)$/);
  if (!mm) return json(404, { error: "not_found" });
  if (req.method !== "POST") return json(405, { error: "method" });
  if (await limited(ip + ":a")) return json(429, { error: "too_many" });
  const [m] = await db.select({ id: memories.id }).from(memories).where(eq(memories.id, mm[1]));
  if (!m) return json(404, { error: "not_found" });
  try {
    const b = await readBody(req);
    if (mm[2] === "like") {
      const c = String(b.cid || "");
      if (!/^[A-Za-z0-9]{8,80}$/.test(c)) return json(400, { error: "invalid" });
      const removed = await db.delete(likes).where(and(eq(likes.memoryId, m.id), eq(likes.cid, c))).returning();
      if (!removed.length) await db.insert(likes).values({ memoryId: m.id, cid: c }).onConflictDoNothing();
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(likes).where(eq(likes.memoryId, m.id));
      return json(200, { likes: n, liked: !removed.length });
    }
    const text = String(b.text || "").trim().slice(0, 500);
    if (text.length < 2) return json(400, { error: "invalid" });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(comments).where(eq(comments.memoryId, m.id));
    if (n >= 300) return json(400, { error: "full" });
    await db.insert(comments).values({ id: newId(4), memoryId: m.id, name: String(b.name || "").trim().slice(0, 30) || "ناشناس", text, ts: Date.now() });
    return json(201, { ok: true });
  } catch (e) { return json(400, { error: "bad_request" }); }
};

export const config: Config = {
  path: ["/api/memories", "/api/memories/*"],
};
