import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://miadjaberi.github.io";
function corsHeaders(origin: string | null) {
  return {
    ...(origin === ALLOWED_ORIGIN ? { "Access-Control-Allow-Origin": ALLOWED_ORIGIN } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}
function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}
function emailFor(phone: string) { return phone + "@phone.asrar-azal.invalid"; }
async function rateKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function consumeLimit(admin: ReturnType<typeof createClient>, key: string, limit: number) {
  return admin.rpc("consume_phone_pin_rate_limit", { p_rate_key: key, p_limit: limit, p_window_seconds: 900 });
}
async function findProfile(admin: ReturnType<typeof createClient>, phone: string) {
  return admin.from("profiles").select("id,name,phone,role,registered_at").eq("phone", phone).maybeSingle();
}
async function findProfileById(admin: ReturnType<typeof createClient>, id: string) {
  return admin.from("profiles").select("id,name,phone,role,registered_at").eq("id", id).maybeSingle();
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== ALLOWED_ORIGIN) return reply(403, { error: "مبدأ درخواست مجاز نیست." }, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, { error: "روش درخواست پشتیبانی نمی‌شود." }, origin);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return reply(500, { error: "تنظیمات امن سرور کامل نیست." }, origin);
  let body: { action?: string; name?: string; phone?: string; pin?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "درخواست نامعتبر است." }, origin); }
  const action = String(body.action || "");
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").replace(/\s/g, "");
  const pin = String(body.pin || "");
  if (!["register", "login"].includes(action) || !/^09[0-9]{9}$/.test(phone) || !/^\d{8,12}$/.test(pin)) {
    return reply(400, { error: "شماره تماس یا PIN معتبر نیست؛ PIN باید ۸ تا ۱۲ رقم باشد." }, origin);
  }
  if (action === "register" && (!name || name.length > 100)) return reply(400, { error: "نام معتبر نیست." }, origin);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
    const ip = forwarded.split(",")[0].trim().slice(0, 100) || "unknown";
    const [phoneKey, ipKey] = await Promise.all([rateKey("phone:" + phone), rateKey("ip:" + ip)]);
    const [phoneLimit, ipLimit] = await Promise.all([consumeLimit(admin, phoneKey, 8), consumeLimit(admin, ipKey, 30)]);
    if (phoneLimit.error || ipLimit.error) return reply(503, { error: "کنترل امنیتی سرور آماده نیست؛ بعداً دوباره تلاش کنید." }, origin);
    if (phoneLimit.data !== true || ipLimit.data !== true) return reply(429, { error: "تعداد تلاش‌ها زیاد است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." }, origin);
    if (action === "login") {
      const { data: signed, error: signInError } = await auth.auth.signInWithPassword({ email: emailFor(phone), password: pin });
      if (signInError || !signed.session || !signed.user) return reply(401, { error: "PIN اشتباه است یا برای این شماره حسابی پیدا نشد." }, origin);
      const { data: profile, error: profileError } = await findProfileById(admin, signed.user.id);
      if (profileError) return reply(500, { error: "بررسی پروفایل حساب ناموفق بود." }, origin);
      if (!profile || profile.phone !== phone || profile.role !== "user") return reply(401, { error: "ورود به این حساب مجاز نیست؛ اطلاعات حساب با شماره تطبیق ندارد." }, origin);
      const loginAt = new Date().toISOString();
      const { data: updatedProfile, error: lastLoginError } = await admin.from("profiles")
        .update({ last_login_at: loginAt, updated_at: loginAt }).eq("id", signed.user.id)
        .select("id,name,phone,role,registered_at,last_login_at").single();
      if (lastLoginError || !updatedProfile) return reply(500, { error: "ورود انجام شد اما ثبت زمان آخرین ورود ناموفق بود؛ دوباره تلاش کنید." }, origin);
      return reply(200, { created: false, user: { id: signed.user.id }, session: signed.session, profile: updatedProfile }, origin);
    }
    const { data: existing, error: lookupError } = await findProfile(admin, phone);
    if (lookupError) return reply(500, { error: "بررسی حساب در سرور ناموفق بود." }, origin);
    if (existing) return reply(409, { error: "این شماره قبلاً ثبت شده است؛ با شماره و PIN وارد شوید." }, origin);
    const email = emailFor(phone);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password: pin, email_confirm: true,
      user_metadata: { phone_login: true, name, phone }
    });
    if (createError || !created.user) {
      const { data: raced, error: racedError } = await findProfile(admin, phone);
      if (racedError) return reply(500, { error: "بررسی حساب پس از درخواست هم‌زمان ناموفق بود." }, origin);
      if (raced) return reply(409, { error: "این شماره قبلاً ثبت شده است؛ با شماره و PIN وارد شوید." }, origin);
      return reply(409, { error: "ساخت حساب انجام نشد؛ اطلاعات ورود را بررسی کنید." }, origin);
    }
    const { data: profile, error: profileError } = await admin.from("profiles").insert({
      id: created.user.id, name, phone, role: "user", registered_at: new Date().toISOString()
    }).select("id,name,phone,role,registered_at").single();
    if (profileError || !profile) {
      console.error("profile creation failed", profileError?.message);
      const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
      if (cleanupError) console.error("orphan auth user cleanup failed", cleanupError.message);
      return reply(500, { error: cleanupError
        ? "ساخت پروفایل ناموفق بود و پاک‌سازی حساب کامل نشد؛ پشتیبانی باید بررسی کند."
        : "ساخت پروفایل ناموفق بود؛ ساخت حساب لغو شد. دوباره تلاش کنید." }, origin);
    }
    const { data: signed, error: signError } = await auth.auth.signInWithPassword({ email, password: pin });
    if (signError || !signed.session || !signed.user || signed.user.id !== profile.id) {
      return reply(500, { error: "حساب ثبت شد اما ایجاد نشست ورود ناموفق بود؛ دوباره تلاش کنید." }, origin);
    }
    const loginAt = new Date().toISOString();
    const { data: updatedProfile, error: lastLoginError } = await admin.from("profiles")
      .update({ last_login_at: loginAt, updated_at: loginAt }).eq("id", profile.id)
      .select("id,name,phone,role,registered_at,last_login_at").single();
    if (lastLoginError || !updatedProfile) return reply(500, { error: "حساب ثبت شد اما ثبت زمان آخرین ورود ناموفق بود؛ با شماره و PIN وارد شوید." }, origin);
    return reply(200, { created: true, user: { id: signed.user.id }, session: signed.session, profile: updatedProfile }, origin);
  } catch (error) {
    console.error("phone-pin-auth failed:", error instanceof Error ? error.message : "unknown");
    return reply(500, { error: "خطای داخلی سرور؛ درخواست تأیید نشد." }, origin);
  }
});