import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const json = (code, obj) =>
  new Response(JSON.stringify(obj), {
    status: code,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const same = (a, b) => {
  const x = Buffer.from(a || ""), y = Buffer.from(b || "");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

const roleOf = (key) => {
  if (same(key, process.env.WAREHOUSE_KEY)) return "warehouse";
  if (same(key, process.env.VIEW_KEY)) return "viewer";
  return null;
};

export default async (req) => {
  const url = new URL(req.url);
  const role = roleOf(req.headers.get("x-key"));

  if (url.pathname === "/api/me") return json(role ? 200 : 401, { role });
  if (!role) return json(401, { error: "مفتاح غير صحيح" });

  const store = getStore("stock");
  const items = (await store.get("items", { type: "json" })) || {};

  const logStore = async (entry) => {
    const log = (await store.get("log", { type: "json" })) || [];
    log.push({ ...entry, ts: Math.floor(Date.now() / 1000) });
    await store.setJSON("log", log.slice(-500));
  };

  if (req.method === "GET" && url.pathname === "/api/log") {
    const log = (await store.get("log", { type: "json" })) || [];
    return json(200, log.slice().reverse());
  }

  if (req.method === "GET") {
    const rows = Object.values(items).sort((a, b) => a.name.localeCompare(b.name, "ar"));
    return json(200, rows);
  }

  if (role !== "warehouse") return json(403, { error: "التعديل للمستودع فقط" });

  if (req.method === "POST") {
    let d;
    try { d = await req.json(); } catch { return json(400, { error: "بيانات غير صحيحة" }); }
    const name = String(d.name ?? "").trim().slice(0, 120);
    const qty = Number(d.qty);
    if (!name || !Number.isFinite(qty)) return json(400, { error: "بيانات غير صحيحة" });
    const old = items[name] ? items[name].qty : null;
    const unit = String(d.unit ?? "").trim().slice(0, 30);
    items[name] = { name, qty, unit: String(d.unit ?? "").trim().slice(0, 30), updated: Math.floor(Date.now() / 1000) };
    await store.setJSON("items", items);
    await logStore({ type: "set", name, old, qty, unit });
    return json(200, { ok: true });
  }

  if (req.method === "DELETE") {
    const dn = url.searchParams.get("name") || "";
    const gone = items[dn];
    delete items[dn];
    await store.setJSON("items", items);
    if (gone) await logStore({ type: "delete", name: dn, old: gone.qty, qty: null, unit: gone.unit });
    return json(200, { ok: true });
  }

  return json(405, { error: "غير مسموح" });
};

export const config = { path: ["/api/me", "/api/stock", "/api/log"] };
