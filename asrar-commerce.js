/* Asrar-e Azal online commerce/support module.
   Depends on the existing public Supabase config and authenticated user session.
   Does not replace the app's account, password, theme or appearance modules. */
(() => {
  'use strict';
  const cfg = window.ASRAR_SUPABASE_CONFIG || {};
  const supa = window.supabase;
  if (!cfg.url || !cfg.anonKey || !supa?.createClient) {
    console.warn('[Asrar commerce] Supabase project configuration is not complete.');
    return;
  }
  const db = supa.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const $ = (s, root=document) => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => Number(v || 0).toLocaleString('fa-IR') + ' تومان';
  const date = v => v ? new Date(v).toLocaleString('fa-IR') : '—';
  const statusLabel = v => ({new:'جدید',reviewing:'در حال بررسی',approved:'تأیید شده',rejected:'رد شده',completed:'تکمیل شده',cancelled:'لغو شده',unpaid:'پرداخت‌نشده',pending:'در انتظار',paid:'پرداخت‌شده',refunded:'مسترد شده',active:'فعال',expired:'منقضی',revoked:'لغو شده',answered:'پاسخ داده شده',open:'باز',closed:'بسته'})[v] || v || '—';
  const state = { user:null, admin:false, tab:'dashboard', products:[], plans:[], orders:[], requests:[], threads:[], payment:null, modalData:null };
  const style = document.createElement('style');
  style.textContent = `
  #asrarShopLaunch,#asrarOpsLaunch{border:1px solid #9e8144;background:linear-gradient(135deg,#211b32,#151126);color:#f1d58a;border-radius:12px;padding:10px 12px;font:700 12px Vazirmatn,Tahoma;cursor:pointer}
  #asrar-commerce-shortcuts{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px}
  #asrarCommerceLayer{position:fixed;inset:0;z-index:100500;background:#090714f5;color:#f3eefc;display:none;flex-direction:column;font:13px Vazirmatn,Tahoma;direction:rtl}
  #asrarCommerceLayer .ac-head{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid #39314d;gap:8px}
  #asrarCommerceLayer .ac-head strong{color:#f1d58a;font-size:15px}
  #asrarCommerceLayer .ac-close,#asrarCommerceLayer .ac-btn{border:1px solid #5a4b77;background:#211b32;color:#f3eefc;border-radius:9px;padding:8px 11px;cursor:pointer;font:inherit}
  #asrarCommerceLayer .ac-btn.primary{background:#80652e;border-color:#b7954c;color:#fff}
  #asrarCommerceLayer .ac-btn.danger{border-color:#84444b;color:#ffc8ce}
  #asrarCommerceLayer .ac-tabs{display:flex;gap:6px;padding:8px;overflow:auto;border-bottom:1px solid #39314d}
  #asrarCommerceLayer .ac-tabs button{white-space:nowrap}
  #asrarCommerceLayer .ac-tabs button.on{background:#80652e;border-color:#d0ad5b}
  #asrarCommerceLayer .ac-body{overflow:auto;padding:12px;flex:1}
  #asrarCommerceLayer .ac-card{background:#171326;border:1px solid #39314d;border-radius:12px;padding:12px;margin:0 0 10px}
  #asrarCommerceLayer .ac-card h3{font-size:14px;color:#f1d58a;margin:0 0 8px}
  #asrarCommerceLayer .ac-muted{color:#b7aecb;font-size:11px;line-height:1.8}
  #asrarCommerceLayer .ac-row{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
  #asrarCommerceLayer .ac-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px}
  #asrarCommerceLayer .ac-field{display:block;margin:8px 0;color:#d8cde9}
  #asrarCommerceLayer input,#asrarCommerceLayer textarea,#asrarCommerceLayer select{display:block;width:100%;margin-top:5px;padding:9px;border-radius:8px;border:1px solid #514663;background:#0e0b19;color:#fff;font:inherit}
  #asrarCommerceLayer img{max-width:100%;border-radius:9px;object-fit:cover}
  #asrarCommerceLayer .ac-table{width:100%;border-collapse:collapse;font-size:11px}
  #asrarCommerceLayer .ac-table th,#asrarCommerceLayer .ac-table td{padding:8px 6px;border-bottom:1px solid #39314d;text-align:right;vertical-align:top}
  #asrarCommerceLayer .ac-table th{color:#f1d58a}
  #asrarCommerceLayer .ac-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
  #asrarCommerceLayer .ac-empty{padding:20px;text-align:center;color:#b7aecb}
  `;
  document.head.appendChild(style);
  const layer = document.createElement('section');
  layer.id = 'asrarCommerceLayer';
  layer.innerHTML = '<div class="ac-head"><strong id="acTitle">سامانه آنلاین اسرار ازل</strong><button class="ac-close" id="acClose">بستن ✕</button></div><div class="ac-tabs" id="acTabs"></div><main class="ac-body" id="acBody"></main>';
  document.body.appendChild(layer);
  $('#acClose',layer).onclick = () => layer.style.display='none';

  async function currentUser() {
    const {data,error}=await db.auth.getUser();
    if(error) throw error;
    state.user=data.user || null;
    state.admin=state.user?.app_metadata?.role === 'admin';
    return state.user;
  }
  async function requireUser() {
    let user=await currentUser();
    if(user) return user;
    const email=prompt('ایمیل حساب کاربری');
    if(!email) return null;
    const password=prompt('رمز عبور حساب');
    if(!password) return null;
    const {data,error}=await db.auth.signInWithPassword({email,password});
    if(error) throw error;
    state.user=data.user; state.admin=data.user?.app_metadata?.role==='admin';
    return state.user;
  }
  async function requireAdmin() {
    const user=await requireUser();
    if(!user) return false;
    if(user.app_metadata?.role!=='admin') {
      if(user) await db.auth.signOut();
      state.user=null;state.admin=false;
      throw new Error('این حساب دسترسی مدیریت ندارد.');
    }
    state.admin=true;return true;
  }
  const tabs = {
    dashboard:'داشبورد',products:'محصولات',orders:'سفارش‌ها',plans:'طرح‌های اشتراک',
    requests:'درخواست‌های اشتراک',messages:'صندوق پیام',payments:'پرداخت و تخفیف',modals:'مدیریت مودال‌ها'
  };
  function tabButtons(keys) {
    $('#acTabs',layer).innerHTML=keys.map(k=>'<button class="ac-btn '+(state.tab===k?'on':'')+'" data-tab="'+k+'">'+tabs[k]+'</button>').join('');
  }
  $('#acTabs',layer).addEventListener('click',e=>{
    const b=e.target.closest('[data-tab]');if(!b)return;
    state.tab=b.dataset.tab;renderAdmin().catch(showError);
  });
  function showError(e){console.error('[Asrar commerce]',e);$('#acBody',layer).innerHTML='<div class="ac-card">خطا: '+esc(e?.message||'عملیات انجام نشد')+'</div>'}
  function openLayer(title){$('#acTitle',layer).textContent=title;layer.style.display='flex'}
  async function loadAdminData(){
    const [p,o,pl,r,t,pay]=await Promise.all([
      db.from('asrar_products').select('*').order('sort_order').order('created_at',{ascending:false}),
      db.from('asrar_orders').select('*').order('created_at',{ascending:false}).limit(100),
      db.from('asrar_subscription_plans').select('*').order('sort_order'),
      db.from('asrar_subscription_requests').select('*').order('created_at',{ascending:false}).limit(100),
      db.from('asrar_support_threads').select('*,asrar_support_messages(id,body,is_admin,created_at,sender_id)').order('last_message_at',{ascending:false}).limit(100),
      db.from('asrar_payment_settings').select('*').eq('id',true).maybeSingle()
    ]);
    for(const x of [p,o,pl,r,t,pay]) if(x.error) throw x.error;
    Object.assign(state,{products:p.data||[],orders:o.data||[],plans:pl.data||[],requests:r.data||[],threads:t.data||[],payment:pay.data});
  }
  async function renderAdmin(){
    await requireAdmin();openLayer('مدیریت سامانه اسرار ازل');await loadAdminData();
    tabButtons(Object.keys(tabs));
    const body=$('#acBody',layer);
    if(state.tab==='dashboard'){
      const sum=state.orders.reduce((a,x)=>a+Number(x.total_amount||0),0);
      body.innerHTML='<div class="ac-grid">'+[
        ['محصولات',state.products.length],['سفارش‌ها',state.orders.length],['درخواست اشتراک',state.requests.length],
        ['گفت‌وگوها',state.threads.length],['جمع مبلغ سفارش‌ها',money(sum)]
      ].map(([a,b])=>'<div class="ac-card"><div class="ac-muted">'+a+'</div><h3>'+b+'</h3></div>').join('')+'</div><div class="ac-card"><h3>آخرین سفارش‌ها</h3>'+tableOrders(state.orders.slice(0,8))+'</div>';
    } else if(state.tab==='products'){
      body.innerHTML='<div class="ac-row"><h3>مدیریت محصولات</h3><button class="ac-btn primary" id="acAddProduct">افزودن محصول +</button></div>'+state.products.map(p=>'<div class="ac-card"><div class="ac-row"><b>'+esc(p.title)+'</b><b>'+money(p.sale_price||p.price)+'</b></div><div class="ac-muted">موجودی: '+p.stock+' · '+(p.is_active?'فعال':'غیرفعال')+'</div><div class="ac-actions"><button class="ac-btn" data-edit-product="'+p.id+'">ویرایش</button><button class="ac-btn" data-toggle-product="'+p.id+'">'+(p.is_active?'غیرفعال‌کردن':'فعال‌کردن')+'</button><button class="ac-btn danger" data-delete-product="'+p.id+'">حذف</button></div></div>').join('')||'<div class="ac-empty">هنوز محصولی ثبت نشده است.</div>';
    } else if(state.tab==='orders'){
      body.innerHTML='<h3>سفارش‌ها</h3>'+tableOrders(state.orders);
    } else if(state.tab==='plans'){
      body.innerHTML='<div class="ac-row"><h3>طرح‌های اشتراک</h3><button class="ac-btn primary" id="acAddPlan">افزودن طرح +</button></div>'+state.plans.map(p=>'<div class="ac-card"><div class="ac-row"><b>'+esc(p.title)+'</b><b>'+money(p.price)+'</b></div><div class="ac-muted">'+esc(p.description)+' · '+p.duration_days+' روز · '+(p.is_active?'فعال':'غیرفعال')+'</div><div class="ac-actions"><button class="ac-btn" data-edit-plan="'+p.id+'">ویرایش</button><button class="ac-btn" data-toggle-plan="'+p.id+'">تغییر وضعیت</button></div></div>').join('')||'<div class="ac-empty">طرحی ثبت نشده است.</div>';
    } else if(state.tab==='requests'){
      body.innerHTML='<h3>درخواست‌های اشتراک</h3>'+state.requests.map(r=>'<div class="ac-card"><div class="ac-row"><b>'+esc(r.plan_title)+'</b><b>'+money(r.amount)+'</b></div><div class="ac-muted">کاربر: '+esc(r.user_id)+' · '+date(r.created_at)+' · '+statusLabel(r.status)+'</div><div class="ac-muted">شناسه پرداخت: '+esc(r.payment_reference)+' · رسید: '+esc(r.receipt_url)+'</div><div class="ac-actions"><button class="ac-btn primary" data-approve-request="'+r.id+'">تأیید و فعال‌سازی</button><button class="ac-btn danger" data-reject-request="'+r.id+'">رد درخواست</button></div></div>').join('')||'<div class="ac-empty">درخواستی ثبت نشده است.</div>';
    } else if(state.tab==='messages'){
      body.innerHTML='<h3>صندوق پیام و گفت‌وگوها</h3>'+state.threads.map(t=>'<div class="ac-card"><div class="ac-row"><b>'+esc(t.subject)+'</b><span class="ac-muted">'+statusLabel(t.status)+' · '+date(t.last_message_at)+'</span></div><div class="ac-muted">شناسه کاربر: '+esc(t.user_id)+'</div>'+(t.asrar_support_messages||[]).map(m=>'<p><b>'+(m.is_admin?'مدیریت':'کاربر')+':</b> '+esc(m.body)+' <span class="ac-muted">'+date(m.created_at)+'</span></p>').join('')+'<div class="ac-actions"><button class="ac-btn primary" data-reply-thread="'+t.id+'">پاسخ</button><button class="ac-btn" data-close-thread="'+t.id+'">بستن گفت‌وگو</button></div></div>').join('')||'<div class="ac-empty">پیامی وجود ندارد.</div>';
    } else if(state.tab==='payments'){
      const p=state.payment||{};
      body.innerHTML='<div class="ac-card"><h3>تنظیمات پرداخت</h3>'+field('عنوان پرداخت','payTitle',p.payment_title)+field('نام صاحب حساب','payHolder',p.account_holder)+field('شماره کارت','payCard',p.card_number)+field('شماره شبا','payIban',p.iban)+field('شماره پشتیبانی','payPhone',p.support_phone)+'<label class="ac-field">راهنمای پرداخت<textarea id="payInstructions">'+esc(p.instructions)+'</textarea></label><button class="ac-btn primary" id="acSavePayment">ذخیره تنظیمات پرداخت</button></div><div class="ac-card"><div class="ac-row"><h3>کدهای تخفیف</h3><button class="ac-btn primary" id="acAddDiscount">افزودن کد</button></div><div class="ac-muted">کدها فعلاً برای مدیریت ثبت می‌شوند؛ اعمال خودکار روی مبلغ سفارش تا تکمیل مسیر اعتبارسنجی سمت سرور فعال نمی‌شود.</div><div id="acDiscountList">در حال بارگذاری…</div></div>';
      loadDiscounts().catch(showError);
    } else if(state.tab==='modals'){
      const {data,error}=await db.from(cfg.contentTable||'site_content').select('content').eq('key',cfg.contentKey||'main').maybeSingle();
      if(error) throw error;
      state.modalData=data?.content||{};
      const ms=Array.isArray(state.modalData.modals)?state.modalData.modals:[];
      body.innerHTML='<h3>محتوای مودال‌ها</h3><div class="ac-muted">این بخش عنوان، زیرعنوان و راهنمای مودال‌های موجود را در محتوای اسرار ازل ویرایش می‌کند؛ منطق محاسباتی مودال‌ها تغییر نمی‌کند.</div>'+ms.map((m,i)=>'<div class="ac-card"><b>'+esc(m.t||('مودال '+(i+1)))+'</b>'+field('عنوان','mt'+i,m.t)+field('زیرعنوان','ms'+i,m.s)+'<label class="ac-field">راهنما<textarea id="mb'+i+'">'+esc(m.b)+'</textarea></label></div>').join('')+'<button class="ac-btn primary" id="acSaveModals">ذخیره راهنمای مودال‌ها</button>';
    }
    body.onclick=handleAdminAction;
  }
  function field(label,id,value){return '<label class="ac-field">'+label+'<input id="'+id+'" value="'+esc(value)+'"></label>'}
  function tableOrders(list){
    if(!list.length)return '<div class="ac-empty">سفارشی ثبت نشده است.</div>';
    return '<div style="overflow:auto"><table class="ac-table"><thead><tr><th>شماره</th><th>محصول</th><th>مبلغ</th><th>وضعیت</th><th>زمان</th><th>اقدام</th></tr></thead><tbody>'+list.map(o=>'<tr><td>'+esc(o.order_number)+'</td><td>'+esc(o.product_title)+'</td><td>'+money(o.total_amount)+'</td><td>'+statusLabel(o.status)+' / '+statusLabel(o.payment_status)+'</td><td>'+date(o.created_at)+'</td><td><button class="ac-btn" data-order="'+o.id+'">تغییر وضعیت</button></td></tr>').join('')+'</tbody></table></div>';
  }
  async function loadDiscounts(){
    const {data,error}=await db.from('asrar_discount_codes').select('*').order('created_at',{ascending:false});
    if(error)throw error;
    $('#acDiscountList',layer).innerHTML=(data||[]).map(d=>'<div class="ac-row ac-card"><span><b>'+esc(d.code)+'</b><small class="ac-muted"> '+d.discount_value+(d.discount_type==='percent'?'٪':' تومان')+' · '+(d.is_active?'فعال':'غیرفعال')+'</small></span><button class="ac-btn" data-toggle-discount="'+d.id+'" data-active="'+d.is_active+'">تغییر وضعیت</button></div>').join('')||'<div class="ac-empty">کدی ثبت نشده است.</div>';
  }
  async function handleAdminAction(e){
    const b=e.target.closest('button');if(!b)return;
    try{
      const id=b.dataset;
      if(b.id==='acAddProduct'||id.editProduct){
        const old=state.products.find(x=>x.id===id.editProduct)||{};
        const title=prompt('نام محصول',old.title||'');if(!title)return;
        const description=prompt('توضیحات',old.description||'')||'';
        const price=Number(prompt('قیمت به تومان',old.price||0));if(!Number.isFinite(price)||price<0)throw new Error('قیمت معتبر نیست');
        const saleRaw=prompt('قیمت با تخفیف (در صورت نبود خالی بگذارید)',old.sale_price||'');
        const stock=Number(prompt('موجودی',old.stock??0));if(!Number.isInteger(stock)||stock<0)throw new Error('موجودی معتبر نیست');
        const image_url=prompt('نشانی تصویر (اختیاری)',old.image_url||'')||'';
        const payload={title,description,price,sale_price:saleRaw?Number(saleRaw):null,stock,image_url,updated_at:new Date().toISOString()};
        const q=old.id?db.from('asrar_products').update(payload).eq('id',old.id):db.from('asrar_products').insert(payload);
        const {error}=await q;if(error)throw error;return renderAdmin();
      }
      if(id.toggleProduct){const p=state.products.find(x=>x.id===id.toggleProduct);const {error}=await db.from('asrar_products').update({is_active:!p.is_active}).eq('id',p.id);if(error)throw error;return renderAdmin()}
      if(id.deleteProduct){if(!confirm('محصول حذف شود؟'))return;const {error}=await db.from('asrar_products').delete().eq('id',id.deleteProduct);if(error)throw error;return renderAdmin()}
      if(b.id==='acAddPlan'||id.editPlan){
        const old=state.plans.find(x=>x.id===id.editPlan)||{};
        const title=prompt('عنوان طرح',old.title||'');if(!title)return;
        const description=prompt('توضیحات',old.description||'')||'';
        const price=Number(prompt('قیمت به تومان',old.price||0));
        const duration_days=Number(prompt('مدت اعتبار به روز',old.duration_days||30));
        if(!Number.isFinite(price)||price<0||!Number.isInteger(duration_days)||duration_days<1)throw new Error('قیمت یا مدت معتبر نیست');
        const payload={title,description,price,duration_days,updated_at:new Date().toISOString()};
        const q=old.id?db.from('asrar_subscription_plans').update(payload).eq('id',old.id):db.from('asrar_subscription_plans').insert(payload);
        const {error}=await q;if(error)throw error;return renderAdmin();
      }
      if(id.togglePlan){const p=state.plans.find(x=>x.id===id.togglePlan);const {error}=await db.from('asrar_subscription_plans').update({is_active:!p.is_active}).eq('id',p.id);if(error)throw error;return renderAdmin()}
      if(id.order){
        const status=prompt('وضعیت سفارش: new / reviewing / approved / rejected / completed / cancelled','reviewing');if(!status)return;
        const payment_status=prompt('وضعیت پرداخت: unpaid / pending / paid / refunded / rejected','pending');if(!payment_status)return;
        const admin_note=prompt('یادداشت مدیریت','')||'';
        const {error}=await db.from('asrar_orders').update({status,payment_status,admin_note,updated_at:new Date().toISOString()}).eq('id',id.order);if(error)throw error;return renderAdmin();
      }
      if(id.approveRequest||id.rejectRequest){
        const request=state.requests.find(x=>x.id===(id.approveRequest||id.rejectRequest));
        const status=id.approveRequest?'approved':'rejected';
        const {error}=await db.from('asrar_subscription_requests').update({status,admin_note:prompt('یادداشت مدیریت','')||'',updated_at:new Date().toISOString()}).eq('id',request.id);if(error)throw error;
        if(status==='approved'){
          const plan=state.plans.find(x=>x.id===request.plan_id);
          if(!plan)throw new Error('طرح اشتراک مرتبط پیدا نشد');
          const {error:subErr}=await db.from('asrar_user_subscriptions').insert({user_id:request.user_id,request_id:request.id,plan_title:plan.title,starts_at:new Date().toISOString(),expires_at:new Date(Date.now()+plan.duration_days*86400000).toISOString(),status:'active'});
          if(subErr)throw subErr;
        }
        return renderAdmin();
      }
      if(id.replyThread){
        const body=prompt('متن پاسخ مدیریت');if(!body?.trim())return;
        const {error}=await db.from('asrar_support_messages').insert({thread_id:id.replyThread,sender_id:state.user.id,is_admin:true,body:body.trim()});if(error)throw error;return renderAdmin();
      }
      if(id.closeThread){const {error}=await db.from('asrar_support_threads').update({status:'closed',updated_at:new Date().toISOString()}).eq('id',id.closeThread);if(error)throw error;return renderAdmin()}
      if(b.id==='acSavePayment'){
        const payload={id:true,payment_title:$('#payTitle',layer).value,account_holder:$('#payHolder',layer).value,card_number:$('#payCard',layer).value,iban:$('#payIban',layer).value,support_phone:$('#payPhone',layer).value,instructions:$('#payInstructions',layer).value,updated_at:new Date().toISOString()};
        const {error}=await db.from('asrar_payment_settings').upsert(payload);if(error)throw error;alert('تنظیمات پرداخت ذخیره شد');return renderAdmin();
      }
      if(b.id==='acAddDiscount'){
        const code=prompt('کد تخفیف');if(!code)return;
        const discount_type=prompt('نوع: percent یا fixed','percent');const discount_value=Number(prompt('مقدار تخفیف','10'));
        if(!['percent','fixed'].includes(discount_type)||!Number.isFinite(discount_value)||discount_value<=0)throw new Error('نوع یا مقدار تخفیف معتبر نیست');
        const {error}=await db.from('asrar_discount_codes').insert({code:code.trim().toUpperCase(),discount_type,discount_value});if(error)throw error;return loadDiscounts();
      }
      if(id.toggleDiscount){const {error}=await db.from('asrar_discount_codes').update({is_active:id.active!=='true'}).eq('id',id.toggleDiscount);if(error)throw error;return loadDiscounts()}
      if(b.id==='acSaveModals'){
        const ms=state.modalData.modals||[];
        ms.forEach((m,i)=>{m.t=$('#mt'+i,layer).value;m.s=$('#ms'+i,layer).value;m.b=$('#mb'+i,layer).value});
        const {error}=await db.from(cfg.contentTable||'site_content').upsert({key:cfg.contentKey||'main',content:state.modalData,updated_at:new Date().toISOString()});if(error)throw error;alert('راهنمای مودال‌ها ذخیره شد');return;
      }
    }catch(err){showError(err)}
  }

  async function openShop(){
    const user=await requireUser();if(!user)return;
    openLayer('فروشگاه آنلاین اسرار ازل');
    const body=$('#acBody',layer);body.innerHTML='<div class="ac-muted">در حال دریافت محصولات…</div>';
    const [p,pay]=await Promise.all([db.from('asrar_products').select('*').eq('is_active',true).order('sort_order'),db.from('asrar_payment_settings').select('*').eq('id',true).maybeSingle()]);
    if(p.error)throw p.error;if(pay.error)throw pay.error;
    state.payment=pay.data;
    body.innerHTML='<div class="ac-row"><h3>محصولات</h3><button class="ac-btn" id="acMyOrders">سوابق سفارش من</button></div>'+((p.data||[]).map(x=>'<div class="ac-card">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="" style="width:100%;max-height:150px">':'')+'<div class="ac-row"><b>'+esc(x.title)+'</b><b>'+money(x.sale_price||x.price)+'</b></div><p class="ac-muted">'+esc(x.description)+'</p><div class="ac-actions"><button class="ac-btn primary" data-buy="'+x.id+'">ثبت سفارش</button></div></div>').join('')||'<div class="ac-empty">محصول فعالی برای فروش ثبت نشده است.</div>');
    body.onclick=async e=>{
      const b=e.target.closest('button');if(!b)return;
      try{
        if(b.id==='acMyOrders')return showMyOrders();
        if(b.dataset.buy){
          const product=p.data.find(x=>x.id===b.dataset.buy);if(!product)return;
          const customer_name=prompt('نام و نام خانوادگی');if(!customer_name)return;
          const customer_phone=prompt('شماره تماس');if(!customer_phone)return;
          const shipping_address=prompt('نشانی تحویل (در صورت نیاز)','')||'';
          const quantity=Number(prompt('تعداد','1'));if(!Number.isInteger(quantity)||quantity<1||quantity>50)throw new Error('تعداد معتبر نیست');
          const notes=prompt('توضیحات سفارش','')||'';
          const {data,error}=await db.from('asrar_orders').insert({user_id:state.user.id,product_id:product.id,quantity,customer_name,customer_phone,shipping_address,notes}).select().single();
          if(error)throw error;
          const payText=state.payment?.instructions||'پس از ثبت سفارش، مدیریت روش پرداخت را اعلام می‌کند.';
          body.innerHTML='<div class="ac-card"><h3>سفارش ثبت شد</h3><p>شماره سفارش: <b>'+esc(data.order_number)+'</b></p><p>مبلغ: <b>'+money(data.total_amount)+'</b></p><p class="ac-muted">'+esc(payText)+'</p><p class="ac-muted">وضعیت: '+statusLabel(data.status)+'</p><button class="ac-btn" id="acBackShop">بازگشت به فروشگاه</button></div>';
          body.onclick=ev=>{if(ev.target.closest('#acBackShop'))openShop().catch(showError)};
        }
      }catch(err){showError(err)}
    };
  }
  async function showMyOrders(){
    const {data,error}=await db.from('asrar_orders').select('*').eq('user_id',state.user.id).order('created_at',{ascending:false});
    if(error)throw error;
    $('#acBody',layer).innerHTML='<h3>سوابق سفارش من</h3>'+tableOrders(data||[])+'<button class="ac-btn" id="acBackShop">بازگشت به فروشگاه</button>';
    $('#acBody',layer).onclick=e=>{if(e.target.closest('#acBackShop'))openShop().catch(showError)};
  }
  async function openSubscriptions(){
    const user=await requireUser();if(!user)return;
    openLayer('اشتراک‌های اسرار ازل');
    const [p,r]=await Promise.all([db.from('asrar_subscription_plans').select('*').eq('is_active',true).order('sort_order'),db.from('asrar_subscription_requests').select('*').eq('user_id',user.id).order('created_at',{ascending:false})]);
    if(p.error)throw p.error;if(r.error)throw r.error;
    const body=$('#acBody',layer);
    body.innerHTML='<h3>طرح‌های اشتراک</h3>'+p.data.map(x=>'<div class="ac-card"><div class="ac-row"><b>'+esc(x.title)+'</b><b>'+money(x.price)+'</b></div><p class="ac-muted">'+esc(x.description)+' · '+x.duration_days+' روز</p><button class="ac-btn primary" data-plan="'+x.id+'">درخواست اشتراک</button></div>').join('')||'<div class="ac-empty">طرح فعالی وجود ندارد.</div>'+'<h3>درخواست‌های من</h3>';
    body.innerHTML+='<h3>درخواست‌های من</h3>'+(r.data||[]).map(x=>'<div class="ac-card">'+esc(x.plan_title)+' · '+money(x.amount)+' · '+statusLabel(x.status)+'<div class="ac-muted">'+date(x.created_at)+'</div></div>').join('');
    body.onclick=async e=>{
      const b=e.target.closest('[data-plan]');if(!b)return;
      try{
        const payment_reference=prompt('شناسه پیگیری پرداخت (در صورت پرداخت)','')||'';
        const {error}=await db.from('asrar_subscription_requests').insert({user_id:user.id,plan_id:b.dataset.plan,payment_reference});if(error)throw error;
        alert('درخواست اشتراک ثبت شد و پس از بررسی مدیریت نتیجه اعلام می‌شود.');openSubscriptions().catch(showError);
      }catch(err){showError(err)}
    };
  }
  async function openSupport(){
    const user=await requireUser();if(!user)return;
    openLayer('پیام به مدیریت');
    const body=$('#acBody',layer);
    const {data,error}=await db.from('asrar_support_threads').select('*,asrar_support_messages(*)').eq('user_id',user.id).order('last_message_at',{ascending:false});
    if(error)throw error;
    body.innerHTML='<button class="ac-btn primary" id="acNewThread">ایجاد گفت‌وگوی جدید +</button>'+(data||[]).map(t=>'<div class="ac-card"><div class="ac-row"><b>'+esc(t.subject)+'</b><span class="ac-muted">'+statusLabel(t.status)+'</span></div>'+(t.asrar_support_messages||[]).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).map(m=>'<p><b>'+(m.is_admin?'مدیریت':'شما')+':</b> '+esc(m.body)+' <span class="ac-muted">'+date(m.created_at)+'</span></p>').join('')+'<button class="ac-btn" data-send-thread="'+t.id+'">ارسال پیام</button></div>').join('')||'<div class="ac-empty">هنوز گفت‌وگویی ندارید.</div>';
    body.onclick=async e=>{
      const b=e.target.closest('button');if(!b)return;
      try{
        if(b.id==='acNewThread'){
          const subject=prompt('موضوع پیام','پیام به مدیریت')||'پیام به مدیریت';
          const bodyText=prompt('متن پیام');if(!bodyText?.trim())return;
          const {data:t,error}=await db.from('asrar_support_threads').insert({user_id:user.id,subject}).select().single();if(error)throw error;
          const {error:me}=await db.from('asrar_support_messages').insert({thread_id:t.id,sender_id:user.id,body:bodyText.trim(),is_admin:false});if(me)throw me;
          return openSupport();
        }
        if(b.dataset.sendThread){
          const bodyText=prompt('متن پیام جدید');if(!bodyText?.trim())return;
          const {error}=await db.from('asrar_support_messages').insert({thread_id:b.dataset.sendThread,sender_id:user.id,body:bodyText.trim(),is_admin:false});if(error)throw error;
          return openSupport();
        }
      }catch(err){showError(err)}
    };
  }

  function addLaunchers(){
    const quick=$('.quick');
    if(quick&&!$('#asrar-commerce-shortcuts')){
      const wrap=document.createElement('div');wrap.id='asrar-commerce-shortcuts';
      wrap.innerHTML='<button id="asrarShopLaunch">فروشگاه آنلاین</button><button id="asrarPlansLaunch">اشتراک‌ها</button><button id="asrarMessagesLaunch">پیام به مدیریت</button><button id="asrarOpsLaunch">مدیریت سامانه</button>';
      quick.insertAdjacentElement('afterend',wrap);
    }
    $('#asrarShopLaunch')?.addEventListener('click',()=>openShop().catch(showError));
    $('#asrarPlansLaunch')?.addEventListener('click',()=>openSubscriptions().catch(showError));
    $('#asrarMessagesLaunch')?.addEventListener('click',()=>openSupport().catch(showError));
    $('#asrarOpsLaunch')?.addEventListener('click',()=>renderAdmin().catch(showError));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addLaunchers,{once:true});else addLaunchers();
  window.ASRAR_COMMERCE = { openShop, openSubscriptions, openSupport, openAdmin:renderAdmin };
})();
