/* 瀏覽人數（Cloudflare Pages Functions，網址 /api/visits）
 * 今日人數：今天（台灣時間）來過的不同網路位址（IP）數；累計人數：開站以來來過的不同 IP 數。
 * 不存 IP 本身，只存「IP＋密語」的 SHA-256 雜湊；每天的名單只留兩天，之後自動刪掉。
 * 需要在 Cloudflare Pages 專案 windpowerglobe 的 Settings → Bindings 加一個 D1 資料庫，變數名稱 VISITS_DB；
 * 也可以在 Settings → Variables 加一個 VISIT_SALT（任意一串亂碼），沒有設就用下面的預設值。
 * POST：記這一次來訪並回傳人數；GET：只回傳人數（本機開發用，不會算進去）。
 */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS day_ips (day TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY (day, h))',
  'CREATE TABLE IF NOT EXISTS all_ips (h TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS counts (k TEXT PRIMARY KEY, n INTEGER NOT NULL)',
];

// 台灣時間的日期（YYYY-MM-DD）
const twDay = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function counts(db, day) {
  const r = await db.prepare("SELECT k, n FROM counts WHERE k IN ('total', ?)").bind('d:' + day).all();
  const m = Object.fromEntries((r.results || []).map(x => [x.k, x.n]));
  return { today: m['d:' + day] || 0, total: m.total || 0 };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const db = env.VISITS_DB;
  if (!db) return json({ error: 'no database' }, 503);
  const day = twDay();
  try {
    await db.batch(SCHEMA.map(q => db.prepare(q)));
    if (request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || '';
      if (ip) {
        const h = await sha256((env.VISIT_SALT || 'windpowerglobe-2026') + '|' + ip);
        // 第一次看到這個 IP（今天／開站以來）才加一
        const [d, a] = await db.batch([
          db.prepare('INSERT OR IGNORE INTO day_ips (day, h) VALUES (?, ?)').bind(day, h),
          db.prepare('INSERT OR IGNORE INTO all_ips (h) VALUES (?)').bind(h),
        ]);
        const up = [];
        if (d.meta.changes) up.push(db.prepare('INSERT INTO counts (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1').bind('d:' + day));
        if (a.meta.changes) up.push(db.prepare("INSERT INTO counts (k, n) VALUES ('total', 1) ON CONFLICT(k) DO UPDATE SET n = n + 1"));
        if (up.length) await db.batch(up);
        if (d.meta.changes) await db.prepare('DELETE FROM day_ips WHERE day < ?').bind(twDay(Date.now() - 2 * 86400e3)).run(); // 舊的每日名單刪掉
      }
    }
    return json(await counts(db, day));
  } catch (e) {
    return json({ error: 'database error' }, 500);
  }
}
