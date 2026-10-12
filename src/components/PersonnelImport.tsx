import React, { useRef, useState } from 'react';
import type { Employee, JobProfile } from '../types';
import { db } from '../utils/db';
import { readWorkbookRows, type ParsedWorkbook } from '../utils/excelWorkbook';
import { identifyPersonnelHeaders, parsePersonnelWorkbook, preparePersonnelImport, PERSONNEL_ALIASES, type PersonnelMapping } from '../utils/personnelImport';
import { canImport } from '../utils/authorization';

export default function PersonnelImport({ actor, profiles }: {actor:Employee;profiles:JobProfile[]}) {
  const [workbook,setWorkbook]=useState<ParsedWorkbook|null>(null), [mappings,setMappings]=useState<Record<string,PersonnelMapping>>({});
  const [plan,setPlan]=useState<ReturnType<typeof preparePersonnelImport>|null>(null), [counts,setCounts]=useState<ReturnType<typeof parsePersonnelWorkbook>['identityCounts']|null>(null);
  const [busy,setBusy]=useState(false), [message,setMessage]=useState(''), [reference,setReference]=useState(''), [date,setDate]=useState(''), [profile,setProfile]=useState(''), [approved,setApproved]=useState(false), [page,setPage]=useState(0);
  const operation=useRef(''), submitting=useRef(false), expected=useRef<string|null>(null);
  const allowed=canImport(actor,'employee').allowed;
  const sheets=workbook ? (['پرسنل چالاک','پرسنل چالاک 2'].every(n=>workbook.rowsBySheet[n])?['پرسنل چالاک','پرسنل چالاک 2']:workbook.sheets.slice(0,1)) : [];
  const labels:Record<string,string>={code:'کد پرسنلی',name:'نام کامل',firstName:'نام',lastName:'نام خانوادگی',unit:'واحد',approvedJobTitle:'عنوان مصوب',internalJobDescription:'شرح وظیفه',shift:'شیفت',employmentStart:'شروع همکاری',employmentEnd:'ترک کار'};
  const states:Record<string,string>={NEW:'جدید',EXISTING_UNCHANGED:'بدون تغییر',EXISTING_UPDATED:'ویرایش',DUPLICATE_IN_FILE:'تکراری',CONFLICT:'متناقض',INACTIVE:'غیرفعال',INVALID:'نامعتبر',NEEDS_REVIEW:'نیازمند بررسی'};
  if(!allowed) return null;
  const preview=()=>{ if(!workbook)return; try {const parsed=parsePersonnelWorkbook(workbook,mappings);expected.current=localStorage.getItem('pe_employees');setCounts(parsed.identityCounts);setPlan(preparePersonnelImport(parsed.inputs,db.getEmployees(),profiles,{approved,reference,effectiveDate:date,newProfileId:profile}));operation.current=crypto.randomUUID();setPage(0);setMessage('پیش‌نمایش آماده شد؛ هیچ داده عملیاتی روی سرور نوشته نشد.');}catch(e){setMessage((e as Error).message);}};
  const confirm=async()=>{if(!plan||!plan.updates.length||submitting.current)return;submitting.current=true;setBusy(true);try{
    const current=db.getEmployees(), changes=new Map(plan.updates.map(e=>[e.id,e]));const next=current.map(e=>changes.get(e.id)||e);for(const e of plan.updates)if(!current.some(x=>x.id===e.id))next.push(e);
    const accepted=await db.commitBulkState({pe_employees:next},operation.current,{pe_employees:expected.current},{importType:'EMPLOYEE',operationId:operation.current});
    if(!accepted){setMessage('ثبت تأیید نشد؛ پیش‌نمایش حفظ شد. در ۴۰۹ نسخه را بازبینی کنید؛ در ۵۰۳ یا قطع ارتباط، رسید عملیات پیش از ارسال دوباره بررسی می‌شود.');return;}
    setMessage(`ثبت سروری کامل شد: ${plan.counts.NEW} جدید، ${plan.counts.EXISTING_UPDATED} ویرایش، ${plan.counts.INACTIVE} غیرفعال، ${plan.counts.EXISTING_UNCHANGED} بدون تغییر؛ ${plan.rows.filter(r=>['INVALID','CONFLICT','NEEDS_REVIEW','DUPLICATE_IN_FILE'].includes(r.status)).length} ردشده/نیازمند بررسی.`);setPlan(null);
    db.saveMiscData('pe_personnel_header_mapping',mappings);
  }catch(e){setMessage((e as Error).message);}finally{submitting.current=false;setBusy(false);}};
  return <details className="border rounded-xl p-4 space-y-3" dir="rtl"><summary className="font-bold">ورود اطلاعات پرسنلی — بررسی و ثبت سروری</summary>
    <p>انتخاب فایل ← شناسایی ستون‌ها ← بررسی اطلاعات ← تأیید و ذخیره ← گزارش نتیجه. حضور در اکسل، تأیید فعال‌بودن یا تغییر سمت نیست. افراد غایب حذف نمی‌شوند.</p>
    <fieldset disabled={busy||!!plan}><input aria-label="فایل بانک پرسنل" type="file" accept=".xlsx,.xls,.xml,.csv" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;setBusy(true);setMessage('در حال خواندن فایل…');try{const w=await readWorkbookRows(f);setWorkbook(w);const selected=['پرسنل چالاک','پرسنل چالاک 2'].every(n=>w.rowsBySheet[n])?['پرسنل چالاک','پرسنل چالاک 2']:w.sheets.slice(0,1);const saved=db.getMiscData<Record<string,PersonnelMapping>>('pe_personnel_header_mapping',{});const m:Record<string,PersonnelMapping>={};for(const n of selected){try{m[n]=identifyPersonnelHeaders(w.rowsBySheet[n],saved[n]).mapping;}catch{m[n]={};}}setMappings(m);setMessage('فایل خوانده شد؛ نگاشت و وضعیت استخدامی را بررسی کنید.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}/>
      {sheets.map(n=>{let headers:string[]=[];try{headers=identifyPersonnelHeaders(workbook!.rowsBySheet[n]).headers;}catch{headers=workbook!.rowsBySheet[n][0].map(String);}return <details key={n}><summary>ستون‌های {n}</summary>{Object.keys(PERSONNEL_ALIASES).map(key=><label key={key} className="block">{labels[key]}<select aria-label={`${n}: ${labels[key]}`} value={mappings[n]?.[key]?.[0]??''} onChange={e=>setMappings({...mappings,[n]:{...mappings[n],[key]:e.target.value===''?[]:[Number(e.target.value)]}})}><option value="">نادیده/خالی</option>{headers.map((h,i)=><option key={i} value={i}>{i+1}: {h}</option>)}</select></label>)}</details>})}
      <input aria-label="تاریخ مؤثر پرسنل" placeholder="تاریخ مؤثر، 1405/07/20" value={date} onChange={e=>setDate(e.target.value)}/><input aria-label="مرجع تصویب پرسنل" placeholder="مرجع تأیید منبع و وضعیت استخدامی" value={reference} onChange={e=>setReference(e.target.value)}/>
      <select aria-label="پروفایل مصوب کارکنان جدید" value={profile} onChange={e=>setProfile(e.target.value)}><option value="">پروفایل جدیدها فقط پس از تأیید</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select>
      <label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>اعتبار منبع، تاریخ مؤثر و وضعیت استخدامی ردیف‌های مجاز را بررسی و تأیید کرده‌ام.</label><button type="button" disabled={!workbook} onClick={preview}>بررسی اطلاعات و پیش‌نمایش</button>
    </fieldset>
    {counts&&<p>اصلی {counts.main}؛ ثانویه {counts.secondary}؛ مشترک {counts.overlap}؛ فقط ثانویه {counts.secondaryOnly}؛ هویت یکتا {counts.distinct} — تعداد کارکنان فعال محسوب نمی‌شود.</p>}
    {plan&&<div aria-label="پیش‌نمایش بانک پرسنل"><p>{Object.entries(plan.counts).map(([k,v])=>`${states[k]}: ${v}`).join('؛ ')}</p><table><thead><tr><th>سطر/شیت</th><th>کد</th><th>وضعیت</th><th>مقدار قبلی ← جدید / علت</th></tr></thead><tbody>{plan.rows.slice(page*25,(page+1)*25).map((r,i)=><tr key={i}><td>{r.input.sheet} / {r.input.row}</td><td>{r.input.data.code}</td><td>{states[r.status]}</td><td>{r.changes.map(c=>`${labels[c.field]||c.field}: ${c.before||'خالی'} ← ${c.after}`).join('؛ ')} {r.issues.join('؛ ')}</td></tr>)}</tbody></table><button disabled={busy||page===0} onClick={()=>setPage(page-1)}>قبلی</button><button disabled={busy||(page+1)*25>=plan.rows.length} onClick={()=>setPage(page+1)}>بعدی</button><button type="button" disabled={busy||!plan.updates.length} onClick={()=>void confirm()}>{busy?'در حال ذخیره روی سرور…':'تأیید و ثبت تغییرات مجاز'}</button><button disabled={busy} onClick={()=>setPlan(null)}>بازبینی / انصراف</button></div>}
    <p role="status">{busy?'در حال پردازش؛ تأیید مجدد غیرفعال است.':message}</p>
  </details>;
}
