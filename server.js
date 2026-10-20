// دیوار خاطرات سربندر - سرور بدون وابستگی (فقط Node.js 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'memories.json');
const PUBLIC = path.join(__dirname, 'public');
const EMOTIONS = ['joy', 'sad', 'anger', 'disgust', 'fear'];
const MAX_BODY = 60 * 1024;          // حداکثر حجم درخواست
const MAX_AVATAR = 30 * 1024;        // حداکثر حجم عکس پروفایل
const LIMIT_COUNT = 100;             // حداکثر ۱۰۰ خاطره
const LIMIT_WINDOW = 10 * 60 * 1000; // در هر ۱۰ دقیقه برای هر آی‌پی

fs.mkdirSync(DATA_DIR, { recursive: true });
let memories = [];
try { memories = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}

let saving = false, dirty = false;
function save() {
  if (saving) { dirty = true; return; }
  saving = true;
  const tmp = DB_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(memories), err => {
    if (!err) fs.rename(tmp, DB_FILE, () => {});
    saving = false;
    if (dirty) { dirty = false; save(); }
  });
}

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < LIMIT_WINDOW);
  if (arr.length >= LIMIT_COUNT) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some(t => n - t < LIMIT_WINDOW)) hits.delete(k); }, 60000).unref();

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clean(b) {
  if (!b || typeof b !== 'object') return null;
  if (!EMOTIONS.includes(b.emotion)) return null;
  const text = String(b.text || '').trim().slice(0, 1500);
  if (text.length < 5) return null;
  const anon = !!b.anon;
  let name = anon ? '' : String(b.name || '').trim().slice(0, 30) || 'یه سربندری';
  let avatar = '';
  if (!anon && typeof b.avatar === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.avatar) && b.avatar.length <= MAX_AVATAR) avatar = b.avatar;
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), emotion: b.emotion, text, anon, name, avatar, ts: Date.now(), likes: [], comments: [] };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  const sc = (url.searchParams.get('cid') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 80);
  const pub = m => ({ id: m.id, emotion: m.emotion, text: m.text, anon: m.anon, name: m.name, avatar: m.avatar, ts: m.ts,
    likes: (m.likes || []).length, liked: !!sc && (m.likes || []).includes(sc), comments: m.comments || [] });

  if (url.pathname === '/api/memories') {
    if (req.method === 'GET') return json(res, 200, memories.slice(-200).reverse().map(pub));
    if (req.method === 'POST') {
      if (limited(ip)) return json(res, 429, { error: 'too_many' });
      try {
        const m = clean(JSON.parse(await readBody(req)));
        if (!m) return json(res, 400, { error: 'invalid' });
        memories.push(m); save();
        return json(res, 201, { ok: true });
      } catch (e) { return json(res, 400, { error: 'bad_request' }); }
    }
    return json(res, 405, { error: 'method' });
  }

  const mm = url.pathname.match(/^\/api\/memories\/([a-z0-9]+)\/(like|comments)$/);
  if (mm) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (limited(ip + ':a')) return json(res, 429, { error: 'too_many' });
    const m = memories.find(x => x.id === mm[1]);
    if (!m) return json(res, 404, { error: 'not_found' });
    try {
      const b = JSON.parse(await readBody(req));
      if (mm[2] === 'like') {
        const c = String(b.cid || '');
        if (!/^[A-Za-z0-9]{8,80}$/.test(c)) return json(res, 400, { error: 'invalid' });
        m.likes = m.likes || [];
        const i = m.likes.indexOf(c);
        if (i >= 0) m.likes.splice(i, 1); else m.likes.push(c);
        save();
        return json(res, 200, { likes: m.likes.length, liked: i < 0 });
      }
      const text = String(b.text || '').trim().slice(0, 500);
      if (text.length < 2) return json(res, 400, { error: 'invalid' });
      m.comments = m.comments || [];
      if (m.comments.length >= 300) return json(res, 400, { error: 'full' });
      m.comments.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(b.name || '').trim().slice(0, 30) || 'ناشناس', text, ts: Date.now() });
      save();
      return json(res, 201, { ok: true });
    } catch (e) { return json(res, 400, { error: 'bad_request' }); }
  }

  // فایل‌های ثابت
  let p = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log('دیوار خاطرات سربندر روی پورت ' + PORT + ' بالا اومد: http://localhost:' + PORT));
