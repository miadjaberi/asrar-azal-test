(() => {
'use strict';
const db=window.ASRAR_SUPABASE_CLIENT;
if(!db){console.error('[Asrar auth] Shared Supabase client unavailable');return;}
const digits=v=>String(v||'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
async function request(action,payload){
 const {data,error}=await db.functions.invoke('phone-pin-auth',{body:{action,...payload,phone:digits(payload.phone),pin:digits(payload.pin)}});
 if(error){let message=error.message||'ارتباط با سرور ناموفق بود.';try{const r=error.context;if(r?.json){const j=await r.json();if(j?.error)message=j.error}}catch(_){}throw new Error(message)}
 if(!data?.session?.access_token||!data?.session?.refresh_token)throw new Error(data?.error||'پاسخ سرور کامل نیست.');
 const {error:sessionError}=await db.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
 if(sessionError)throw sessionError;return data;
}
async function currentUser(){const {data,error}=await db.auth.getUser();if(error)throw error;return data?.user||null}
async function profile(){const u=await currentUser();if(!u)return null;const {data,error}=await db.from('profiles').select('id,name,phone,role,registered_at,last_login_at').eq('id',u.id).maybeSingle();if(error)throw error;return data||null}
async function signOut(){const {error}=await db.auth.signOut();if(error)throw error}
window.ASRAR_AUTH=Object.freeze({register:p=>request('register',{...p,name:String(p.name||'').trim()}),login:p=>request('login',p),currentUser,profile,signOut});
})();