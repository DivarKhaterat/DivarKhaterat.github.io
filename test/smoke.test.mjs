// تست دودی برای سرور دیوار خاطرات سربندر (بدون هیچ وابستگی — فقط Node 18+)
// سرور داخل یک پوشه‌ی موقت اجرا می‌شه تا دیتای واقعی (data/memories.json) دست نخوره.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const CID = 'a'.repeat(12);

const dir = mkdtempSync(join(tmpdir(), 'sarbandar-smoke-'));
cpSync(join(ROOT, 'server.js'), join(dir, 'server.js'));
cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });

const srv = spawn(process.execPath, ['server.js'], {
  cwd: dir,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
srv.stdout.on('data', c => (logs += c));
srv.stderr.on('data', c => (logs += c));

function raw(pathname, method = 'GET') {
  // fetch مسیرها رو نرمال می‌کنه؛ برای تست traversal از http.request استفاده می‌کنیم
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path: pathname, method }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchJson(pathname, options) {
  const r = await fetch(BASE + pathname, options);
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function waitForServer() {
  const deadline = Date.now() + 20000;
  for (;;) {
    if (srv.exitCode !== null) throw new Error(`سرور از کار افتاد:\n${logs}`);
    try { return await fetch(BASE + '/'); } catch { /* هنوز بالا نیومده */ }
    if (Date.now() > deadline) throw new Error(`سرور بالا نیومد:\n${logs}`);
    await new Promise(r => setTimeout(r, 200));
  }
}

let passed = 0;
function ok(label) { passed++; console.log(`  ✔ ${label}`); }

try {
  await waitForServer();

  // --- فایل‌های ثابت ---
  const home = await fetch(BASE + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /<html/i);
  ok('GET / صفحه‌ی اصلی رو سرو می‌کنه');

  const missing = await fetch(BASE + '/nope.html');
  assert.equal(missing.status, 404);
  ok('GET صفحه‌ی ناموجود 404 می‌ده');

  // نرمال‌سازی URL خودش مسیرهای ../ ساده رو خنثی می‌کنه (404)؛ گارد سرور هم نسخه‌ی
  // کدگذاری‌شده رو بلاک می‌کنه (403) — در هر دو حالت نباید فایلی بیرون از public لو بره.
  assert.equal((await raw('/../server.js')).status, 404);
  const traversal = await raw('/..%2fserver.js');
  assert.equal(traversal.status, 403);
  ok('دسترسی به خارج از public مسدوده (403)');

  // --- API: ساخت ---
  assert.deepEqual((await fetchJson('/api/memories')).data, []);
  ok('لیست اولیه خالیه');

  const bad = await fetchJson('/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emotion: 'nope', text: 'کوتاه' }),
  });
  assert.equal(bad.status, 400);
  ok('خاطره‌ی نامعتبر 400 می‌گیره');

  const created = await fetchJson('/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emotion: 'joy', text: 'خاطره‌ی آزمایشی برای تست', anon: false, name: 'تست‌ر' }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.ok, true);
  ok('خاطره‌ی معتبر ثبت می‌شه (201)');

  // --- API: خواندن ---
  const list = await fetchJson(`/api/memories?cid=${CID}`);
  assert.equal(list.data.length, 1);
  const id = list.data[0].id;
  assert.equal(list.data[0].likes, 0);
  assert.equal(list.data[0].liked, false);
  assert.deepEqual(list.data[0].comments, []);
  ok('خاطره ثبت‌شده با فیلدهای درست برگردونده می‌شه');

  // --- API: لایک (toggle) ---
  const like1 = await fetchJson(`/api/memories/${id}/like`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cid: CID }),
  });
  assert.deepEqual(like1.data, { likes: 1, liked: true });
  const like2 = await fetchJson(`/api/memories/${id}/like`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cid: CID }),
  });
  assert.deepEqual(like2.data, { likes: 0, liked: false });
  ok('لایک یک‌بار ثبت و یک‌بار برداشته می‌شه');

  // --- API: نظر ---
  const shortComment = await fetchJson(`/api/memories/${id}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', text: 'a' }),
  });
  assert.equal(shortComment.status, 400);
  const comment = await fetchJson(`/api/memories/${id}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'نظردهنده', text: 'نظر آزمایشی' }),
  });
  assert.equal(comment.status, 201);
  const withComment = await fetchJson(`/api/memories?cid=${CID}`);
  assert.equal(withComment.data[0].comments.length, 1);
  assert.equal(withComment.data[0].comments[0].text, 'نظر آزمایشی');
  ok('نظر ثبت و همراه خاطره برگردونده می‌شه');

  // --- API: خطاهای دیگه ---
  assert.equal((await fetchJson(`/api/memories/${'z'.repeat(10)}/like`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cid: CID }),
  })).status, 404);
  assert.equal((await fetchJson(`/api/memories/${id}/like`, { method: 'GET' })).status, 405);
  assert.equal((await fetchJson('/api/memories/xyz')).status, 404);
  ok('شناسه‌ی ناموجود 404 و متد نادرست 405 می‌ده');

  console.log(`\nهمه‌ی ${passed} سناریو پاس شدند.`);
} catch (e) {
  console.error('\nتست شکست خورد:', e.message || e);
  process.exitCode = 1;
} finally {
  srv.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
