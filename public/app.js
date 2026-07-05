

/* ============================================================
   SUMS — Surgical Unit II Management System
   Vanilla JS · localStorage · fully offline
   ============================================================ */
"use strict";

/* ---------------- storage layer ---------------- */
const DB_KEY = "sums_db_v2";
const SESSION_KEY = "sums_session_v2";
const COLLECTIONS = ["users","patients","notes","surgeries","meds","mar","labs","io","drains","orders","tasks","chat","photos","timeline","notifications","audit","config"];

let DB = null;
function loadDB(){
  try{ DB = JSON.parse(localStorage.getItem(DB_KEY)) || null; }catch(e){ DB=null; }
  if(!DB){ DB = {}; COLLECTIONS.forEach(c=>DB[c]=[]); DB.config={ward:"Surgical Unit-II",hospital:"Allied Hospital, Faisalabad",capacity:68,inactivityMin:120,seeded:false}; }
  COLLECTIONS.forEach(c=>{ if(!DB[c]) DB[c]=[]; });
  if(!Array.isArray(DB.config)&&!DB.config.ward){ DB.config={ward:"Surgical Unit-II",hospital:"Allied Hospital, Faisalabad",capacity:68,inactivityMin:120,seeded:false}; }
}
function coll(name){ return DB[name]; }
function byId(name,id){ return coll(name).find(x=>x.id===id); }

/* ---------------- helpers ---------------- */
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function esc(s){ return (s==null?"":String(s)).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function now(){ return new Date().toISOString(); }
function pad2(n){ return String(n).padStart(2,"0"); }
function fmtDate(iso){ if(!iso)return"—"; const d=new Date(iso); return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }
function fmtTime(iso){ if(!iso)return"—"; const d=new Date(iso); return d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}); }
function fmtDT(iso){ if(!iso)return"—"; return fmtDate(iso)+" · "+fmtTime(iso); }
function fmtDateInput(iso){ const d=iso?new Date(iso):new Date(); return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
function daysBetween(a,b){ const d1=new Date(a); d1.setHours(0,0,0,0); const d2=new Date(b||now()); d2.setHours(0,0,0,0); return Math.round((d2-d1)/86400000); }
function timeAgo(iso){ const s=Math.floor((Date.now()-new Date(iso))/1000);
  if(s<60)return"just now"; if(s<3600)return Math.floor(s/60)+"m ago"; if(s<86400)return Math.floor(s/3600)+"h ago";
  const d=Math.floor(s/86400); if(d<7)return d+"d ago"; return fmtDate(iso); }
function initials(name){ return (name||"?").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase(); }

/* ---------------- password hashing (offline, SubtleCrypto w/ fallback) ---------------- */
async function hashPw(pw,salt){
  salt=salt||"sums_static_salt_v1";
  try{
    if(window.crypto&&window.crypto.subtle){
      const data=new TextEncoder().encode(salt+"|"+pw);
      const buf=await crypto.subtle.digest("SHA-256",data);
      return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
    }
  }catch(e){}
  // fallback simple hash (weak, only if SubtleCrypto unavailable)
  let h=5381; const str=salt+"|"+pw; for(let i=0;i<str.length;i++){ h=((h<<5)+h+str.charCodeAt(i))>>>0; }
  return "f"+h.toString(16);
}

/* ---------------- roles & permissions (RBAC) — per SUMS Ch.4 ---------------- */
const ROLE_ORDER=["admin","hod","consultant","assocprof","asstprof","sr","resident","mo","ho","nurse","deo","readonly"];
const ROLES={
  admin:{label:"System Administrator",fixed:true},
  hod:{label:"Head of Department"},
  consultant:{label:"Consultant"},
  assocprof:{label:"Associate Professor"},
  asstprof:{label:"Assistant Professor"},
  sr:{label:"Senior Registrar"},
  resident:{label:"Resident"},
  mo:{label:"Medical Officer"},
  ho:{label:"House Officer"},
  nurse:{label:"Nursing Staff"},
  deo:{label:"Data Entry Operator"},
  readonly:{label:"Read-Only User"}
};
// permission catalogue grouped per §4.4; some support a "view" cell-state
const PERMS=[
  {key:"viewPatients",label:"View Patients",group:"View"},
  {key:"addPatient",label:"Add Patients",group:"Create"},
  {key:"editPatient",label:"Edit Patients",group:"Edit"},
  {key:"deletePatient",label:"Delete Patients",group:"Delete"},
  {key:"note",label:"Clinical Notes",group:"Create"},
  {key:"surgery",label:"Record Surgery",group:"Create"},
  {key:"med",label:"Prescribe Medicines",group:"Create"},
  {key:"mar",label:"MAR Documentation",group:"Clinical",view:true},
  {key:"lab",label:"Order Investigations",group:"Create"},
  {key:"order",label:"Consultant Orders",group:"Create"},
  {key:"task",label:"Tasks",group:"Create"},
  {key:"io",label:"I/O Records",group:"Clinical"},
  {key:"drain",label:"Drain Records",group:"Clinical"},
  {key:"photo",label:"Clinical Photos",group:"Create"},
  {key:"chat",label:"Team Chat",group:"Clinical"},
  {key:"discharge",label:"Approve Discharge",group:"Approval"},
  {key:"otPlan",label:"OT Planning",group:"Approval",view:true},
  {key:"report",label:"Reports",group:"Create"},
  {key:"auditView",label:"Audit Logs",group:"Admin"},
  {key:"userMgmt",label:"User Management",group:"Admin"}
];
const PERM_LABEL=k=>(PERMS.find(p=>p.key===k)||{}).label||k;
// cell states: yes | limited (=granted) · view | optional | no (=not granted)
function buildDefaultMatrix(){
  const y="yes",n="no",v="view",o="optional",l="limited",M={};
  PERMS.forEach(p=>{(M.admin=M.admin||{})[p.key]=y;});           // Admin: unrestricted (fixed)
  const cons={viewPatients:y,addPatient:y,editPatient:y,deletePatient:y,note:y,surgery:y,med:y,mar:v,lab:y,
    order:y,task:y,io:y,drain:y,photo:y,chat:y,discharge:y,otPlan:y,report:y,auditView:n,userMgmt:n};
  M.consultant={...cons}; M.assocprof={...cons}; M.asstprof={...cons}; M.sr={...cons};
  M.hod={...cons,auditView:y};                                    // HOD: clinical audit view
  M.resident={...cons,auditView:n};
  M.mo={viewPatients:y,addPatient:y,editPatient:l,deletePatient:n,note:y,surgery:n,med:o,mar:v,lab:y,order:n,
    task:n,io:y,drain:n,photo:n,chat:y,discharge:n,otPlan:n,report:y,auditView:n,userMgmt:n};
  M.ho={viewPatients:y,addPatient:o,editPatient:n,deletePatient:n,note:y,surgery:n,med:n,mar:v,lab:o,order:n,
    task:n,io:y,drain:y,photo:n,chat:y,discharge:n,otPlan:n,report:y,auditView:n,userMgmt:n};
  M.nurse={viewPatients:y,addPatient:n,editPatient:n,deletePatient:n,note:n,surgery:n,med:n,mar:y,lab:n,order:n,
    task:n,io:y,drain:y,photo:n,chat:y,discharge:n,otPlan:v,report:y,auditView:n,userMgmt:n};
  M.deo={viewPatients:y,addPatient:y,editPatient:l,deletePatient:n,note:n,surgery:n,med:n,mar:n,lab:n,order:n,
    task:n,io:n,drain:n,photo:y,chat:n,discharge:n,otPlan:n,report:y,auditView:n,userMgmt:n};
  M.readonly={viewPatients:y,addPatient:n,editPatient:n,deletePatient:n,note:n,surgery:n,med:n,mar:v,lab:n,order:n,
    task:n,io:n,drain:n,photo:n,chat:n,discharge:n,otPlan:v,report:y,auditView:n,userMgmt:n};
  return M;
}
function getMatrix(){ if(!DB.config.matrix)DB.config.matrix=buildDefaultMatrix(); return DB.config.matrix; }
function matrixVal(role,perm){ if(perm==="view")perm="viewPatients"; if(role==="admin")return "yes";
  const m=getMatrix(); return (m[role]&&m[role][perm])||"no"; }
function stateGranted(s){ return s==="yes"||s==="limited"; }
// central access decision — evaluated before every gated operation (§4.2)
function can(perm){
  const u=currentUser(); if(!u)return false;
  if(u.role==="admin")return true;                                // admin cannot be restricted (§4.3.1)
  if(perm==="view")perm="viewPatients";
  if(u.permOverrides&&Object.prototype.hasOwnProperty.call(u.permOverrides,perm)) return !!u.permOverrides[perm];
  return stateGranted(matrixVal(u.role,perm));
}
// completion of orders/tasks: allowed for creators OR the role the item is assigned to
function canComplete(perm,item){ if(can(perm))return true; const u=currentUser();
  return !!(u&&item&&item.assignedTo&&item.assignedTo===u.role); }
const PRIVILEGED_ROLES=["admin","hod","consultant","assocprof","asstprof","sr"];

/* ---------------- session (§4.10) ---------------- */
let SESSION=null;
/* session handled by net layer */

/* ---------------- audit / timeline / notifications (§4.13) ---------------- */
function shortDevice(){ try{ const ua=navigator.userAgent||""; 
  const os=/Windows/.test(ua)?"Windows":/Mac/.test(ua)?"macOS":/Android/.test(ua)?"Android":/iPhone|iPad/.test(ua)?"iOS":/Linux/.test(ua)?"Linux":"Unknown";
  const br=/Edg/.test(ua)?"Edge":/Chrome/.test(ua)?"Chrome":/Firefox/.test(ua)?"Firefox":/Safari/.test(ua)?"Safari":"Browser";
  return br+" · "+os; }catch(e){ return "Unknown"; } }
// immutable audit record: user id/name, action, timestamp, device, IP (local for offline), actor
/* audit handled by net layer */
function addTimeline(patientId,type,title,desc,color){ const u=currentUser();
  insert("timeline",{id:uid(),patientId,at:now(),type,title,desc:desc||"",color:color||"teal",by:u?u.name:"system"}); }
function notify(text,patientId,kind){ const u=currentUser();
  insert("notifications",{id:uid(),at:now(),text,patientId:patientId||null,kind:kind||"info",read:false,by:u?u.name:""}); }
function unreadCount(){ return coll("notifications").filter(n=>!n.read).length; }

/* ---------------- seeding ---------------- */
async function seedIfNeeded(){
  if(DB.config.seeded)return;
  const salt="sums_static_salt_v1";
  DB.config.matrix=buildDefaultMatrix();
  const mk=async(name,username,role,pw,desig,emp)=>({id:uid(),name,username,role,pw:await hashPw(pw,salt),desig:desig||ROLES[role].label,emp:emp||"",
    status:"active",contact:"",email:"",permOverrides:{},created:now(),createdBy:"system",mustChange:false,lastLogin:null,failed:0,sessionEpoch:0});
  const users=await Promise.all([
    mk("Dr. Sana Iqbal","admin","admin","admin123","System Administrator","EMP-001"),
    mk("Prof. Kamran Sheikh","hod","hod","demo123","Head of Department","EMP-002"),
    mk("Prof. Nadia Rehman","consultant","consultant","demo123","Consultant Surgeon","EMP-003"),
    mk("Dr. Faisal Qureshi","assocprof","assocprof","demo123","Associate Professor","EMP-007"),
    mk("Dr. Asad Munawar","registrar","sr","demo123","Senior Registrar","EMP-014"),
    mk("Dr. Hira Yousaf","resident","resident","demo123","Resident","EMP-031"),
    mk("Dr. Bilal Ahmed","mo","mo","demo123","Medical Officer","EMP-045"),
    mk("Dr. Omar Sethi","houseofficer","ho","demo123","House Officer","EMP-052"),
    mk("Sr. Ayesha Khan","nurse","nurse","demo123","Staff Nurse","EMP-060"),
    mk("Mr. Tariq Javed","dataentry","deo","demo123","Data Entry Operator","EMP-071"),
    mk("Dr. Sadia Noor","readonly","readonly","demo123","Read-Only User","EMP-080"),
  ]);
  DB.users=users;
  // sample patients
  const consultants=["Prof. Kamran Sheikh","Prof. Nadia Rehman","Dr. Faisal Qureshi"];
  const T=Date.now();
  const day=(n)=>new Date(T-n*86400000).toISOString();
  const seedPts=[
    {name:"Muhammad Rafiq",mrn:"SU2-24-1187",age:54,gender:"Male",bed:"12",dx:"Acute appendicitis — post appendicectomy",status:"Post-operative",priority:"green",admit:day(3),cons:consultants[0],blood:"B+",flags:["Allergy"]},
    {name:"Fatima Bibi",mrn:"SU2-24-1192",age:38,gender:"Female",bed:"07",dx:"Perforated peptic ulcer — septic",status:"Critical",priority:"red",admit:day(1),cons:consultants[1],blood:"O+",flags:["Blood Required","Infection Control"]},
    {name:"Ahmed Nawaz",mrn:"SU2-24-1201",age:46,gender:"Male",bed:"21",dx:"Right inguinal hernia — for elective repair",status:"Pre-operative",priority:"yellow",admit:day(2),cons:consultants[0],blood:"A+",flags:[]},
    {name:"Zainab Malik",mrn:"SU2-24-1205",age:29,gender:"Female",bed:"04",dx:"Acute cholecystitis",status:"Urgent",priority:"yellow",admit:day(0),cons:consultants[2],blood:"AB+",flags:["Allergy"]},
    {name:"Ghulam Hussain",mrn:"SU2-24-1160",age:63,gender:"Male",bed:"33",dx:"CA sigmoid colon — post anterior resection",status:"Post-operative",priority:"green",admit:day(6),cons:consultants[1],blood:"O-",flags:["Medico-Legal Case"]},
  ];
  const admin=users[0], cons=users[2];
  seedPts.forEach(p=>{
    const pt=insert("patients",{id:uid(),mrn:p.mrn,name:p.name,age:p.age,gender:p.gender,bed:p.bed,
      dx:p.dx,dx2:"",bloodGroup:p.blood,cnic:"",mobile:"03xx-xxxxxxx",address:"",attendant:"",attendantRel:"",attendantMobile:"",
      admitSource:"Emergency Department",consultant:p.cons,team:"Team A",status:p.status,priority:p.priority,flags:p.flags,
      admittedAt:p.admit,createdAt:p.admit,createdBy:admin.name,archived:false,outcome:null});
    addTimeline(pt.id,"admission","Patient admitted","Admitted to bed "+p.bed+" under "+p.cons,"blue");
  });
  const pFatima=coll("patients").find(x=>x.name==="Fatima Bibi");
  const pRafiq=coll("patients").find(x=>x.name==="Muhammad Rafiq");
  const pGhulam=coll("patients").find(x=>x.name==="Ghulam Hussain");
  // surgeries
  insert("surgeries",{id:uid(),patientId:pRafiq.id,procedure:"Emergency Appendicectomy",type:"Emergency",surgeon:cons.name,assistant:"Dr. Hira Yousaf",anaesthetist:"Dr. Rana",otRoom:"OT-2",priority:"Emergency",indication:"Acute appendicitis",date:day(3),status:"Completed",findings:"Inflamed appendix, no perforation.",createdBy:cons.name,createdAt:day(3)});
  insert("surgeries",{id:uid(),patientId:pGhulam.id,procedure:"Anterior Resection",type:"Elective",surgeon:consultants[1],assistant:"Dr. Hira Yousaf",anaesthetist:"Dr. Rana",otRoom:"OT-1",priority:"Elective",indication:"CA sigmoid colon",date:day(6),status:"Completed",findings:"Tumour resected, primary anastomosis.",createdBy:cons.name,createdAt:day(6)});
  insert("surgeries",{id:uid(),patientId:coll("patients").find(x=>x.name==="Ahmed Nawaz").id,procedure:"Open Inguinal Hernia Repair (Lichtenstein)",type:"Elective",surgeon:cons.name,assistant:"",anaesthetist:"Dr. Rana",otRoom:"OT-2",priority:"Elective",indication:"Right inguinal hernia",date:new Date(T+86400000).toISOString(),status:"Scheduled",findings:"",createdBy:cons.name,createdAt:day(1)});
  // meds
  insert("meds",{id:uid(),patientId:pFatima.id,name:"Meropenem",dose:"1",unit:"g",route:"IV",freq:"Every 8 Hours",timing:"08:00, 16:00, 00:00",indication:"Sepsis",duration:"Until Review",highRisk:false,antibiotic:true,status:"Active",prescriber:cons.name,startAt:day(1),createdAt:day(1)});
  insert("meds",{id:uid(),patientId:pFatima.id,name:"Noradrenaline",dose:"0.1",unit:"mcg/kg/min",route:"IV",freq:"Continuous",timing:"Infusion",indication:"Septic shock",duration:"Until Stopped",highRisk:true,antibiotic:false,status:"Active",prescriber:cons.name,startAt:day(1),createdAt:day(1)});
  insert("meds",{id:uid(),patientId:pRafiq.id,name:"Co-amoxiclav",dose:"1.2",unit:"g",route:"IV",freq:"Three Times Daily",timing:"08:00, 14:00, 20:00",indication:"Surgical prophylaxis",duration:"3 Days",highRisk:false,antibiotic:true,status:"Active",prescriber:cons.name,startAt:day(3),createdAt:day(3)});
  insert("meds",{id:uid(),patientId:pRafiq.id,name:"Paracetamol",dose:"1",unit:"g",route:"IV",freq:"Every 6 Hours",timing:"PRN",indication:"Pain management",duration:"Until Review",highRisk:false,antibiotic:false,status:"Active",prescriber:cons.name,startAt:day(3),createdAt:day(3)});
  // labs
  insert("labs",{id:uid(),patientId:pFatima.id,test:"Complete Blood Count",category:"Laboratory",urgency:"Urgent",status:"Resulted",result:"WBC 21.4, Hb 9.8, Plt 132",orderedBy:cons.name,orderedAt:day(1),resultedAt:day(0)});
  insert("labs",{id:uid(),patientId:pFatima.id,test:"Serum Lactate",category:"Laboratory",urgency:"Urgent",status:"Pending",result:"",orderedBy:cons.name,orderedAt:now(),resultedAt:null});
  insert("labs",{id:uid(),patientId:pRafiq.id,test:"Erect Chest X-ray",category:"Imaging",urgency:"Routine",status:"Pending",result:"",orderedBy:cons.name,orderedAt:day(1),resultedAt:null});
  // io
  insert("io",{id:uid(),patientId:pFatima.id,kind:"input",label:"IV Ringer's Lactate",volume:1500,at:day(0)});
  insert("io",{id:uid(),patientId:pFatima.id,kind:"output",label:"Urine",volume:640,at:day(0)});
  insert("io",{id:uid(),patientId:pFatima.id,kind:"output",label:"NG aspirate",volume:300,at:day(0)});
  // drains
  insert("drains",{id:uid(),patientId:pGhulam.id,name:"Pelvic drain",site:"Left iliac fossa",insertedAt:day(6),removedAt:null,outputs:[{at:day(1),volume:70,character:"Serous"},{at:day(0),volume:40,character:"Serous"}]});
  // orders
  insert("orders",{id:uid(),patientId:pFatima.id,text:"Hourly urine output monitoring; inform if <30 mL/hr",assignedTo:"nurse",priority:"Urgent",status:"Pending",createdBy:cons.name,createdAt:day(0),dueAt:null});
  insert("orders",{id:uid(),patientId:pRafiq.id,text:"Remove IV cannula, switch antibiotics to oral if tolerating",assignedTo:"resident",priority:"Routine",status:"Pending",createdBy:cons.name,createdAt:day(0),dueAt:null});
  // tasks
  insert("tasks",{id:uid(),patientId:pRafiq.id,title:"Chase X-ray report",assignedTo:"ho",priority:"Routine",status:"Pending",createdBy:cons.name,createdAt:day(0),dueAt:new Date(T+86400000).toISOString()});
  insert("tasks",{id:uid(),patientId:pFatima.id,title:"Book HDU bed",assignedTo:"resident",priority:"Urgent",status:"Pending",createdBy:cons.name,createdAt:day(0),dueAt:null});
  // notes
  insert("notes",{id:uid(),patientId:pFatima.id,type:"Progress Note",body:"POD 0. Patient drowsy, hypotensive. On noradrenaline. Lactate trending. Continue resuscitation, hourly monitoring.",by:cons.name,at:day(0)});
  insert("notes",{id:uid(),patientId:pRafiq.id,type:"Progress Note",body:"POD 3. Comfortable, afebrile. Tolerating orals. Wound clean. Plan discharge tomorrow if stable.",by:cons.name,at:day(0)});
  DB.config.seeded=true; saveDB();
}

/* ---------------- patient computed helpers ---------------- */
function activePatients(){ return coll("patients").filter(p=>!p.archived); }
function latestSurgery(pid){ const s=coll("surgeries").filter(x=>x.patientId===pid&&x.status==="Completed").sort((a,b)=>new Date(b.date)-new Date(a.date)); return s[0]; }
function PAD(p){ return daysBetween(p.admittedAt,now()); }
function POD(p){ const s=latestSurgery(p.id); return s?daysBetween(s.date,now()):null; }
function padPod(p){ let out="PAD "+PAD(p); const pod=POD(p); if(pod!==null)out+=" · POD "+pod; return out; }
function occupiedBeds(){ return new Set(activePatients().map(p=>p.bed)); }
function priorityRank(p){ return {red:0,yellow:1,green:2}[p.priority]??3; }
function statusBadgeClass(st){ return {Critical:"red",Urgent:"amber","Pre-operative":"blue","Post-operative":"purple",Stable:"green","Ready for Discharge":"teal",Discharged:"gray"}[st]||"gray"; }

/* ---------------- routing ---------------- */
let ROUTE={name:"dashboard",params:{}};
function route(name,params){ ROUTE={name,params:params||{}}; SEARCH_OPEN=false; render(); window.scrollTo(0,0);
  const c=document.querySelector(".content"); if(c)c.scrollTop=0; }

/* ---------------- global search state ---------------- */
let SEARCH_OPEN=false, SEARCH_Q="";
function runSearch(q){ q=(q||"").trim().toLowerCase(); if(!q)return[];
  const res=[];
  activePatients().forEach(p=>{
    const hay=[p.name,p.mrn,p.bed,p.dx,p.consultant,p.cnic].join(" ").toLowerCase();
    if(hay.includes(q))res.push({type:"Patient",id:p.id,title:p.name,sub:"Bed "+p.bed+" · "+p.mrn});
  });
  return res.slice(0,10);
}


/* ---------------- icons (inline SVG) ---------------- */
const IC=(p,vb)=>`<svg viewBox="${vb||"0 0 24 24"}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONS={
  dash:IC('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'),
  patients:IC('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  bed:IC('<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v-2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2"/>'),
  ot:IC('<path d="M12 2v4"/><path d="M8 6h8l-1 5H9L8 6z"/><path d="M9 11v4a3 3 0 0 0 6 0v-4"/><path d="M12 18v3"/><circle cx="12" cy="21" r="1"/>'),
  task:IC('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  report:IC('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>'),
  bell:IC('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  audit:IC('<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12l2 2 4-4"/>'),
  admin:IC('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  search:IC('<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>'),
  plus:IC('<path d="M12 5v14M5 12h14"/>'),
  pill:IC('<path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/>'),
  flask:IC('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7 15h10"/>'),
  drop:IC('<path d="M12 2s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>'),
  note:IC('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>'),
  clock:IC('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  chat:IC('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  camera:IC('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  discharge:IC('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  order:IC('<path d="M9 11H5a2 2 0 0 0-2 2v7h6z"/><path d="M9 11V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v16"/><path d="M15 11h4a2 2 0 0 1 2 2v7h-6z"/>'),
  alert:IC('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>'),
  logout:IC('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  x:IC('<path d="M18 6 6 18M6 6l12 12"/>'),
  menu:IC('<path d="M3 12h18M3 6h18M3 18h18"/>'),
  check:IC('<path d="M20 6 9 17l-5-5"/>'),
  edit:IC('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>'),
  trash:IC('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'),
  user:IC('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>'),
  activity:IC('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  timeline:IC('<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><path d="M5 8v8"/><path d="M11 6h10M11 18h10"/>'),
  scalpel:IC('<path d="M14 4 4 14l3 3L20 4z"/><path d="M7 17l-3 3"/>'),
};

/* ---------------- render engine ---------------- */
function render(){
  const app=document.getElementById("app");
  if(!SESSION){ app.innerHTML=renderLogin(); bindLogin(); return; }
  if(ROUTE.name==="login"){ route("dashboard"); return; }
  app.innerHTML=`<div class="layout">
    ${renderSidebar()}
    <div class="main">${renderTopbar()}<div class="content">${renderPage()}</div></div>
  </div>`;
  bindShell();
  bindPage();
}

/* ---------------- login ---------------- */
function renderLogin(){
  return `<div class="login-wrap"><div class="login-card">
    <div class="login-hd"><div class="lg">S2</div>
      <h1>Surgical Unit II</h1><p>Management System · Allied Hospital, Faisalabad</p></div>
    <div class="login-bd">
      <div id="loginErr" class="badge red hidden" style="width:100%;justify-content:center;margin-bottom:12px;padding:8px"></div>
      <label class="fld"><span>Username</span><input class="inp" id="lu" autocomplete="username" placeholder="e.g. registrar"></label>
      <label class="fld"><span>Password</span><input class="inp" id="lp" type="password" autocomplete="current-password" placeholder="••••••••"></label>
      <button class="btn primary" id="loginBtn" style="width:100%;justify-content:center;margin-top:4px">Sign in</button>
      <div class="login-hint"><b>Demo accounts</b> (offline) — one per role:<br>
        <code>admin</code>/<code>admin123</code><br>
        <code>hod</code>, <code>consultant</code>, <code>assocprof</code>, <code>registrar</code>, <code>resident</code>, <code>mo</code>, <code>houseofficer</code>, <code>nurse</code>, <code>dataentry</code>, <code>readonly</code> / <code>demo123</code></div>
    </div></div></div>`;
}
function bindLogin(){
  const doLogin=async()=>{
    const u=document.getElementById("lu").value.trim().toLowerCase();
    const p=document.getElementById("lp").value;
    const err=document.getElementById("loginErr");
    const user=coll("users").find(x=>x.username===u);
    const show=(m)=>{err.textContent=m;err.classList.remove("hidden");};
    if(!user){ show("No account with that username."); return; }
    if(user.status==="locked"){ show("This account is locked. Contact an administrator."); return; }
    if(user.status!=="active"){ show("This account is "+user.status+". Contact an administrator."); return; }
    const h=await hashPw(p);
    if(h!==user.pw){
      user.failed=(user.failed||0)+1;
      insert("audit",{id:uid(),at:now(),uid:user.id,uname:user.name,role:user.role,action:"Failed login",
        detail:"Attempt "+user.failed,device:shortDevice(),ip:"local"});
      // §4.11 — alert admin on repeated failed attempts against privileged accounts
      if(PRIVILEGED_ROLES.includes(user.role)&&user.failed>=3)
        notify("Security: "+user.failed+" failed login attempts on privileged account “"+user.username+"”",null,"critical");
      // auto-lock after 5 failed attempts
      if(user.failed>=5){ user.status="locked"; saveDB(); show("Account locked after repeated failed attempts.");
        insert("audit",{id:uid(),at:now(),uid:user.id,uname:user.name,role:user.role,action:"Account lock",detail:"Auto-locked (failed logins)",device:shortDevice(),ip:"local"}); return; }
      saveDB(); show("Incorrect password."+(user.failed>=3?" ("+(5-user.failed)+" attempts left)":"")); return;
    }
    user.failed=0; user.lastLogin=now(); saveDB();
    login(user.id); audit("Login","Signed in");
    if(user.mustChange){ route("dashboard"); openChangePw(true); } else route("dashboard");
  };
  document.getElementById("loginBtn").onclick=doLogin;
  document.getElementById("lp").addEventListener("keydown",e=>{if(e.key==="Enter")doLogin();});
  document.getElementById("lu").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("lp").focus();});
}

/* ---------------- sidebar ---------------- */
const NAV=[
  {sec:"Clinical"},
  {id:"dashboard",label:"Dashboard",icon:"dash"},
  {id:"patients",label:"Patients",icon:"patients"},
  {id:"beds",label:"Bed Board",icon:"bed"},
  {id:"ot",label:"OT Board",icon:"ot"},
  {id:"tasks",label:"My Work Queue",icon:"task"},
  {sec:"System"},
  {id:"reports",label:"Reports",icon:"report"},
  {id:"notifications",label:"Notifications",icon:"bell",badge:true},
  {id:"audit",label:"Audit Trail",icon:"audit",perm:"auditView"},
  {id:"admin",label:"Administration",icon:"admin",perm:"*"},
];
function renderSidebar(){
  const u=currentUser();
  let nav="";
  NAV.forEach(n=>{
    if(n.sec){ nav+=`<div class="sb-sec">${n.sec}</div>`; return; }
    if(n.perm==="*"&&u.role!=="admin")return;
    if(n.perm&&n.perm!=="*"&&!can(n.perm))return;
    const active=ROUTE.name===n.id||(n.id==="patients"&&ROUTE.name==="patient");
    const badge=n.badge&&unreadCount()>0?`<span class="nbadge">${unreadCount()}</span>`:"";
    nav+=`<div class="nav-i ${active?"active":""}" data-nav="${n.id}">${ICONS[n.icon]}<span>${n.label}</span>${badge}</div>`;
  });
  return `<aside class="sidebar" id="sidebar">
    <div class="sb-brand"><div class="sb-logo">S2</div><div><b>SUMS</b><small>Surgical Unit II</small></div></div>
    <nav class="sb-nav">${nav}</nav>
    <div class="sb-user" data-nav="profile" style="cursor:pointer">
      <div class="avatar">${initials(u.name)}</div>
      <div style="flex:1;min-width:0"><div class="nm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name)}</div><div class="rl">${esc(u.desig)}</div></div>
      <button class="icon-btn" id="logoutBtn" title="Sign out" style="color:#9fb6bd">${ICONS.logout}</button>
    </div></aside>`;
}

/* ---------------- topbar ---------------- */
function renderTopbar(){
  const cap=DB.config.capacity, occ=occupiedBeds().size, vac=cap-occ;
  return `<div class="topbar">
    <button class="icon-btn menu-btn" id="menuBtn">${ICONS.menu}</button>
    <div class="ward-strip">
      <div class="ws">${ICONS.bed}<b>${DB.config.ward}</b></div>
      <div class="ws">Capacity <b class="mono">${cap}</b></div>
      <div class="ws">Occupied <b class="mono">${occ}</b></div>
      <div class="ws">Vacant <b class="mono" style="color:${vac<=3?'var(--red)':'var(--green)'}">${vac}</b></div>
      <div class="ws">${ICONS.clock}<b class="mono" id="clock">${new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</b></div>
      <div class="ws" title="Users online now"><span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;box-shadow:0 0 0 3px var(--green-l)"></span><b id="presenceChip" class="mono">${(typeof ONLINE!=="undefined"?ONLINE.length:1)} online</b></div>
    </div>
    <div class="search-wrap">${ICONS.search}
      <input id="gsearch" placeholder="Search patients, MRN, bed, diagnosis…" value="${esc(SEARCH_Q)}" autocomplete="off">
      <div id="searchRes" class="search-res ${SEARCH_OPEN&&SEARCH_Q?"":"hidden"}"></div>
    </div>
    <button class="icon-btn" id="bellBtn" title="Notifications">${ICONS.bell}${unreadCount()?`<span class="cnt">${unreadCount()}</span>`:""}</button>
  </div>`;
}

/* ---------------- page dispatcher ---------------- */
function renderPage(){
  switch(ROUTE.name){
    case"dashboard":return renderDashboard();
    case"patients":return renderPatients();
    case"patient":return renderProfile(ROUTE.params.id);
    case"beds":return renderBeds();
    case"ot":return renderOT();
    case"tasks":return renderWorkQueue();
    case"reports":return renderReports();
    case"notifications":return renderNotifications();
    case"audit":return renderAudit();
    case"admin":return renderAdmin();
    case"profile":return renderUserProfile();
    default:return renderDashboard();
  }
}

/* ---------------- dashboard ---------------- */
function renderDashboard(){
  const pts=activePatients();
  const male=pts.filter(p=>p.gender==="Male").length, female=pts.filter(p=>p.gender==="Female").length;
  const today=fmtDateInput(now());
  const admitToday=pts.filter(p=>fmtDateInput(p.admittedAt)===today).length;
  const critical=pts.filter(p=>p.status==="Critical").length;
  const urgent=pts.filter(p=>p.status==="Urgent").length;
  const preop=pts.filter(p=>p.status==="Pre-operative").length;
  const postop=pts.filter(p=>p.status==="Post-operative").length;
  const readyDisch=pts.filter(p=>p.status==="Ready for Discharge").length;
  const cap=DB.config.capacity, occ=occupiedBeds().size;
  const pendLabs=coll("labs").filter(l=>l.status==="Pending").length;
  const pendOrders=coll("orders").filter(o=>o.status==="Pending").length;
  const pendTasks=coll("tasks").filter(t=>t.status==="Pending").length;
  const otToday=coll("surgeries").filter(s=>fmtDateInput(s.date)===today&&s.status!=="Cancelled").length;
  const u=currentUser();
  const stat=(lbl,val,sub,accent,ic,go)=>`<div class="stat accent-${accent}" data-go="${go||""}">
    <div class="ic">${ICONS[ic]}</div><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="sub">${sub||""}</div></div>`;

  // alerts (derived)
  const alerts=buildAlerts();
  // priority board
  const byPri=(pr)=>pts.filter(p=>p.priority===pr).sort((a,b)=>a.bed.localeCompare(b.bed,undefined,{numeric:true}));
  const red=byPri("red"),yellow=byPri("yellow"),green=byPri("green");
  const priCard=(p)=>`<div class="pt-card" data-pt="${p.id}"><div class="spine ${p.priority}"></div><div class="pc-b" style="padding:11px 13px 11px 15px">
    <div class="pc-top"><div><span class="pc-bed">Bed ${esc(p.bed)}</span></div><span class="badge ${statusBadgeClass(p.status)}">${esc(p.status)}</span></div>
    <div class="pc-name" style="font-size:14.5px;margin:6px 0 1px">${esc(p.name)}</div>
    <div class="pc-meta"><span>${p.age}${p.gender[0]}</span><span class="mono">${esc(p.mrn)}</span></div>
    <div class="pc-dx" style="margin-top:5px;font-size:12px">${esc(p.dx)}</div>
    <div class="pc-foot" style="margin-top:8px;padding-top:8px"><span class="day">${padPod(p)}</span><span class="muted" style="font-size:11.5px;margin-left:auto">${esc(p.consultant.replace("Prof. ","").replace("Dr. ",""))}</span></div>
  </div></div>`;

  const recent=coll("timeline").slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,8);
  const myQueue=[...coll("orders").filter(o=>o.status==="Pending"&&o.assignedTo===u.role),
                ...coll("tasks").filter(t=>t.status==="Pending"&&t.assignedTo===u.role)];

  return `<div class="page-head">
    <div><h1>Good ${greet()}, ${esc(u.name.replace("Dr. ","").replace("Prof. ","").split(" ")[0])}</h1>
      <div class="sub">${new Date().toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})} · ${esc(u.desig)}</div></div>
    <div class="pill-row no-print">
      ${can("addPatient")?`<button class="btn primary" data-act="admit">${ICONS.plus}Admit patient</button>`:""}
      ${can("report")?`<button class="btn" data-go="reports">${ICONS.report}Handover</button>`:""}
    </div></div>

  <div class="stat-grid">
    ${stat("Total Patients",pts.length,`${male} M · ${female} F`,"teal","patients","patients")}
    ${stat("Occupancy",occ+" / "+cap,`${cap-occ} beds vacant`,"blue","bed","beds")}
    ${stat("Critical",critical,critical?"Needs review":"None","red","alert","patients")}
    ${stat("Urgent",urgent,"","amber","activity","patients")}
    ${stat("Pre-op",preop,"","purple","scalpel","patients")}
    ${stat("Post-op",postop,"","green","check","patients")}
    ${stat("Admits Today",admitToday,"","teal","plus","patients")}
    ${stat("OT Cases Today",otToday,"","blue","ot","ot")}
    ${stat("Pending Labs",pendLabs,"","amber","flask")}
    ${stat("Pending Orders",pendOrders,"","amber","order")}
    ${stat("Pending Tasks",pendTasks,"","amber","task","tasks")}
    ${stat("Ready to Discharge",readyDisch,"","green","discharge","patients")}
  </div>

  <div class="dash-grid">
    <div class="stack">
      <div class="card"><div class="panel-h"><h3>Patient Priority Board</h3>
        <span class="pill-row"><span class="badge red">${red.length} red</span><span class="badge amber">${yellow.length} yellow</span><span class="badge green">${green.length} green</span></span></div>
        <div class="panel-b">
          ${red.length?`<div class="pt-grid">${red.map(priCard).join("")}</div>`:""}
          ${yellow.length?`<div class="divider"></div><div class="pt-grid">${yellow.map(priCard).join("")}</div>`:""}
          ${green.length?`<div class="divider"></div><div class="pt-grid">${green.map(priCard).join("")}</div>`:""}
          ${!pts.length?emptyState("patients","No patients admitted","Admit your first patient to get started."):""}
        </div></div>

      <div class="card"><div class="panel-h"><h3>Recent Clinical Activity</h3></div>
        <div class="panel-b">${recent.length?`<div class="tl">${recent.map(t=>`
          <div class="tl-item ${t.color}"><div class="tl-time">${timeAgo(t.at)} · ${esc(t.by)}</div>
          <div class="tl-title">${esc(t.title)}</div><div class="tl-desc">${esc(patientName(t.patientId))} — ${esc(t.desc)}</div></div>`).join("")}</div>`
          :`<div class="muted" style="padding:10px">No recent activity.</div>`}</div></div>
    </div>

    <div class="stack">
      <div class="card"><div class="panel-h"><h3>Smart Alerts</h3><span class="badge ${alerts.length?"red":"gray"}">${alerts.length}</span></div>
        <div>${alerts.length?alerts.map(a=>`<div class="alert-row" data-pt="${a.pid||""}">
          <div class="alert-ic a-${a.level}">${ICONS[a.icon]}</div>
          <div class="txt"><b>${esc(a.title)}</b><div class="meta">${esc(a.meta)}</div></div></div>`).join("")
          :`<div class="muted" style="padding:16px">No active alerts. Ward stable.</div>`}</div></div>

      <div class="card"><div class="panel-h"><h3>My Work Queue</h3><span class="badge ${myQueue.length?"amber":"gray"}">${myQueue.length}</span></div>
        <div class="panel-b" style="padding:8px">${myQueue.length?myQueue.slice(0,8).map(it=>`
          <div class="alert-row" data-pt="${it.patientId}" style="border-radius:8px">
            <div class="alert-ic a-amber">${ICONS[it.text?"order":"task"]}</div>
            <div class="txt"><b>${esc(it.text||it.title)}</b><div class="meta">${esc(patientName(it.patientId))} · ${esc(it.priority)}</div></div></div>`).join("")
          :`<div class="muted" style="padding:12px">Nothing assigned to you.</div>`}</div></div>

      <div class="card"><div class="panel-h"><h3>OT Summary — Today</h3><button class="btn xs" data-go="ot">Open board</button></div>
        <div class="panel-b"><div class="kv-list">
          <div class="r"><span class="k">Scheduled cases</span><span class="v">${coll("surgeries").filter(s=>fmtDateInput(s.date)===today&&s.status==="Scheduled").length}</span></div>
          <div class="r"><span class="k">Completed today</span><span class="v">${coll("surgeries").filter(s=>fmtDateInput(s.date)===today&&s.status==="Completed").length}</span></div>
          <div class="r"><span class="k">Emergency</span><span class="v">${coll("surgeries").filter(s=>fmtDateInput(s.date)===today&&s.type==="Emergency").length}</span></div>
          <div class="r"><span class="k">Elective</span><span class="v">${coll("surgeries").filter(s=>fmtDateInput(s.date)===today&&s.type==="Elective").length}</span></div>
        </div></div></div>
    </div>
  </div>`;
}
function greet(){ const h=new Date().getHours(); return h<12?"morning":h<17?"afternoon":"evening"; }
function patientName(pid){ const p=byId("patients",pid); return p?p.name:"—"; }
function emptyState(icon,title,sub,btn){ return `<div class="empty">${ICONS[icon]}<h3>${title}</h3><p>${sub||""}</p>${btn||""}</div>`; }

function buildAlerts(){
  const A=[]; const pts=activePatients();
  pts.filter(p=>p.status==="Critical").forEach(p=>A.push({level:"red",icon:"alert",title:"Critical: "+p.name,meta:"Bed "+p.bed+" · immediate review",pid:p.id}));
  pts.filter(p=>p.flags&&p.flags.includes("Blood Required")).forEach(p=>A.push({level:"red",icon:"drop",title:"Blood required: "+p.name,meta:"Bed "+p.bed,pid:p.id}));
  coll("orders").filter(o=>o.status==="Pending"&&o.priority==="Urgent").forEach(o=>{const p=byId("patients",o.patientId);if(p)A.push({level:"amber",icon:"order",title:"Urgent order pending",meta:p.name+" · "+o.text.slice(0,42),pid:p.id});});
  const pend=coll("labs").filter(l=>l.status==="Pending"&&l.urgency==="Urgent");
  pend.forEach(l=>{const p=byId("patients",l.patientId);if(p)A.push({level:"amber",icon:"flask",title:"Urgent lab pending: "+l.test,meta:p.name+" · Bed "+p.bed,pid:p.id});});
  pts.filter(p=>p.status==="Ready for Discharge").forEach(p=>A.push({level:"blue",icon:"discharge",title:"Ready for discharge",meta:p.name+" · Bed "+p.bed,pid:p.id}));
  return A.slice(0,12);
}


/* ---------------- patients list ---------------- */
let PT_VIEW="card", PT_FILTER={status:null,priority:null,gender:null}, PT_SORT="bed", PT_Q="", PT_SHOW="active", PT_DFROM="", PT_DTO="";
function ptMatchesQuery(p,q){
  if(!q)return true; q=q.toLowerCase();
  return [p.name,p.mrn,p.bed,p.dx,p.consultant,fmtDate(p.admittedAt),fmtDate(p.dischargedAt)].join(" ").toLowerCase().includes(q);
}
function ptInRange(dISO){
  if(!dISO)return !(PT_DFROM||PT_DTO);
  const d=new Date(fmtDateInput(dISO));
  if(PT_DFROM && d < new Date(PT_DFROM))return false;
  if(PT_DTO && d > new Date(PT_DTO))return false;
  return true;
}
function renderPatients(){
  const chip=(g,val,label,cls)=>`<button class="chip-filter ${PT_FILTER[g]===val?"on "+(cls||""):""}" data-filter="${g}" data-val="${val}">${label}</button>`;
  const showSeg=`<div class="seg" style="margin-left:8px">
      <button class="${PT_SHOW==="active"?"on":""}" data-show="active">Active</button>
      <button class="${PT_SHOW==="archived"?"on":""}" data-show="archived">Archived</button></div>`;
  const viewSeg=`<div class="seg">
      <button class="${PT_VIEW==="card"?"on":""}" data-view="card">Cards</button>
      <button class="${PT_VIEW==="table"?"on":""}" data-view="table">Table</button></div>`;
  const searchBox=`<input class="inp" id="ptSearch" placeholder="Search name, MRN, date…" value="${esc(PT_Q)}" style="width:auto;min-width:210px">`;

  if(PT_SHOW==="archived") return renderArchived(viewSeg,showSeg,searchBox);

  let pts=activePatients();
  if(PT_Q)pts=pts.filter(p=>ptMatchesQuery(p,PT_Q));
  if(PT_FILTER.status)pts=pts.filter(p=>p.status===PT_FILTER.status);
  if(PT_FILTER.priority)pts=pts.filter(p=>p.priority===PT_FILTER.priority);
  if(PT_FILTER.gender)pts=pts.filter(p=>p.gender===PT_FILTER.gender);
  pts.sort((a,b)=>{
    if(PT_SORT==="bed")return a.bed.localeCompare(b.bed,undefined,{numeric:true});
    if(PT_SORT==="name")return a.name.localeCompare(b.name);
    if(PT_SORT==="priority")return priorityRank(a)-priorityRank(b);
    if(PT_SORT==="pad")return PAD(b)-PAD(a);
    if(PT_SORT==="admit")return new Date(b.admittedAt)-new Date(a.admittedAt);
    return 0;
  });
  return `<div class="page-head"><div><h1>Patients</h1><div class="sub">${activePatients().length} admitted · ${pts.length} shown</div></div>
    ${can("addPatient")?`<button class="btn primary" data-act="admit">${ICONS.plus}Admit patient</button>`:""}</div>

  <div class="toolbar">
    ${viewSeg}
    ${showSeg}
    <div style="flex:1"></div>
    ${searchBox}
    <select class="inp" id="ptSort" style="width:auto;min-width:150px">
      <option value="bed"${PT_SORT==="bed"?" selected":""}>Sort: Bed</option>
      <option value="priority"${PT_SORT==="priority"?" selected":""}>Sort: Priority</option>
      <option value="name"${PT_SORT==="name"?" selected":""}>Sort: Name</option>
      <option value="pad"${PT_SORT==="pad"?" selected":""}>Sort: Longest stay</option>
      <option value="admit"${PT_SORT==="admit"?" selected":""}>Sort: Newest</option>
    </select>
  </div>
  <div class="toolbar">
    ${chip("priority","red","Red","red")}${chip("priority","yellow","Yellow","amber")}${chip("priority","green","Green","green")}
    <span style="width:1px;height:20px;background:var(--line);margin:0 2px"></span>
    ${chip("status","Critical","Critical")}${chip("status","Urgent","Urgent")}${chip("status","Pre-operative","Pre-op")}${chip("status","Post-operative","Post-op")}${chip("status","Ready for Discharge","Ready")}
    <span style="width:1px;height:20px;background:var(--line);margin:0 2px"></span>
    ${chip("gender","Male","Male")}${chip("gender","Female","Female")}
    ${(PT_FILTER.status||PT_FILTER.priority||PT_FILTER.gender||PT_Q)?`<button class="btn sm ghost" data-act="clearFilter">Clear</button>`:""}
  </div>

  ${pts.length?(PT_VIEW==="card"?ptCards(pts):ptTable(pts)):emptyState("patients","No patients match","Try adjusting filters.")}`;
}

/* Archived records — Discharged / LAMA / Deceased, newest first, with search + date filters
   (Additional Modifications §3). */
function renderArchived(viewSeg,showSeg,searchBox){
  let base=coll("patients").filter(p=>p.archived);
  if(PT_Q)base=base.filter(p=>ptMatchesQuery(p,PT_Q));
  base=base.filter(p=>ptInRange(p.dischargedAt));
  const groups=[
    {label:"Discharged Patients", list:base.filter(p=>p.outcome==="Discharged")},
    {label:"LAMA / DOR Patients", list:base.filter(p=>p.outcome==="LAMA"||p.outcome==="DOR")},
    {label:"Deceased Patients", list:base.filter(p=>p.outcome==="Died")}
  ];
  groups.forEach(g=>g.list.sort((a,b)=>new Date(b.dischargedAt)-new Date(a.dischargedAt)));
  const total=base.length;
  const section=g=>`<div style="margin-top:16px">
      <h2 style="font-size:14px;margin:0 0 8px;display:flex;align-items:center;gap:8px">${esc(g.label)} <span class="badge gray">${g.list.length}</span></h2>
      ${g.list.length?(PT_VIEW==="card"?ptCards(g.list):ptTable(g.list)):`<div class="muted" style="font-size:12.5px;padding:4px 2px">No records in this category.</div>`}</div>`;
  return `<div class="page-head"><div><h1>Patients</h1><div class="sub">${activePatients().length} active · ${total} archived shown</div></div>
    ${can("addPatient")?`<button class="btn primary" data-act="admit">${ICONS.plus}Admit patient</button>`:""}</div>

  <div class="toolbar">
    ${viewSeg}
    ${showSeg}
    <div style="flex:1"></div>
    ${searchBox}
  </div>
  <div class="toolbar">
    <span class="muted" style="font-size:12px">Filter by date:</span>
    <input class="inp" id="ptFrom" type="date" value="${esc(PT_DFROM)}" style="width:auto">
    <span class="muted" style="font-size:12px">to</span>
    <input class="inp" id="ptTo" type="date" value="${esc(PT_DTO)}" style="width:auto">
    ${(PT_Q||PT_DFROM||PT_DTO)?`<button class="btn sm ghost" data-act="clearFilter">Clear</button>`:""}
  </div>
  ${total?groups.map(section).join(""):emptyState("patients","No archived records","Discharged, LAMA and deceased patients will appear here.")}`;
}
function ptCards(pts){
  return `<div class="pt-grid">${pts.map(p=>`
    <div class="pt-card" data-pt="${p.id}"><div class="spine ${p.priority}"></div><div class="pc-b">
      <div class="pc-top"><span class="pc-bed">Bed ${esc(p.bed)}</span>
        <span class="badge ${statusBadgeClass(p.status)}">${esc(p.status)}</span></div>
      <div class="pc-name">${esc(p.name)}</div>
      <div class="pc-meta"><span>${p.age} / ${esc(p.gender)}</span><span class="mono">${esc(p.mrn)}</span>${p.bloodGroup?`<span class="badge red" style="padding:0 6px">${esc(p.bloodGroup)}</span>`:""}</div>
      <div class="pc-dx">${esc(p.dx)}</div>
      ${p.flags&&p.flags.length?`<div class="pill-row" style="margin-top:7px">${p.flags.map(f=>`<span class="flag-dot" style="background:var(--red-l);color:var(--red-d)">${esc(f)}</span>`).join("")}</div>`:""}
      <div class="pc-foot"><span class="day">${padPod(p)}</span>
        <span class="muted" style="font-size:11.5px">${esc(p.consultant)}</span>
        <span class="day" style="margin-left:auto">${fmtDate(p.admittedAt)}</span></div>
    </div></div>`).join("")}</div>`;
}
function ptTable(pts){
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>
    <th>Bed</th><th>Patient</th><th>Age/Sex</th><th>MRN</th><th>Diagnosis</th><th>PAD/POD</th><th>Consultant</th><th>Status</th><th>Priority</th></tr></thead>
    <tbody>${pts.map(p=>`<tr data-pt="${p.id}">
      <td class="num"><b>${esc(p.bed)}</b></td><td><b>${esc(p.name)}</b></td><td>${p.age}/${p.gender[0]}</td>
      <td class="num">${esc(p.mrn)}</td><td style="max-width:260px">${esc(p.dx)}</td>
      <td class="num">${padPod(p)}</td><td>${esc(p.consultant)}</td>
      <td><span class="badge ${statusBadgeClass(p.status)}">${esc(p.status)}</span></td>
      <td><span class="dot ${p.priority}"></span></td></tr>`).join("")}</tbody></table></div>`;
}

/* ---------------- bed board ---------------- */
function renderBeds(){
  const cap=DB.config.capacity; const occ=occupiedBeds();
  const byBed={}; activePatients().forEach(p=>byBed[p.bed]=p);
  let cells="";
  for(let i=1;i<=cap;i++){
    const b=String(i); const p=byBed[b];
    if(p){ cells+=`<div class="pt-card" data-pt="${p.id}" style="min-height:96px"><div class="spine ${p.priority}"></div>
      <div class="pc-b" style="padding:10px 12px 10px 14px"><div class="pc-top"><span class="pc-bed">${b}</span>
      <span class="badge ${statusBadgeClass(p.status)}" style="font-size:10px;padding:1px 7px">${esc(p.status)}</span></div>
      <div style="font-weight:650;font-size:13.5px;margin-top:6px">${esc(p.name)}</div>
      <div class="muted" style="font-size:11.5px">${p.age}${p.gender[0]} · ${padPod(p)}</div></div></div>`;
    } else {
      cells+=`<div class="card" style="min-height:96px;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);border-style:dashed">
        <div class="mono" style="font-size:16px;font-weight:700;color:var(--ink-3)">${b}</div><div style="font-size:11.5px">Vacant</div></div>`;
    }
  }
  return `<div class="page-head"><div><h1>Bed Board</h1><div class="sub">${occ.size} occupied · ${cap-occ.size} vacant · ${cap} total</div></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:11px">${cells}</div>`;
}

/* ---------------- patient profile ---------------- */
let PROF_TAB="overview";
function renderProfile(id){
  const p=byId("patients",id); if(!p)return `<div class="empty">Patient not found. <button class="btn sm" data-go="patients">Back</button></div>`;
  const tabs=[
    ["overview","Overview","user"],
    ["notes","Progress Notes","note",coll("notes").filter(x=>x.patientId===id).length],
    ["surgery","Surgeries","scalpel",coll("surgeries").filter(x=>x.patientId===id).length],
    ["meds","Medications","pill",coll("meds").filter(x=>x.patientId===id&&x.status==="Active").length],
    ["mar","MAR","check",coll("mar").filter(x=>x.patientId===id).length],
    ["labs","Investigations","flask",coll("labs").filter(x=>x.patientId===id&&x.status==="Pending").length],
    ["io","Intake / Output","drop"],
    ["drains","Drains","drop",coll("drains").filter(x=>x.patientId===id&&!x.removedAt).length],
    ["orders","Consultant Orders","order",coll("orders").filter(x=>x.patientId===id&&x.status==="Pending").length],
    ["tasks","Tasks","task",coll("tasks").filter(x=>x.patientId===id&&x.status==="Pending").length],
    ["photos","Clinical Photos","camera",coll("photos").filter(x=>x.patientId===id).length],
    ["chat","Discussion","chat",coll("chat").filter(x=>x.patientId===id).length],
    ["timeline","Timeline","timeline"],
  ];
  const flags=p.flags&&p.flags.length?`<div class="pf-tags">${p.flags.map(f=>`<span class="badge red">${esc(f)}</span>`).join("")}</div>`:"";
  return `<div class="no-print"><button class="btn sm ghost" data-go="patients" style="margin-bottom:12px">← All patients</button></div>
  <div class="pf-head"><div class="spine ${p.priority}"></div>
    <div class="pf-top">
      <div style="flex:1;min-width:200px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="pf-name">${esc(p.name)}</span>
          <span class="badge ${statusBadgeClass(p.status)}">${esc(p.status)}</span>
          <span class="dot ${p.priority}" title="${p.priority} priority"></span>
        </div>
        ${flags}
      </div>
      <div class="pill-row no-print">
        ${can("editPatient")?`<button class="btn sm" data-act="editPatient" data-id="${id}">${ICONS.edit}Edit</button>`:""}
        ${can("editPatient")?`<button class="btn sm" data-act="changeStatus" data-id="${id}">Status</button>`:""}
        ${can("discharge")&&p.status!=="Discharged"?`<button class="btn sm" data-act="dischargeMenu" data-id="${id}">${ICONS.discharge}Discharge</button>`:""}
        ${can("deletePatient")?`<button class="btn sm danger" data-act="deletePatient" data-id="${id}">${ICONS.trash}Delete</button>`:""}
        ${p.archived&&(p.dischargeSummary||p.death||p.lama)?`<button class="btn sm" data-act="viewSummary" data-id="${id}">${ICONS.report}Discharge record</button>`:""}
        ${p.archived&&p.outcome!=="Died"&&(can("discharge")||currentUser().role==="admin")?`<button class="btn sm" data-act="cancelDischarge" data-id="${id}">Cancel ${(p.outcome==="LAMA"||p.outcome==="DOR")?esc(p.outcome):"discharge"}</button>`:""}
      </div>
    </div>
    <div class="pf-kv">
      <div><div class="k">MRN</div><div class="v mono">${esc(p.mrn)}</div></div>
      <div><div class="k">Bed</div><div class="v mono">${esc(p.bed)}</div></div>
      <div><div class="k">Age / Sex</div><div class="v">${p.age} / ${esc(p.gender)}</div></div>
      <div><div class="k">Blood group</div><div class="v">${esc(p.bloodGroup||"—")}</div></div>
      <div><div class="k">Consultant</div><div class="v">${esc(p.consultant)}</div></div>
      <div><div class="k">Admitted</div><div class="v">${fmtDate(p.admittedAt)}</div></div>
      <div><div class="k">PAD / POD</div><div class="v mono">${padPod(p)}</div></div>
      <div style="grid-column:1/-1"><div class="k">Diagnosis</div><div class="v">${esc(p.dx)}${p.dx2?" · "+esc(p.dx2):""}</div></div>
    </div>
  </div>
  <div class="tabbar no-print">${tabs.map(t=>`<button class="${PROF_TAB===t[0]?"on":""}" data-tab="${t[0]}">${ICONS[t[2]]}${t[1]}${t[3]?`<span class="tc">${t[3]}</span>`:""}</button>`).join("")}</div>
  <div id="tabBody">${renderTab(p)}</div>`;
}

function renderTab(p){
  const id=p.id;
  switch(PROF_TAB){
    case"overview":return tabOverview(p);
    case"notes":return listPanel("Progress Notes",can("note")?`<button class="btn sm primary" data-act="addNote" data-id="${id}">${ICONS.plus}Add note</button>`:"",
      coll("notes").filter(x=>x.patientId===id).sort((a,b)=>new Date(b.at)-new Date(a.at)).map(n=>`
        <div class="entry"><div class="entry-h"><span class="badge teal">${esc(n.type)}</span>
          <span class="who"><b>${esc(n.by)}</b> · ${fmtDT(n.at)}</span></div>
          <div class="entry-body">${esc(n.body)}</div></div>`).join("")||emptyState("note","No progress notes yet",""));
    case"surgery":return tabSurgery(p);
    case"meds":return tabMeds(p);
    case"mar":return tabMAR(p);
    case"labs":return tabLabs(p);
    case"io":return tabIO(p);
    case"drains":return tabDrains(p);
    case"orders":return tabOrders(p);
    case"tasks":return tabTasks(p);
    case"photos":return tabPhotos(p);
    case"chat":return tabChat(p);
    case"timeline":return tabTimeline(p);
    default:return"";
  }
}
function listPanel(title,actions,body){
  return `<div class="toolbar" style="margin-bottom:12px"><h2 style="font-size:16px">${title}</h2><div style="flex:1"></div>${actions||""}</div>${body}`;
}

function tabOverview(p){
  const id=p.id;
  const meds=coll("meds").filter(x=>x.patientId===id&&x.status==="Active");
  const labs=coll("labs").filter(x=>x.patientId===id&&x.status==="Pending");
  const orders=coll("orders").filter(x=>x.patientId===id&&x.status==="Pending");
  const surg=latestSurgery(id);
  const lastNote=coll("notes").filter(x=>x.patientId===id).sort((a,b)=>new Date(b.at)-new Date(a.at))[0];
  return `<div class="dash-grid">
    <div class="stack">
      <div class="card"><div class="panel-h"><h3>Latest progress note</h3>${can("note")?`<button class="btn xs primary" data-act="addNote" data-id="${id}">Add</button>`:""}</div>
        <div class="panel-b">${lastNote?`<div class="entry-body">${esc(lastNote.body)}</div><div class="who muted" style="margin-top:8px;font-size:12px"><b>${esc(lastNote.by)}</b> · ${fmtDT(lastNote.at)}</div>`:`<div class="muted">No notes yet.</div>`}</div></div>
      <div class="card"><div class="panel-h"><h3>Active medications</h3><span class="badge teal">${meds.length}</span></div>
        <div class="panel-b" style="padding:8px">${meds.length?meds.map(m=>`<div class="alert-row" style="border-radius:8px;cursor:default">
          <div class="alert-ic a-blue">${ICONS.pill}</div><div class="txt"><b>${esc(m.name)} ${esc(m.dose)}${esc(m.unit)}</b>
          <div class="meta">${esc(m.route)} · ${esc(m.freq)}${m.antibiotic?` · <span style="color:var(--purple)">Antibiotic</span>`:""}${m.highRisk?` · <span style="color:var(--red)">High-risk</span>`:""}</div></div></div>`).join(""):`<div class="muted" style="padding:10px">None active.</div>`}</div></div>
    </div>
    <div class="stack">
      <div class="card"><div class="panel-h"><h3>Latest surgery</h3></div>
        <div class="panel-b">${surg?`<div class="kv-list">
          <div class="r"><span class="k">Procedure</span><span class="v">${esc(surg.procedure)}</span></div>
          <div class="r"><span class="k">Type</span><span class="v">${esc(surg.type)}</span></div>
          <div class="r"><span class="k">Surgeon</span><span class="v">${esc(surg.surgeon)}</span></div>
          <div class="r"><span class="k">Date · POD</span><span class="v mono">${fmtDate(surg.date)} · ${daysBetween(surg.date,now())}</span></div>
        </div>`:`<div class="muted">No completed surgery.</div>`}</div></div>
      <div class="card"><div class="panel-h"><h3>Outstanding</h3></div>
        <div class="panel-b"><div class="kv-list">
          <div class="r"><span class="k">Pending investigations</span><span class="v">${labs.length}</span></div>
          <div class="r"><span class="k">Pending orders</span><span class="v">${orders.length}</span></div>
          <div class="r"><span class="k">Open tasks</span><span class="v">${coll("tasks").filter(t=>t.patientId===id&&t.status==="Pending").length}</span></div>
          <div class="r"><span class="k">Active drains</span><span class="v">${coll("drains").filter(d=>d.patientId===id&&!d.removedAt).length}</span></div>
        </div></div></div>
      <div class="card"><div class="panel-h"><h3>Contact</h3></div><div class="panel-b"><div class="kv-list">
        <div class="r"><span class="k">Mobile</span><span class="v">${esc(p.mobile||"—")}</span></div>
        <div class="r"><span class="k">Attendant</span><span class="v">${esc(p.attendant||"—")}</span></div>
        <div class="r"><span class="k">Admission source</span><span class="v">${esc(p.admitSource||"—")}</span></div>
      </div></div></div>
    </div>
  </div>`;
}

function tabSurgery(p){
  const id=p.id;
  const list=coll("surgeries").filter(x=>x.patientId===id).sort((a,b)=>new Date(b.date)-new Date(a.date));
  return listPanel("Surgeries",can("surgery")?`<button class="btn sm primary" data-act="addSurgery" data-id="${id}">${ICONS.plus}Record surgery</button>`:"",
    list.map(s=>{const pod=s.status==="Completed"?daysBetween(s.date,now()):null;
      return `<div class="entry"><div class="entry-h">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:14.5px">${esc(s.procedure)}</b>
          <span class="badge ${s.type==="Emergency"?"red":"blue"}">${esc(s.type)}</span>
          <span class="badge ${surgStatusClass(s.status)}">${esc(s.status)}</span>
          ${pod!==null?`<span class="badge teal mono">POD ${pod}</span>`:""}</div>
        ${can("surgery")?`<div class="pill-row">${s.status!=="Completed"?`<button class="btn xs primary" data-act="completeSurgery" data-id="${s.id}">Mark done</button>`:""}<button class="btn xs" data-act="editSurgery" data-id="${s.id}">Edit</button></div>`:""}</div>
        <div class="kv-list" style="margin-top:4px">
          <div class="r"><span class="k">Surgeon</span><span class="v">${esc(s.surgeon)}${s.assistant?" · asst "+esc(s.assistant):""}</span></div>
          <div class="r"><span class="k">OT · Date</span><span class="v mono">${esc(s.otRoom||"—")} · ${fmtDT(s.date)}</span></div>
          <div class="r"><span class="k">Indication</span><span class="v">${esc(s.indication||"—")}</span></div>
          ${s.findings?`<div class="r"><span class="k">Findings</span><span class="v" style="text-align:right;max-width:60%">${esc(s.findings)}</span></div>`:""}
        </div></div>`;}).join("")||emptyState("scalpel","No surgeries recorded",""));
}
function surgStatusClass(s){return {Completed:"green",Scheduled:"blue","In Operation":"amber",Cancelled:"gray",Postponed:"amber",Planned:"purple"}[s]||"gray";}

function tabMeds(p){
  const id=p.id;
  const meds=coll("meds").filter(x=>x.patientId===id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const active=meds.filter(m=>m.status==="Active"||m.status==="Withheld");
  const done=meds.filter(m=>m.status==="Completed"||m.status==="Discontinued");
  const card=(m)=>`<div class="entry"><div class="entry-h">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:14.5px">${esc(m.name)}</b>
      <span class="mono" style="font-weight:600">${esc(m.dose)}${esc(m.unit)}</span>
      <span class="badge gray">${esc(m.route)}</span>
      ${m.antibiotic?`<span class="badge purple">Antibiotic</span>`:""}${m.highRisk?`<span class="badge red">High-risk</span>`:""}
      <span class="badge ${m.status==="Active"?"green":m.status==="Withheld"?"amber":"gray"}">${esc(m.status)}</span></div>
    ${can("med")&&(m.status==="Active"||m.status==="Withheld")?`<div class="pill-row">
      ${m.status==="Active"?`<button class="btn xs" data-act="withholdMed" data-id="${m.id}">Withhold</button>`:`<button class="btn xs primary" data-act="restartMed" data-id="${m.id}">Restart</button>`}
      <button class="btn xs" data-act="discontinueMed" data-id="${m.id}">Stop</button></div>`:""}</div>
    <div class="pc-meta" style="margin-top:2px">${esc(m.freq)}${m.timing?" · "+esc(m.timing):""} · ${esc(m.duration)}${m.indication?" · for "+esc(m.indication):""}</div>
    <div class="who muted" style="font-size:11.5px;margin-top:6px">Prescribed by ${esc(m.prescriber)} · ${fmtDT(m.startAt)}${m.withholdReason?` · Withheld: ${esc(m.withholdReason)}`:""}</div></div>`;
  return listPanel("Medications",can("med")?`<button class="btn sm primary" data-act="addMed" data-id="${id}">${ICONS.plus}Prescribe</button>`:"",
    (active.length?`<div class="sb-sec" style="margin:0 0 8px;color:var(--muted)">ACTIVE</div>`+active.map(card).join(""):"")+
    (done.length?`<div class="sb-sec" style="margin:14px 0 8px;color:var(--muted)">COMPLETED / DISCONTINUED</div>`+done.map(card).join(""):"")+
    (!meds.length?emptyState("pill","No medications prescribed",""):""));
}

function tabMAR(p){
  const id=p.id;
  const meds=coll("meds").filter(x=>x.patientId===id&&x.status==="Active");
  const entries=coll("mar").filter(x=>x.patientId===id).sort((a,b)=>new Date(b.at)-new Date(a.at));
  return `<div class="toolbar"><h2 style="font-size:16px">Medication Administration Record</h2></div>
    ${can("mar")?`<div class="card" style="margin-bottom:14px"><div class="panel-h"><h3>Record administration</h3></div>
      <div class="panel-b">${meds.length?`<div class="pill-row">${meds.map(m=>`<button class="btn sm" data-act="administer" data-mid="${m.id}" data-pid="${id}">${ICONS.check}${esc(m.name)} ${esc(m.dose)}${esc(m.unit)}</button>`).join("")}</div>
        <div class="muted" style="font-size:12px;margin-top:8px">Tap a medication to record it as given now, or open it to record missed / delayed.</div>`
        :`<div class="muted">No active medications to administer.</div>`}</div></div>`:""}
    ${entries.length?`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Medication</th><th>Status</th><th>By</th><th>Note</th></tr></thead>
      <tbody>${entries.map(e=>{const m=byId("meds",e.medId);return `<tr style="cursor:default"><td class="num">${fmtDT(e.at)}</td>
        <td><b>${esc(m?m.name:e.medName||"—")}</b></td><td><span class="badge ${e.status==="Given"?"green":e.status==="Missed"?"red":"amber"}">${esc(e.status)}</span></td>
        <td>${esc(e.by)}</td><td>${esc(e.note||"")}</td></tr>`;}).join("")}</tbody></table></div>`
      :emptyState("check","No administrations recorded","")}`;
}

function tabLabs(p){
  const id=p.id;
  const list=coll("labs").filter(x=>x.patientId===id).sort((a,b)=>new Date(b.orderedAt)-new Date(a.orderedAt));
  const pending=list.filter(l=>l.status==="Pending"), done=list.filter(l=>l.status==="Resulted");
  const row=(l)=>`<tr style="cursor:default"><td><b>${esc(l.test)}</b></td><td>${esc(l.category)}</td>
    <td><span class="badge ${l.urgency==="Urgent"?"red":"gray"}">${esc(l.urgency)}</span></td>
    <td>${esc(l.result||"—")}</td><td class="num">${fmtDate(l.orderedAt)}</td>
    <td><span class="badge ${l.status==="Resulted"?"green":"amber"}">${esc(l.status)}</span></td>
    <td class="no-print">${can("lab")&&l.status==="Pending"?`<button class="btn xs primary" data-act="resultLab" data-id="${l.id}">Enter result</button>`:""}</td></tr>`;
  return listPanel("Investigations",can("lab")?`<button class="btn sm primary" data-act="addLab" data-id="${id}">${ICONS.plus}Order</button>`:"",
    list.length?`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Test</th><th>Category</th><th>Urgency</th><th>Result</th><th>Ordered</th><th>Status</th><th class="no-print"></th></tr></thead>
      <tbody>${pending.map(row).join("")}${done.map(row).join("")}</tbody></table></div>`:emptyState("flask","No investigations ordered",""));
}

function tabIO(p){
  const id=p.id;
  const today=fmtDateInput(now());
  const entries=coll("io").filter(x=>x.patientId===id);
  const todayE=entries.filter(e=>fmtDateInput(e.at)===today);
  const inV=todayE.filter(e=>e.kind==="input").reduce((s,e)=>s+e.volume,0);
  const outV=todayE.filter(e=>e.kind==="output").reduce((s,e)=>s+e.volume,0);
  const bal=inV-outV;
  return `<div class="toolbar"><h2 style="font-size:16px">Intake / Output — Fluid Balance</h2><div style="flex:1"></div>
    ${can("io")?`<button class="btn sm" data-act="addIO" data-id="${id}" data-kind="input">${ICONS.plus}Input</button>
      <button class="btn sm" data-act="addIO" data-id="${id}" data-kind="output">${ICONS.plus}Output</button>`:""}</div>
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);max-width:560px">
      <div class="stat accent-blue"><div class="lbl">Total input (24h)</div><div class="val mono">${inV}<span style="font-size:14px"> mL</span></div></div>
      <div class="stat accent-amber"><div class="lbl">Total output (24h)</div><div class="val mono">${outV}<span style="font-size:14px"> mL</span></div></div>
      <div class="stat accent-${bal<0?"red":"green"}"><div class="lbl">Balance</div><div class="val mono">${bal>0?"+":""}${bal}<span style="font-size:14px"> mL</span></div></div>
    </div>
    ${entries.length?`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Type</th><th>Source</th><th>Volume</th></tr></thead>
      <tbody>${entries.slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).map(e=>`<tr style="cursor:default"><td class="num">${fmtDT(e.at)}</td>
        <td><span class="badge ${e.kind==="input"?"blue":"amber"}">${e.kind}</span></td><td>${esc(e.label)}</td><td class="num">${e.volume} mL</td></tr>`).join("")}</tbody></table></div>`
      :emptyState("drop","No fluid records","")}`;
}

function tabDrains(p){
  const id=p.id;
  const drains=coll("drains").filter(x=>x.patientId===id);
  return listPanel("Drains & Tubes",can("drain")?`<button class="btn sm primary" data-act="addDrain" data-id="${id}">${ICONS.plus}Add drain</button>`:"",
    drains.map(d=>{const total=d.outputs.reduce((s,o)=>s+o.volume,0);
      return `<div class="entry"><div class="entry-h">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>${esc(d.name)}</b><span class="badge gray">${esc(d.site)}</span>
          <span class="badge ${d.removedAt?"gray":"green"}">${d.removedAt?"Removed":"In situ"}</span>
          <span class="badge teal mono">Total ${total} mL</span></div>
        ${can("drain")&&!d.removedAt?`<div class="pill-row"><button class="btn xs primary" data-act="drainOutput" data-id="${d.id}">Log output</button><button class="btn xs" data-act="removeDrain" data-id="${d.id}">Remove</button></div>`:""}</div>
        <div class="who muted" style="font-size:11.5px;margin:4px 0 8px">Inserted ${fmtDate(d.insertedAt)}${d.removedAt?" · Removed "+fmtDate(d.removedAt):""}</div>
        ${d.outputs.length?`<table class="tbl" style="font-size:12.5px"><thead><tr><th>Date</th><th>Volume</th><th>Character</th></tr></thead>
          <tbody>${d.outputs.slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).map(o=>`<tr style="cursor:default"><td class="num">${fmtDate(o.at)}</td><td class="num">${o.volume} mL</td><td>${esc(o.character)}</td></tr>`).join("")}</tbody></table>`:`<div class="muted" style="font-size:12px">No outputs logged.</div>`}
      </div>`;}).join("")||emptyState("drop","No drains recorded",""));
}

function tabOrders(p){ return genOrderTask(p,"orders","order","Consultant Orders","Order",can("order")); }
function tabTasks(p){ return genOrderTask(p,"tasks","task","Tasks","Task",can("task")); }
function genOrderTask(p,type,icon,title,label,perm){
  const id=p.id; const permKey=type==="orders"?"order":"task";
  const list=coll(type).filter(x=>x.patientId===id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const pending=list.filter(x=>x.status==="Pending"), done=list.filter(x=>x.status!=="Pending");
  const row=(o)=>`<div class="entry"><div class="entry-h">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>${esc(o.text||o.title)}</b>
      <span class="badge ${o.priority==="Urgent"?"red":"gray"}">${esc(o.priority)}</span>
      <span class="badge ${o.status==="Pending"?"amber":"green"}">${esc(o.status)}</span>
      <span class="badge blue">→ ${esc(ROLES[o.assignedTo]?.label||o.assignedTo)}</span></div>
    ${canComplete(permKey,o)&&o.status==="Pending"?`<button class="btn xs primary" data-act="complete${type}" data-id="${o.id}">${ICONS.check}Complete</button>`:""}</div>
    <div class="who muted" style="font-size:11.5px;margin-top:4px">By ${esc(o.createdBy)} · ${fmtDT(o.createdAt)}${o.dueAt?" · due "+fmtDate(o.dueAt):""}</div></div>`;
  return listPanel(title,perm?`<button class="btn sm primary" data-act="add${type}" data-id="${id}">${ICONS.plus}New ${label.toLowerCase()}</button>`:"",
    pending.map(row).join("")+done.map(row).join("")||emptyState(icon,"No "+title.toLowerCase(),""));
}

function tabPhotos(p){
  const id=p.id;
  const photos=coll("photos").filter(x=>x.patientId===id).sort((a,b)=>new Date(b.at)-new Date(a.at));
  return listPanel("Clinical Photography",can("photo")?`<label class="btn sm primary" style="cursor:pointer">${ICONS.plus}Upload photo<input type="file" accept="image/*" id="photoInput" data-id="${id}" style="display:none"></label>`:"",
    photos.length?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">${photos.map(ph=>`
      <div class="card" style="overflow:hidden"><img src="${ph.data}" style="width:100%;height:170px;object-fit:cover;display:block" alt="clinical photo">
      <div style="padding:9px 11px"><div style="font-size:12.5px;font-weight:600">${esc(ph.label||"Clinical photo")}</div>
      <div class="muted" style="font-size:11px">${esc(ph.by)} · ${fmtDT(ph.at)}</div>
      ${can("photo")?`<button class="btn xs ghost" data-act="delPhoto" data-id="${ph.id}" style="margin-top:6px;color:var(--red)">Delete</button>`:""}</div></div>`).join("")}</div>`
    :emptyState("camera","No clinical photos","Wound documentation and images appear here."));
}

function tabChat(p){
  const id=p.id;
  const msgs=coll("chat").filter(x=>x.patientId===id).sort((a,b)=>new Date(a.at)-new Date(b.at));
  const u=currentUser();
  return `<div class="toolbar"><h2 style="font-size:16px">Team Discussion</h2></div>
    <div class="card"><div class="panel-b" style="max-height:52vh;overflow-y:auto" id="chatScroll">
      ${msgs.length?msgs.map(m=>{const mine=m.uid===u.id;return `<div style="display:flex;gap:9px;margin-bottom:12px;${mine?"flex-direction:row-reverse":""}">
        <div class="avatar" style="width:30px;height:30px;font-size:11px;background:${mine?"var(--primary)":"var(--ink-3)"}">${initials(m.by)}</div>
        <div style="max-width:72%"><div style="background:${mine?"var(--primary-l)":"var(--line-2)"};padding:8px 12px;border-radius:12px;font-size:13.5px">${esc(m.text)}</div>
        <div class="muted" style="font-size:10.5px;margin-top:3px;${mine?"text-align:right":""}">${esc(m.by)} · ${timeAgo(m.at)}</div></div></div>`;}).join("")
        :`<div class="muted" style="padding:20px;text-align:center">No messages yet. Start the discussion.</div>`}
    </div>
    ${can("chat")?`<div style="display:flex;gap:8px;padding:12px;border-top:1px solid var(--line-2)">
      <input class="inp" id="chatInput" placeholder="Message the team about this patient…" data-id="${id}">
      <button class="btn primary" data-act="sendChat" data-id="${id}">Send</button></div>`:""}
    </div>`;
}

function tabTimeline(p){
  const id=p.id;
  const items=coll("timeline").filter(x=>x.patientId===id).sort((a,b)=>new Date(b.at)-new Date(a.at));
  return `<div class="toolbar"><h2 style="font-size:16px">Patient Timeline</h2></div>
    ${items.length?`<div class="card"><div class="panel-b"><div class="tl">${items.map(t=>`
      <div class="tl-item ${t.color}"><div class="tl-time">${fmtDT(t.at)} · ${esc(t.by)}</div>
      <div class="tl-title">${esc(t.title)}</div>${t.desc?`<div class="tl-desc">${esc(t.desc)}</div>`:""}</div>`).join("")}</div></div></div>`
      :emptyState("timeline","No timeline events yet","")}`;
}


/* ================= OTHER PAGES ================= */
function renderOT(){
  const surg=coll("surgeries").filter(s=>s.status!=="Cancelled").sort((a,b)=>new Date(a.date)-new Date(b.date));
  const groups={};
  surg.forEach(s=>{const d=fmtDateInput(s.date);(groups[d]=groups[d]||[]).push(s);});
  const today=fmtDateInput(now());
  const keys=Object.keys(groups).sort();
  return `<div class="page-head"><div><h1>Operation Theatre Board</h1><div class="sub">${surg.length} scheduled & completed cases</div></div></div>
    ${keys.length?keys.map(d=>`<div class="card" style="margin-bottom:14px"><div class="panel-h">
      <h3>${d===today?"Today · ":""}${fmtDate(d+"T00:00:00")}</h3><span class="badge teal">${groups[d].length} case${groups[d].length>1?"s":""}</span></div>
      <div class="tbl-wrap" style="border:none;box-shadow:none"><table class="tbl"><thead><tr><th>Patient</th><th>Bed</th><th>Procedure</th><th>Type</th><th>Surgeon</th><th>OT</th><th>Status</th></tr></thead>
      <tbody>${groups[d].map(s=>{const p=byId("patients",s.patientId);return `<tr ${p?`data-pt="${p.id}"`:'style="cursor:default"'}>
        <td><b>${esc(p?p.name:"—")}</b></td><td class="num">${esc(p?p.bed:"—")}</td><td>${esc(s.procedure)}</td>
        <td><span class="badge ${s.type==="Emergency"?"red":"blue"}">${esc(s.type)}</span></td><td>${esc(s.surgeon)}</td>
        <td class="num">${esc(s.otRoom||"—")}</td><td><span class="badge ${surgStatusClass(s.status)}">${esc(s.status)}</span></td></tr>`;}).join("")}</tbody></table></div></div>`).join("")
      :emptyState("ot","No surgeries scheduled","")}`;
}

function renderWorkQueue(){
  const u=currentUser();
  const orders=coll("orders").filter(o=>o.status==="Pending"&&o.assignedTo===u.role);
  const tasks=coll("tasks").filter(t=>t.status==="Pending"&&t.assignedTo===u.role);
  const mine=[...orders.map(o=>({...o,_t:"orders",label:o.text})),...tasks.map(t=>({...t,_t:"tasks",label:t.title}))]
    .sort((a,b)=>(a.priority==="Urgent"?0:1)-(b.priority==="Urgent"?0:1));
  return `<div class="page-head"><div><h1>My Work Queue</h1><div class="sub">Items assigned to ${esc(ROLES[u.role].label)}</div></div></div>
    ${mine.length?mine.map(o=>`<div class="entry"><div class="entry-h">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="badge ${o._t==="orders"?"purple":"blue"}">${o._t==="orders"?"Order":"Task"}</span>
        <b>${esc(o.label)}</b><span class="badge ${o.priority==="Urgent"?"red":"gray"}">${esc(o.priority)}</span></div>
      <div class="pill-row"><button class="btn xs" data-pt="${o.patientId}">Open patient</button>
        <button class="btn xs primary" data-act="complete${o._t}" data-id="${o.id}">${ICONS.check}Complete</button></div></div>
      <div class="who muted" style="font-size:11.5px;margin-top:4px">${esc(patientName(o.patientId))} · by ${esc(o.createdBy)} · ${fmtDT(o.createdAt)}</div></div>`).join("")
      :emptyState("task","Your queue is clear","Nothing assigned to you right now.")}`;
}

function renderReports(){
  const pts=activePatients();
  const today=fmtDateInput(now());
  const admitToday=pts.filter(p=>fmtDateInput(p.admittedAt)===today);
  const dischToday=coll("patients").filter(p=>p.archived&&p.dischargedAt&&fmtDateInput(p.dischargedAt)===today);
  const otToday=coll("surgeries").filter(s=>fmtDateInput(s.date)===today);
  const cap=DB.config.capacity,occ=occupiedBeds().size;
  const priCount=(pr)=>pts.filter(p=>p.priority===pr).length;
  return `<div class="page-head"><div><h1>Reports & Handover</h1><div class="sub">${new Date().toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}</div></div>
    <button class="btn no-print" onclick="window.print()">${ICONS.report}Print / Save PDF</button></div>
  <div class="print-only" style="margin-bottom:16px"><h1 style="font-size:22px">${esc(DB.config.ward)} — Handover Report</h1>
    <div class="muted">${esc(DB.config.hospital)} · ${new Date().toLocaleString("en-GB")}</div></div>

  <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
    <div class="stat accent-teal"><div class="lbl">Total patients</div><div class="val">${pts.length}</div></div>
    <div class="stat accent-blue"><div class="lbl">Occupancy</div><div class="val">${occ}/${cap}</div></div>
    <div class="stat accent-teal"><div class="lbl">Admissions today</div><div class="val">${admitToday.length}</div></div>
    <div class="stat accent-green"><div class="lbl">Discharges today</div><div class="val">${dischToday.length}</div></div>
    <div class="stat accent-blue"><div class="lbl">OT cases today</div><div class="val">${otToday.length}</div></div>
    <div class="stat accent-red"><div class="lbl">Red priority</div><div class="val">${priCount("red")}</div></div>
  </div>

  <div class="card" style="margin-bottom:14px"><div class="panel-h"><h3>Priority patients — for handover</h3></div>
    <div class="tbl-wrap" style="border:none;box-shadow:none"><table class="tbl"><thead><tr><th>Pri</th><th>Bed</th><th>Patient</th><th>Diagnosis</th><th>PAD/POD</th><th>Consultant</th><th>Outstanding</th></tr></thead>
    <tbody>${pts.slice().sort((a,b)=>priorityRank(a)-priorityRank(b)).map(p=>{
      const out=[]; const pl=coll("labs").filter(l=>l.patientId===p.id&&l.status==="Pending").length; if(pl)out.push(pl+" lab"+(pl>1?"s":""));
      const po=coll("orders").filter(o=>o.patientId===p.id&&o.status==="Pending").length; if(po)out.push(po+" order"+(po>1?"s":""));
      const pt=coll("tasks").filter(t=>t.patientId===p.id&&t.status==="Pending").length; if(pt)out.push(pt+" task"+(pt>1?"s":""));
      return `<tr data-pt="${p.id}"><td><span class="dot ${p.priority}"></span></td><td class="num">${esc(p.bed)}</td>
        <td><b>${esc(p.name)}</b> <span class="muted">${p.age}${p.gender[0]}</span></td><td style="max-width:220px">${esc(p.dx)}</td>
        <td class="num">${padPod(p)}</td><td>${esc(p.consultant)}</td><td>${out.join(", ")||"—"}</td></tr>`;}).join("")}</tbody></table></div></div>

  <div class="card"><div class="panel-h"><h3>Today's OT list</h3></div>
    <div class="tbl-wrap" style="border:none;box-shadow:none">${otToday.length?`<table class="tbl"><thead><tr><th>Patient</th><th>Procedure</th><th>Type</th><th>Surgeon</th><th>Status</th></tr></thead>
    <tbody>${otToday.map(s=>{const p=byId("patients",s.patientId);return `<tr style="cursor:default"><td><b>${esc(p?p.name:"—")}</b></td><td>${esc(s.procedure)}</td>
      <td>${esc(s.type)}</td><td>${esc(s.surgeon)}</td><td><span class="badge ${surgStatusClass(s.status)}">${esc(s.status)}</span></td></tr>`;}).join("")}</tbody></table>`
      :`<div class="muted" style="padding:14px">No cases scheduled today.</div>`}</div></div>`;
}

function renderNotifications(){
  const list=coll("notifications").slice().sort((a,b)=>new Date(b.at)-new Date(a.at));
  return `<div class="page-head"><div><h1>Notifications</h1><div class="sub">${unreadCount()} unread</div></div>
    ${list.length?`<button class="btn" data-act="markAllRead">Mark all read</button>`:""}</div>
    ${list.length?list.map(n=>`<div class="entry" style="${n.read?"opacity:.65":""}" data-pt="${n.patientId||""}">
      <div class="entry-h"><div style="display:flex;align-items:center;gap:9px"><span class="dot ${n.kind==="critical"?"red":n.kind==="warn"?"amber":"blue"}"></span>
        <b>${esc(n.text)}</b></div><span class="who">${timeAgo(n.at)}</span></div>
      ${n.patientId?`<div class="muted" style="font-size:12px">${esc(patientName(n.patientId))}</div>`:""}</div>`).join("")
      :emptyState("bell","No notifications","You're all caught up.")}`;
}

function renderAudit(){
  const list=coll("audit").slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,300);
  return `<div class="page-head"><div><h1>Audit Trail</h1><div class="sub">${coll("audit").length} events · immutable log</div></div>
    <input class="inp" id="auditSearch" placeholder="Search actions or users…" style="width:240px"></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Detail</th></tr></thead>
    <tbody id="auditBody">${list.map(a=>`<tr style="cursor:default"><td class="num">${fmtDT(a.at)}</td><td>${esc(a.uname)}</td>
      <td>${esc(ROLES[a.role]?.label||a.role||"")}</td><td><b>${esc(a.action)}</b></td><td>${esc(a.detail)}</td></tr>`).join("")}</tbody></table></div>`;
}

let ADMIN_TAB="users";
function renderAdmin(){
  const tabs=[["users","Users","patients"],["matrix","Permission Matrix","admin"],["roles","Roles","user"],["config","Configuration","dash"],["data","Data & Backup","report"]];
  return `<div class="page-head"><div><h1>Administration</h1><div class="sub">Role-based access control · user management · configuration</div></div>
    ${ADMIN_TAB==="users"?`<button class="btn primary" data-act="addUser">${ICONS.plus}Add user</button>`:""}</div>
    <div class="tabbar no-print">${tabs.map(t=>`<button class="${ADMIN_TAB===t[0]?"on":""}" data-atab="${t[0]}">${ICONS[t[2]]}${t[1]}</button>`).join("")}</div>
    <div id="adminBody">${renderAdminTab()}</div>`;
}
function renderAdminTab(){
  switch(ADMIN_TAB){ case"matrix":return adminMatrix(); case"roles":return adminRoles();
    case"config":return adminConfig(); case"data":return adminData(); default:return adminUsers(); }
}
function statusBadge(s){ return {active:"green",locked:"red",created:"blue",deactivated:"gray",archived:"gray"}[s]||"gray"; }
function adminUsers(){
  const users=coll("users").slice().sort((a,b)=>ROLE_ORDER.indexOf(a.role)-ROLE_ORDER.indexOf(b.role));
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Overrides</th><th>Last login</th><th>Actions</th></tr></thead>
    <tbody>${users.map(u=>{const ov=u.permOverrides?Object.keys(u.permOverrides).length:0;
      const isSelf=u.id===currentUser().id;
      return `<tr style="cursor:default"><td><b>${esc(u.name)}</b><div class="muted" style="font-size:11.5px">${esc(u.desig)}</div></td>
      <td class="num">${esc(u.username)}</td><td>${esc(ROLES[u.role].label)}</td>
      <td><span class="badge ${statusBadge(u.status)}">${esc(u.status)}</span>${u.mustChange?`<span class="badge amber" title="Must change password" style="margin-left:4px">temp pw</span>`:""}</td>
      <td>${ov?`<span class="badge purple">${ov}</span>`:`<span class="muted">—</span>`}</td>
      <td class="num">${u.lastLogin?timeAgo(u.lastLogin):"never"}</td>
      <td><div class="pill-row">
        <button class="btn xs" data-act="editUser" data-id="${u.id}">Edit</button>
        <button class="btn xs" data-act="resetPw" data-id="${u.id}">Reset PW</button>
        ${u.role!=="admin"?`<button class="btn xs" data-act="userLifecycle" data-id="${u.id}">Lifecycle</button>`:""}
        ${!isSelf?`<button class="btn xs danger" data-act="deleteUser" data-id="${u.id}">Delete</button>`:""}
      </div></td></tr>`;}).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px;margin-top:12px">Account lifecycle (§4.6): Created → Activated → Active → Locked → Deactivated → Archived. Every change is written to the audit log.</p>`;
}
function cellSel(role,perm,supportsView){
  if(role==="admin")return `<span class="badge green" title="Unrestricted — cannot be modified">✓</span>`;
  const cur=matrixVal(role,perm);
  const opts=[["yes","✓ Allow"],["no","✗ Deny"]];
  if(supportsView)opts.splice(1,0,["view","View"]);
  opts.push(["optional","Optional"]); opts.push(["limited","Limited"]);
  return `<select class="inp mx-cell" data-role="${role}" data-perm="${perm}" style="padding:3px 4px;font-size:11.5px;min-width:74px;${stateGranted(cur)?"border-color:var(--green)":cur==="no"?"":"border-color:var(--amber)"}">
    ${opts.map(o=>`<option value="${o[0]}"${o[0]===cur?" selected":""}>${o[1]}</option>`).join("")}</select>`;
}
function adminMatrix(){
  const roles=ROLE_ORDER;
  const groups=[...new Set(PERMS.map(p=>p.group))];
  let rows="";
  groups.forEach(g=>{
    rows+=`<tr><td colspan="${roles.length+1}" style="background:var(--bg);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">${g} Permissions</td></tr>`;
    PERMS.filter(p=>p.group===g).forEach(p=>{
      rows+=`<tr style="cursor:default"><td style="position:sticky;left:0;background:#fff;font-weight:600;white-space:nowrap">${esc(p.label)}</td>
        ${roles.map(r=>`<td style="text-align:center">${cellSel(r,p.key,p.view)}</td>`).join("")}</tr>`;
    });
  });
  return `<div class="card"><div class="panel-h"><h3>Configurable Permission Matrix</h3>
      <div class="pill-row"><button class="btn sm" data-act="resetMatrix">Reset to defaults</button></div></div>
    <div class="panel-b" style="padding:0"><div class="tbl-wrap" style="border:none;box-shadow:none;max-height:64vh">
    <table class="tbl" style="font-size:12px"><thead><tr><th style="position:sticky;left:0;background:var(--bg)">Module</th>
      ${roles.map(r=>`<th style="text-align:center">${esc(shortRole(r))}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></div></div></div>
    <p class="muted" style="font-size:12px;margin-top:12px">§4.5 — changes take effect immediately for all users of that role. <b>Allow</b>/<b>Limited</b> grant the action; <b>View</b>/<b>Optional</b>/<b>Deny</b> withhold it. Individual users can be granted per-user overrides from the Users tab.</p>`;
}
function shortRole(r){ return {admin:"Admin",hod:"HOD",consultant:"Cons",assocprof:"Assoc",asstprof:"Asst",sr:"SR",resident:"Res",mo:"MO",ho:"HO",nurse:"Nurse",deo:"DEO",readonly:"R-Only"}[r]||r; }
function adminRoles(){
  return `<div class="pt-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${ROLE_ORDER.map(r=>{
    const granted=PERMS.filter(p=>stateGranted(matrixVal(r,p.key)));
    const viewOnly=PERMS.filter(p=>matrixVal(r,p.key)==="view");
    const count=coll("users").filter(u=>u.role===r).length;
    return `<div class="card"><div class="panel-b">
      <div style="display:flex;align-items:center;justify-content:space-between"><b style="font-size:14.5px">${esc(ROLES[r].label)}</b>
        <span class="badge teal">${count} user${count!==1?"s":""}</span></div>
      <div class="muted" style="font-size:11.5px;margin:6px 0 8px">${r==="admin"?"Unrestricted access (fixed).":granted.length+" permissions granted"+(viewOnly.length?" · "+viewOnly.length+" view-only":"")}</div>
      <div class="pill-row">${(r==="admin"?["All modules"]:granted.slice(0,10).map(p=>p.label)).map(l=>`<span class="flag-dot" style="background:var(--green-l);color:var(--green-d)">${esc(l)}</span>`).join("")}
      ${granted.length>10&&r!=="admin"?`<span class="flag-dot" style="background:var(--line-2);color:var(--ink-3)">+${granted.length-10}</span>`:""}</div>
      ${viewOnly.length?`<div class="pill-row" style="margin-top:5px">${viewOnly.map(p=>`<span class="flag-dot" style="background:var(--blue-l);color:var(--blue)">${esc(p.label)} (view)</span>`).join("")}</div>`:""}
    </div></div>`;}).join("")}</div>`;
}
function adminConfig(){
  return `<div class="card" style="margin-bottom:16px"><div class="panel-h"><h3>Ward configuration</h3></div><div class="panel-b">
    <div class="grid2">
      <label class="fld"><span>Ward name</span><input class="inp" id="cfgWard" value="${esc(DB.config.ward)}"></label>
      <label class="fld"><span>Hospital</span><input class="inp" id="cfgHosp" value="${esc(DB.config.hospital)}"></label>
      <label class="fld"><span>Bed capacity</span><input class="inp" id="cfgCap" type="number" value="${DB.config.capacity}"></label>
      <label class="fld"><span>Session timeout — minutes (§4.10)</span><input class="inp" id="cfgTimeout" type="number" value="${DB.config.inactivityMin}"></label>
      <label class="fld"><span>Minimum password length (§4.9)</span><input class="inp" id="cfgPwLen" type="number" value="${DB.config.pwMinLen||8}"></label>
    </div>
    <button class="btn primary" data-act="saveConfig">Save configuration</button>
  </div></div>`;
}
function adminData(){
  return `<div class="card"><div class="panel-h"><h3>Data management</h3></div><div class="panel-b">
    <p class="muted" style="margin:0 0 12px">All data — including the permission matrix — is stored locally in this browser. Export a backup or reset the system.</p>
    <div class="pill-row"><button class="btn" data-act="exportData">Export backup (JSON)</button>
      <label class="btn" style="cursor:pointer">Import backup<input type="file" accept="application/json" id="importFile" style="display:none"></label>
      <button class="btn danger" data-act="resetData">Reset all data</button></div>
  </div></div>`;
}

function renderUserProfile(){
  const u=currentUser();
  const logins=coll("audit").filter(a=>a.uid===u.id&&a.action==="Login").sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,6);
  const activity=coll("audit").filter(a=>a.uid===u.id).sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,10);
  const ov=u.permOverrides?Object.keys(u.permOverrides):[];
  return `<div class="page-head"><div><h1>My Profile</h1><div class="sub">${esc(ROLES[u.role].label)}</div></div></div>
  <div class="dash-grid"><div class="stack">
    <div class="card"><div class="panel-h"><h3>Account</h3></div><div class="panel-b"><div class="kv-list">
      <div class="r"><span class="k">Name</span><span class="v">${esc(u.name)}</span></div>
      <div class="r"><span class="k">Username</span><span class="v mono">${esc(u.username)}</span></div>
      <div class="r"><span class="k">Designation</span><span class="v">${esc(u.desig)}</span></div>
      <div class="r"><span class="k">Assigned role</span><span class="v">${esc(ROLES[u.role].label)}</span></div>
      <div class="r"><span class="k">Employee ID</span><span class="v">${esc(u.emp||"—")}</span></div>
      <div class="r"><span class="k">Contact</span><span class="v">${esc(u.contact||"—")}</span></div>
      <div class="r"><span class="k">Email</span><span class="v">${esc(u.email||"—")}</span></div>
      <div class="r"><span class="k">Account status</span><span class="v"><span class="badge ${statusBadge(u.status)}">${esc(u.status)}</span></span></div>
    </div>
    <div class="pill-row" style="margin-top:14px"><button class="btn primary" data-act="changePw">Change password</button>
      <button class="btn" data-act="editMyContact">Update contact info</button></div>
    ${ov.length?`<div class="divider"></div><div class="k muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Individual permission overrides</div>
      <div class="pill-row" style="margin-top:6px">${ov.map(k=>`<span class="flag-dot" style="background:${u.permOverrides[k]?'var(--green-l);color:var(--green-d)':'var(--red-l);color:var(--red-d)'}">${esc(PERM_LABEL(k))}: ${u.permOverrides[k]?"allow":"deny"}</span>`).join("")}</div>
      <p class="muted" style="font-size:11.5px;margin:8px 0 0">Roles and permissions can only be changed by an administrator (§4.12).</p>`:""}
    </div></div></div>
    <div class="stack">
      <div class="card"><div class="panel-h"><h3>Recent account activity</h3></div><div class="panel-b" style="padding:8px">
        ${activity.length?activity.map(a=>`<div class="alert-row" style="border-radius:8px;cursor:default"><div class="alert-ic a-blue">${ICONS.activity}</div>
          <div class="txt"><b>${esc(a.action)}</b><div class="meta">${fmtDT(a.at)}${a.detail?" · "+esc(a.detail):""}</div></div></div>`).join(""):`<div class="muted" style="padding:10px">No activity.</div>`}
      </div></div>
      <div class="card"><div class="panel-h"><h3>Login history</h3></div><div class="panel-b">
        ${logins.length?`<div class="kv-list">${logins.map(l=>`<div class="r"><span class="k">${fmtDT(l.at)}</span><span class="v" style="font-size:11.5px">${esc(l.device||"—")}</span></div>`).join("")}</div>`:`<div class="muted">No login history.</div>`}
      </div></div>
    </div></div>`;
}

/* ================= TOAST + MODAL ================= */
function toast(msg,kind){ const el=document.createElement("div"); el.className="toast "+(kind||"");
  el.innerHTML=(kind==="ok"?ICONS.check:kind==="err"?ICONS.alert:"")+"<span>"+esc(msg)+"</span>";
  let host=document.getElementById("toasts"); if(!host){ host=document.createElement("div"); host.id="toasts"; document.body.appendChild(host); }
  host.appendChild(el);
  setTimeout(()=>{el.style.opacity="0";el.style.transform="translateX(20px)";setTimeout(()=>el.remove(),200);},2800); }

let MODAL_CB=null;
function modal({title,body,okText,okClass,wide,narrow,onOk,hideFooter}){
  closeModal();
  const ov=document.createElement("div"); ov.className="overlay"; ov.id="overlay";
  ov.innerHTML=`<div class="modal ${wide?"wide":""} ${narrow?"narrow":""}">
    <div class="modal-h"><h2>${esc(title)}</h2><button class="x-btn" id="modalX">${ICONS.x}</button></div>
    <div class="modal-b">${body}</div>
    ${hideFooter?"":`<div class="modal-f"><button class="btn" id="modalCancel">Cancel</button>
      <button class="btn ${okClass||"primary"}" id="modalOk">${okText||"Save"}</button></div>`}</div>`;
  document.body.appendChild(ov);
  ov.addEventListener("mousedown",e=>{if(e.target===ov)closeModal();});
  document.getElementById("modalX").onclick=closeModal;
  if(!hideFooter){ document.getElementById("modalCancel").onclick=closeModal;
    document.getElementById("modalOk").onclick=async()=>{ const okBtn=document.getElementById("modalOk");
      if(onOk){ okBtn.disabled=true; let r; try{ r=await onOk(); } catch(e){ r=false; toast("Something went wrong.","err"); } finally{ if(okBtn)okBtn.disabled=false; }
        if(r!==false)closeModal(); } else closeModal(); }; }
  MODAL_CB=onOk;
  const f=ov.querySelector("input,select,textarea"); if(f)setTimeout(()=>f.focus(),40);
}
function closeModal(){ const o=document.getElementById("overlay"); if(o)o.remove(); MODAL_CB=null; }
function mval(id){ const e=document.getElementById(id); return e?e.value.trim():""; }
function mchecked(id){ const e=document.getElementById(id); return e?e.checked:false; }

function confirmModal(title,msg,okText,okClass,cb){
  modal({title,body:`<p style="margin:0;color:var(--ink-2)">${esc(msg)}</p>`,okText:okText||"Confirm",okClass:okClass||"danger",onOk:()=>{cb();}});
}

// Confirm a sensitive action by re-entering the current user's password (verified server-side).
function confirmWithPassword(title,msg,okText,cb){
  modal({title,narrow:true,body:`<p style="margin:0 0 12px;color:var(--ink-2)">${esc(msg)}</p>
    <label class="fld"><span>Confirm your password <span class="req">*</span></span><input class="inp" id="cw_pw" type="password" autocomplete="current-password"></label>
    <div id="cw_err" class="hidden" style="color:var(--red);font-size:12.5px;margin-top:6px"></div>`,
    okText:okText||"Confirm",okClass:"danger",onOk:async()=>{
      const pw=mval("cw_pw"); const err=document.getElementById("cw_err");
      if(!pw){ err.textContent="Enter your password to continue."; err.classList.remove("hidden"); return false; }
      const r=await api("POST","/api/auth/verify-password",{password:pw});
      if(!r.ok){ err.textContent=(r.data&&r.data.error)||"Incorrect password."; err.classList.remove("hidden"); return false; }
      cb();
    }});
}


/* ================= FORMS ================= */
const OPT=(arr,sel)=>arr.map(o=>`<option value="${esc(o)}"${o===sel?" selected":""}>${esc(o)}</option>`).join("");
const STATUSES=["Stable","Urgent","Critical","Pre-operative","Post-operative","Ready for Discharge"];
const GENDERS=["Male","Female","Other"];
const BLOODS=["","A+","A-","B+","B-","AB+","AB-","O+","O-"];
const SOURCES=["Emergency Department","Outpatient Department","Referral","ICU Transfer","Another Ward","Other Hospital"];
const CONSULTANTS=["Prof. Kamran Sheikh","Prof. Nadia Rehman","Dr. Faisal Qureshi"];
const FLAGS=["Allergy","High Fall Risk","Infection Control","Isolation","Blood Required","DNR","Medico-Legal Case","VIP Patient"];
const ROUTES=["Oral (PO)","IV","IM","SC","PR","Topical","Ophthalmic","Inhalational","NG","JT"];
const FREQS=["Once Daily","Twice Daily","Three Times Daily","Four Times Daily","Every 4 Hours","Every 6 Hours","Every 8 Hours","Every 12 Hours","PRN (As Required)","Stat (Once)","Continuous"];
const DURATIONS=["Number of Days","Until Review","Until Discharge","Until Stopped","Single Dose"];
const UNITS=["mg","mcg","g","mL","Units","mcg/kg/min"];

function admitForm(p){
  p=p||{};
  return `<div class="grid2">
    <label class="fld"><span>Patient name <span class="req">*</span></span><input class="inp" id="f_name" value="${esc(p.name||"")}"></label>
    <label class="fld"><span>Hospital MRN <span class="req">*</span></span><input class="inp mono" id="f_mrn" value="${esc(p.mrn||"")}" placeholder="SU2-24-####"></label>
    <label class="fld"><span>Age <span class="req">*</span></span><input class="inp" id="f_age" type="number" value="${p.age||""}"></label>
    <label class="fld"><span>Gender</span><select class="inp" id="f_gender">${OPT(GENDERS,p.gender)}</select></label>
    <label class="fld"><span>Blood group</span><select class="inp" id="f_blood">${OPT(BLOODS,p.bloodGroup)}</select></label>
    <label class="fld"><span>CNIC (optional)</span><input class="inp" id="f_cnic" value="${esc(p.cnic||"")}"></label>
    <label class="fld"><span>Bed number <span class="req">*</span></span><input class="inp mono" id="f_bed" value="${esc(p.bed||"")}"></label>
    <label class="fld"><span>Consultant <span class="req">*</span></span><select class="inp" id="f_consultant">${OPT(CONSULTANTS,p.consultant)}</select></label>
  </div>
  <label class="fld"><span>Primary diagnosis <span class="req">*</span></span><input class="inp" id="f_dx" value="${esc(p.dx||"")}"></label>
  <label class="fld"><span>Secondary diagnosis</span><input class="inp" id="f_dx2" value="${esc(p.dx2||"")}"></label>
  <div class="grid2">
    <label class="fld"><span>Clinical status</span><select class="inp" id="f_status">${OPT(STATUSES,p.status||"Stable")}</select></label>
    <label class="fld"><span>Admission source</span><select class="inp" id="f_source">${OPT(SOURCES,p.admitSource)}</select></label>
    <label class="fld"><span>Mobile number</span><input class="inp" id="f_mobile" value="${esc(p.mobile||"")}"></label>
    <label class="fld"><span>Attendant name</span><input class="inp" id="f_attendant" value="${esc(p.attendant||"")}"></label>
    <label class="fld"><span>Admission date</span><input class="inp" id="f_admit" type="date" value="${fmtDateInput(p.admittedAt)}"></label>
  </div>
  <label class="fld"><span>Patient flags</span><div class="pill-row" id="f_flags">${FLAGS.map(f=>`<label class="chip-filter" style="cursor:pointer"><input type="checkbox" value="${f}" ${p.flags&&p.flags.includes(f)?"checked":""} style="margin-right:5px;vertical-align:-1px">${f}</label>`).join("")}</div></label>`;
}
function readAdmit(){
  const flags=[...document.querySelectorAll("#f_flags input:checked")].map(x=>x.value);
  return {name:mval("f_name"),mrn:mval("f_mrn"),age:parseInt(mval("f_age"))||0,gender:mval("f_gender"),
    bloodGroup:mval("f_blood"),cnic:mval("f_cnic"),bed:mval("f_bed"),consultant:mval("f_consultant"),
    dx:mval("f_dx"),dx2:mval("f_dx2"),status:mval("f_status"),admitSource:mval("f_source"),
    mobile:mval("f_mobile"),attendant:mval("f_attendant"),admittedAt:new Date(mval("f_admit")||now()).toISOString(),flags};
}
function priorityFromStatus(st){ return st==="Critical"?"red":(st==="Urgent"||st==="Pre-operative"||st==="Ready for Discharge")?"yellow":"green"; }

function openAdmit(){
  modal({title:"Admit patient",wide:true,body:admitForm(),okText:"Admit",onOk:()=>{
    const d=readAdmit();
    if(!d.name||!d.mrn||!d.bed||!d.dx||!d.age){ toast("Fill all required fields.","err"); return false; }
    if(coll("patients").some(p=>!p.archived&&p.mrn.toLowerCase()===d.mrn.toLowerCase())){ toast("A patient with this MRN is already admitted.","err"); return false; }
    if(occupiedBeds().has(d.bed)){ toast("Bed "+d.bed+" is already occupied.","err"); return false; }
    if(new Date(d.admittedAt)>new Date()){ toast("Admission date cannot be in the future.","err"); return false; }
    const u=currentUser();
    const pt=insert("patients",{id:uid(),...d,priority:priorityFromStatus(d.status),team:"",attendantRel:"",attendantMobile:"",
      address:"",createdAt:now(),createdBy:u.name,archived:false,outcome:null,dischargedAt:null});
    addTimeline(pt.id,"admission","Patient admitted","Admitted to bed "+d.bed+" under "+d.consultant,"blue");
    audit("Admit patient",d.name+" (Bed "+d.bed+")"); notify("New admission: "+d.name+" (Bed "+d.bed+")",pt.id,"info");
    toast("Patient admitted.","ok"); route("patient",{id:pt.id});
  }});
}
function openEditPatient(id){
  const p=byId("patients",id);
  modal({title:"Edit patient",wide:true,body:admitForm(p),okText:"Save",onOk:()=>{
    const d=readAdmit();
    if(!d.name||!d.mrn||!d.bed||!d.dx){ toast("Fill required fields.","err"); return false; }
    if(d.bed!==p.bed&&occupiedBeds().has(d.bed)){ toast("Bed occupied.","err"); return false; }
    const oldBed=p.bed; Object.assign(p,d,{priority:p.priority}); saveDB();
    if(oldBed!==d.bed)addTimeline(id,"transfer","Bed change","Moved from bed "+oldBed+" to "+d.bed,"amber");
    audit("Edit patient",p.name); toast("Saved.","ok"); render();
  }});
}
function openChangeStatus(id){
  const p=byId("patients",id);
  modal({title:"Update patient status",narrow:true,body:`
    <label class="fld"><span>Clinical status</span><select class="inp" id="s_status">${OPT(STATUSES,p.status)}</select></label>
    <label class="fld"><span>Priority</span><select class="inp" id="s_pri">${OPT(["red","yellow","green"],p.priority)}</select></label>`,
    onOk:()=>{ const st=mval("s_status"),pr=mval("s_pri"); const old=p.status;
      p.status=st;p.priority=pr;saveDB(); addTimeline(id,"status","Status changed",old+" → "+st,"amber");
      audit("Change status",p.name+": "+st); notify("Status: "+p.name+" is now "+st,id,st==="Critical"?"critical":"info");
      toast("Status updated.","ok"); render(); }});
}

function openAddNote(id){
  modal({title:"Add progress note",body:`
    <label class="fld"><span>Note type</span><select class="inp" id="n_type">${OPT(["Progress Note","Case Note","Ward Round Note","Consultant Note","Procedure Note"])}</select></label>
    <label class="fld"><span>Note <span class="req">*</span></span><textarea class="inp" id="n_body" rows="6" placeholder="Clinical progress, plan…"></textarea></label>`,
    okText:"Add note",onOk:()=>{ const body=mval("n_body"); if(!body){toast("Note is empty.","err");return false;}
      const u=currentUser(); insert("notes",{id:uid(),patientId:id,type:mval("n_type"),body,by:u.name,at:now()});
      addTimeline(id,"note","Progress note added",mval("n_type"),"teal"); audit("Add note",patientName(id));
      toast("Note added.","ok"); render(); }});
}

function openAddSurgery(id,edit){
  const s=edit?byId("surgeries",edit):{};
  modal({title:edit?"Edit surgery":"Record surgery",wide:true,body:`
    <label class="fld"><span>Procedure <span class="req">*</span></span><input class="inp" id="sg_proc" value="${esc(s.procedure||"")}"></label>
    <div class="grid2">
      <label class="fld"><span>Type</span><select class="inp" id="sg_type">${OPT(["Elective","Emergency"],s.type)}</select></label>
      <label class="fld"><span>Priority</span><select class="inp" id="sg_pri">${OPT(["Elective","Semi-Urgent","Urgent","Emergency"],s.priority)}</select></label>
      <label class="fld"><span>Primary surgeon <span class="req">*</span></span><input class="inp" id="sg_surgeon" value="${esc(s.surgeon||currentUser().name)}"></label>
      <label class="fld"><span>Assistant</span><input class="inp" id="sg_asst" value="${esc(s.assistant||"")}"></label>
      <label class="fld"><span>Anaesthetist</span><input class="inp" id="sg_anaes" value="${esc(s.anaesthetist||"")}"></label>
      <label class="fld"><span>OT room</span><input class="inp" id="sg_ot" value="${esc(s.otRoom||"")}" placeholder="OT-1"></label>
      <label class="fld"><span>Date & time <span class="req">*</span></span><input class="inp" id="sg_date" type="datetime-local" value="${s.date?new Date(s.date).toISOString().slice(0,16):new Date().toISOString().slice(0,16)}"></label>
      <label class="fld"><span>Status</span><select class="inp" id="sg_status">${OPT(["Planned","Scheduled","In Operation","Completed","Postponed","Cancelled"],s.status||"Scheduled")}</select></label>
    </div>
    <label class="fld"><span>Clinical indication</span><input class="inp" id="sg_ind" value="${esc(s.indication||"")}"></label>
    <label class="fld"><span>Operative findings / notes</span><textarea class="inp" id="sg_find" rows="3">${esc(s.findings||"")}</textarea></label>`,
    okText:edit?"Save":"Record",onOk:()=>{
      const proc=mval("sg_proc"),surgeon=mval("sg_surgeon"); if(!proc||!surgeon){toast("Procedure & surgeon required.","err");return false;}
      const data={procedure:proc,type:mval("sg_type"),priority:mval("sg_pri"),surgeon,assistant:mval("sg_asst"),
        anaesthetist:mval("sg_anaes"),otRoom:mval("sg_ot"),date:new Date(mval("sg_date")).toISOString(),
        status:mval("sg_status"),indication:mval("sg_ind"),findings:mval("sg_find")};
      if(edit){ Object.assign(s,data); saveDB(); audit("Edit surgery",proc); }
      else { const su=insert("surgeries",{id:uid(),patientId:id,...data,createdBy:currentUser().name,createdAt:now()});
        addTimeline(id,"surgery",data.status==="Completed"?"Surgery completed":"Surgery scheduled",proc+" ("+data.type+")","purple");
        audit("Record surgery",proc); notify("Surgery "+data.status.toLowerCase()+": "+patientName(id),id,"info"); }
      toast("Saved.","ok"); render(); }});
}
function completeSurgery(sid){
  const s=byId("surgeries",sid); s.status="Completed"; if(!s.date||new Date(s.date)>new Date())s.date=now(); saveDB();
  addTimeline(s.patientId,"surgery","Surgery completed",s.procedure,"purple"); audit("Complete surgery",s.procedure);
  const p=byId("patients",s.patientId); if(p&&p.status==="Pre-operative"){p.status="Post-operative";saveDB();}
  toast("Surgery marked complete.","ok"); render();
}

function openAddMed(id){
  modal({title:"Prescribe medication",wide:true,body:`
    <label class="fld"><span>Medication name <span class="req">*</span></span><input class="inp" id="m_name"></label>
    <div class="grid3">
      <label class="fld"><span>Dose <span class="req">*</span></span><input class="inp" id="m_dose"></label>
      <label class="fld"><span>Unit</span><select class="inp" id="m_unit">${OPT(UNITS)}</select></label>
      <label class="fld"><span>Route</span><select class="inp" id="m_route">${OPT(ROUTES)}</select></label>
      <label class="fld"><span>Frequency</span><select class="inp" id="m_freq">${OPT(FREQS)}</select></label>
      <label class="fld"><span>Duration</span><select class="inp" id="m_dur">${OPT(DURATIONS)}</select></label>
      <label class="fld"><span>Timing</span><input class="inp" id="m_timing" placeholder="08:00, 20:00"></label>
    </div>
    <label class="fld"><span>Indication</span><input class="inp" id="m_ind" placeholder="e.g. Surgical prophylaxis"></label>
    <div class="pill-row"><label class="chip-filter" style="cursor:pointer"><input type="checkbox" id="m_abx" style="margin-right:5px;vertical-align:-1px">Antibiotic</label>
      <label class="chip-filter" style="cursor:pointer"><input type="checkbox" id="m_hr" style="margin-right:5px;vertical-align:-1px">High-risk medication</label></div>`,
    okText:"Prescribe",onOk:()=>{ const name=mval("m_name"),dose=mval("m_dose"); if(!name||!dose){toast("Name & dose required.","err");return false;}
      insert("meds",{id:uid(),patientId:id,name,dose,unit:mval("m_unit"),route:mval("m_route"),freq:mval("m_freq"),
        duration:mval("m_dur"),timing:mval("m_timing"),indication:mval("m_ind"),antibiotic:mchecked("m_abx"),highRisk:mchecked("m_hr"),
        status:"Active",prescriber:currentUser().name,startAt:now(),createdAt:now()});
      addTimeline(id,"med","Medication prescribed",name+" "+dose+mval("m_unit")+" "+mval("m_route"),"green");
      audit("Prescribe med",name+" for "+patientName(id)); notify("New medication: "+name+" for "+patientName(id),id,"info");
      toast("Prescribed.","ok"); render(); }});
}
function withholdMed(mid){
  const m=byId("meds",mid);
  modal({title:"Withhold medication",narrow:true,body:`<p style="margin:0 0 12px">Temporarily withhold <b>${esc(m.name)}</b>.</p>
    <label class="fld"><span>Reason <span class="req">*</span></span><input class="inp" id="w_reason"></label>`,
    okText:"Withhold",okClass:"danger",onOk:()=>{ const r=mval("w_reason"); if(!r){toast("Reason required.","err");return false;}
      m.status="Withheld"; m.withholdReason=r; saveDB(); addTimeline(m.patientId,"med","Medication withheld",m.name+" — "+r,"amber");
      audit("Withhold med",m.name); toast("Withheld.","ok"); render(); }});
}
function restartMed(mid){ const m=byId("meds",mid); m.status="Active"; m.withholdReason=""; saveDB();
  addTimeline(m.patientId,"med","Medication restarted",m.name,"green"); audit("Restart med",m.name); toast("Restarted.","ok"); render(); }
function discontinueMed(mid){ const m=byId("meds",mid);
  confirmModal("Discontinue medication","Stop "+m.name+" for this patient?","Discontinue","danger",()=>{
    m.status="Discontinued"; saveDB(); addTimeline(m.patientId,"med","Medication discontinued",m.name,"gray");
    audit("Discontinue med",m.name); toast("Discontinued.","ok"); render(); }); }

function administer(mid,pid){
  const m=byId("meds",mid);
  modal({title:"Record administration",narrow:true,body:`<p style="margin:0 0 12px"><b>${esc(m.name)} ${esc(m.dose)}${esc(m.unit)}</b> · ${esc(m.route)}</p>
    <label class="fld"><span>Status</span><select class="inp" id="a_status">${OPT(["Given","Missed","Delayed","Refused"])}</select></label>
    <label class="fld"><span>Note (optional)</span><input class="inp" id="a_note"></label>`,
    okText:"Record",onOk:()=>{ const st=mval("a_status");
      insert("mar",{id:uid(),patientId:pid,medId:mid,medName:m.name,status:st,note:mval("a_note"),by:currentUser().name,at:now()});
      addTimeline(pid,"mar",st==="Given"?"Medication given":"Medication "+st.toLowerCase(),m.name,st==="Missed"?"red":"blue");
      audit("MAR "+st,m.name); if(st==="Missed")notify("Missed dose: "+m.name+" — "+patientName(pid),pid,"warn");
      toast("Recorded.","ok"); render(); }});
}

function openAddLab(id){
  modal({title:"Order investigation",body:`
    <label class="fld"><span>Test / investigation <span class="req">*</span></span><input class="inp" id="l_test" placeholder="e.g. Complete Blood Count"></label>
    <div class="grid2">
      <label class="fld"><span>Category</span><select class="inp" id="l_cat">${OPT(["Laboratory","Imaging","Microbiology","Histopathology","Other"])}</select></label>
      <label class="fld"><span>Urgency</span><select class="inp" id="l_urg">${OPT(["Routine","Urgent"])}</select></label>
    </div>`,
    okText:"Order",onOk:()=>{ const t=mval("l_test"); if(!t){toast("Test required.","err");return false;}
      insert("labs",{id:uid(),patientId:id,test:t,category:mval("l_cat"),urgency:mval("l_urg"),status:"Pending",result:"",
        orderedBy:currentUser().name,orderedAt:now(),resultedAt:null});
      addTimeline(id,"lab","Investigation ordered",t,"blue"); audit("Order lab",t+" for "+patientName(id));
      toast("Ordered.","ok"); render(); }});
}
function resultLab(lid){
  const l=byId("labs",lid);
  modal({title:"Enter result — "+l.test,body:`<label class="fld"><span>Result</span><textarea class="inp" id="l_res" rows="3">${esc(l.result||"")}</textarea></label>`,
    okText:"Save result",onOk:()=>{ l.result=mval("l_res"); l.status="Resulted"; l.resultedAt=now(); saveDB();
      addTimeline(l.patientId,"lab","Investigation resulted",l.test,"green"); audit("Result lab",l.test);
      notify("Result available: "+l.test+" — "+patientName(l.patientId),l.patientId,"info"); toast("Result saved.","ok"); render(); }});
}

function openAddIO(id,kind){
  modal({title:"Add "+kind,narrow:true,body:`
    <label class="fld"><span>Source / label <span class="req">*</span></span><input class="inp" id="io_label" placeholder="${kind==="input"?"IV fluid, oral":"Urine, NG, drain"}"></label>
    <label class="fld"><span>Volume (mL) <span class="req">*</span></span><input class="inp" id="io_vol" type="number"></label>`,
    okText:"Add",onOk:()=>{ const label=mval("io_label"),vol=parseInt(mval("io_vol")); if(!label||!vol){toast("Fill fields.","err");return false;}
      insert("io",{id:uid(),patientId:id,kind,label,volume:vol,at:now()}); audit("Add "+kind,label+" "+vol+"mL");
      toast("Added.","ok"); render(); }});
}

function openAddDrain(id){
  modal({title:"Add drain / tube",body:`
    <label class="fld"><span>Drain name <span class="req">*</span></span><input class="inp" id="d_name" placeholder="e.g. Pelvic drain"></label>
    <label class="fld"><span>Site</span><input class="inp" id="d_site" placeholder="e.g. Left iliac fossa"></label>`,
    okText:"Add",onOk:()=>{ const name=mval("d_name"); if(!name){toast("Name required.","err");return false;}
      insert("drains",{id:uid(),patientId:id,name,site:mval("d_site"),insertedAt:now(),removedAt:null,outputs:[]});
      addTimeline(id,"drain","Drain inserted",name,"blue"); audit("Add drain",name); toast("Added.","ok"); render(); }});
}
function drainOutput(did){
  const d=byId("drains",did);
  modal({title:"Log output — "+d.name,narrow:true,body:`
    <label class="fld"><span>Volume (mL) <span class="req">*</span></span><input class="inp" id="do_vol" type="number"></label>
    <label class="fld"><span>Character</span><select class="inp" id="do_char">${OPT(["Serous","Serosanguinous","Sanguinous","Bilious","Purulent","Feculent"])}</select></label>`,
    okText:"Log",onOk:()=>{ const v=parseInt(mval("do_vol")); if(!v&&v!==0){toast("Volume required.","err");return false;}
      d.outputs.push({at:now(),volume:v,character:mval("do_char")}); saveDB(); audit("Drain output",d.name+" "+v+"mL");
      toast("Logged.","ok"); render(); }});
}
function removeDrain(did){ const d=byId("drains",did);
  confirmModal("Remove drain","Mark "+d.name+" as removed?","Remove","danger",()=>{ d.removedAt=now(); saveDB();
    addTimeline(d.patientId,"drain","Drain removed",d.name,"gray"); audit("Remove drain",d.name); toast("Removed.","ok"); render(); }); }

function openAddOrderTask(id,type){
  const isOrder=type==="orders"; const label=isOrder?"consultant order":"task";
  modal({title:"New "+label,body:`
    <label class="fld"><span>${isOrder?"Order":"Task"} <span class="req">*</span></span><textarea class="inp" id="ot_text" rows="3"></textarea></label>
    <div class="grid2">
      <label class="fld"><span>Assign to</span><select class="inp" id="ot_to">${Object.keys(ROLES).filter(r=>r!=="admin"&&r!=="readonly").map(r=>`<option value="${r}">${ROLES[r].label}</option>`).join("")}</select></label>
      <label class="fld"><span>Priority</span><select class="inp" id="ot_pri">${OPT(["Routine","Urgent"])}</select></label>
    </div>
    <label class="fld"><span>Due date (optional)</span><input class="inp" id="ot_due" type="date"></label>`,
    okText:"Create",onOk:()=>{ const text=mval("ot_text"); if(!text){toast("Enter details.","err");return false;}
      const rec={id:uid(),patientId:id,assignedTo:mval("ot_to"),priority:mval("ot_pri"),status:"Pending",
        createdBy:currentUser().name,createdAt:now(),dueAt:mval("ot_due")?new Date(mval("ot_due")).toISOString():null};
      if(isOrder)rec.text=text; else rec.title=text;
      insert(type,rec); addTimeline(id,type,(isOrder?"Consultant order":"Task")+" created",text.slice(0,60),"amber");
      audit("Create "+label,text.slice(0,40)); notify((isOrder?"Order":"Task")+" for "+patientName(id)+": "+text.slice(0,40),id,mval("ot_pri")==="Urgent"?"warn":"info");
      toast("Created.","ok"); render(); }});
}
function completeItem(type,itemId){ const it=byId(type,itemId); it.status="Completed"; it.completedBy=currentUser().name; it.completedAt=now(); saveDB();
  addTimeline(it.patientId,type,(type==="orders"?"Order":"Task")+" completed",(it.text||it.title).slice(0,60),"green");
  audit("Complete "+type,(it.text||it.title).slice(0,40)); toast("Completed.","ok"); render(); }

function sendChat(id){
  const inp=document.getElementById("chatInput"); const text=inp.value.trim(); if(!text)return;
  const u=currentUser(); insert("chat",{id:uid(),patientId:id,uid:u.id,by:u.name,text,at:now()});
  audit("Chat message",patientName(id)); render();
  setTimeout(()=>{const s=document.getElementById("chatScroll");if(s)s.scrollTop=s.scrollHeight;const ci=document.getElementById("chatInput");if(ci)ci.focus();},20);
}

function openDischargeMenu(id){
  const p=byId("patients",id);
  modal({title:"Discharge · "+p.name,body:`<p class="muted" style="margin:0 0 14px">Choose an outcome. The record will be archived automatically.</p>
    <div class="stack">
      <button class="btn" style="justify-content:flex-start;width:100%" data-dmenu="normal" data-id="${id}">${ICONS.discharge}Routine discharge (with summary)</button>
      <button class="btn" style="justify-content:flex-start;width:100%" data-dmenu="lama" data-id="${id}">LAMA / Discharge on request</button>
      <button class="btn" style="justify-content:flex-start;width:100%" data-dmenu="death" data-id="${id}">Record death</button>
    </div>`,hideFooter:true});
}
/* ===== Discharge auto-generation (spec §18.6) — compiles the summary from every module ===== */
function losText(admit,disch){ const d=Math.max(0,Math.round((new Date(disch)-new Date(admit))/86400000)); return d+" day"+(d===1?"":"s"); }
function autoHospitalCourse(id){
  const items=[];
  coll("timeline").filter(t=>t.patientId===id).forEach(e=>items.push({at:e.at,text:e.title+(e.desc?": "+e.desc:"")}));
  coll("notes").filter(n=>n.patientId===id).forEach(n=>items.push({at:n.at,text:(n.type||"Note")+" — "+n.body}));
  items.sort((a,b)=>new Date(a.at)-new Date(b.at));
  return items.map(i=>fmtDate(i.at)+": "+i.text).join("\n");
}
function autoProcedures(id){
  return coll("surgeries").filter(s=>s.patientId===id).sort((a,b)=>new Date(a.date)-new Date(b.date))
    .map(s=>fmtDate(s.date)+" — "+s.procedure+(s.type?" ("+s.type+")":"")+"\n   Surgeon: "+(s.surgeon||"—")+(s.assistant?"; Assistant: "+s.assistant:"")+(s.findings?"\n   Findings: "+s.findings:"")).join("\n");
}
function autoInvestigations(id){
  return coll("labs").filter(l=>l.patientId===id&&(l.status==="Resulted"||l.result))
    .map(l=>l.test+": "+(l.result||"—")+" ("+fmtDate(l.resultedAt||l.orderedAt)+")").join("\n");
}
function autoPending(id){
  return coll("labs").filter(l=>l.patientId===id&&l.status!=="Resulted"&&!l.result)
    .map(l=>l.test+" — ordered "+fmtDate(l.orderedAt)).join("\n");
}
function autoMedications(id){
  return coll("meds").filter(m=>m.patientId===id)
    .map(m=>m.name+" "+m.dose+(m.unit||"")+" "+m.route+" "+m.freq+" — "+(m.status||"")+(m.antibiotic?" [antibiotic]":"")).join("\n");
}
function autoDischargeMeds(id){
  return coll("meds").filter(m=>m.patientId===id&&m.status==="Active")
    .map(m=>m.name+" "+m.dose+(m.unit||"")+" "+m.route+" "+m.freq).join("\n");
}

/* Build an editable discharge-prescription list from the patient's active medicines */
function autoDischargeRx(id){
  return coll("meds").filter(m=>m.patientId===id&&m.status==="Active").map(m=>({
    name:m.name||"", dose:(m.dose||"")+(m.unit||""), freq:m.freq||"", duration:m.duration||"", route:m.route||"", remarks:""
  }));
}
function dcRxRowHTML(d){ d=d||{};
  return `<div class="dcrx-row" style="display:grid;grid-template-columns:1.5fr 1fr 1.2fr 1fr .9fr 1.4fr 30px;gap:6px;margin-bottom:6px;align-items:center">
    <input class="inp dcrx-name" placeholder="Medicine" value="${esc(d.name||"")}">
    <input class="inp dcrx-dose" placeholder="Dose" value="${esc(d.dose||"")}">
    <input class="inp dcrx-freq" placeholder="Frequency" value="${esc(d.freq||"")}">
    <input class="inp dcrx-dur" placeholder="Duration" value="${esc(d.duration||"")}">
    <input class="inp dcrx-route" placeholder="Route" value="${esc(d.route||"")}">
    <input class="inp dcrx-rem" placeholder="Instructions" value="${esc(d.remarks||"")}">
    <button type="button" class="btn xs danger dcrx-del" title="Remove" style="padding:4px 8px">${ICONS.x}</button></div>`;
}
function dcAddMedRow(d){ const list=document.getElementById("dc_medlist"); if(!list)return;
  const wrap=document.createElement("div"); wrap.innerHTML=dcRxRowHTML(d); const row=wrap.firstElementChild;
  row.querySelector(".dcrx-del").onclick=()=>row.remove(); list.appendChild(row);
}
function dcCollectRx(){ const out=[];
  document.querySelectorAll(".dcrx-row").forEach(r=>{ const g=c=>{const e=r.querySelector(c);return e?e.value.trim():"";};
    const name=g(".dcrx-name"); if(!name)return;
    out.push({name,dose:g(".dcrx-dose"),freq:g(".dcrx-freq"),duration:g(".dcrx-dur"),route:g(".dcrx-route"),remarks:g(".dcrx-rem")}); });
  return out;
}

/* Routine discharge — auto-generated, editable, consultant-approved summary with a structured
   discharge-medication prescriber (Additional Modifications §1; spec §18.6–18.20). */
function openDischarge(id){
  const p=byId("patients",id);
  const isConsultantish=["admin","hod","consultant","assocprof","asstprof","sr"].includes(currentUser().role);
  modal({title:"Discharge summary — "+p.name,wide:true,body:`
    <p class="muted" style="margin:0 0 12px;font-size:12px">Auto-generated from the patient's clinical record. Review and edit each section, prescribe discharge medicines, record consultant approval, then finalise. Finalised summaries are archived and become read-only.</p>
    <div class="grid2">
      <label class="fld"><span>Discharge date <span class="req">*</span></span><input class="inp" id="dc_date" type="date" value="${fmtDateInput(now())}"></label>
      <label class="fld"><span>Condition on discharge <span class="req">*</span></span><select class="inp" id="dc_cond">${OPT(["Improved","Recovered","Stable","Unchanged","Referred"])}</select></label>
    </div>
    <div class="grid2">
      <label class="fld"><span>Final (primary) diagnosis <span class="req">*</span></span><input class="inp" id="dc_finaldx" value="${esc(p.dx||"")}"></label>
      <label class="fld"><span>Secondary diagnoses</span><input class="inp" id="dc_secdx" value="${esc(p.dx2||"")}"></label>
    </div>
    <label class="fld"><span>Comorbidities</span><input class="inp" id="dc_comorb" value=""></label>
    <label class="fld"><span>Operations & procedures</span><textarea class="inp" id="dc_proc" rows="3">${esc(autoProcedures(id))}</textarea></label>
    <label class="fld"><span>Hospital course</span><textarea class="inp" id="dc_course" rows="4">${esc(autoHospitalCourse(id))}</textarea></label>
    <label class="fld"><span>Investigation summary</span><textarea class="inp" id="dc_inv" rows="2">${esc(autoInvestigations(id))}</textarea></label>
    <label class="fld"><span>Medication summary (during admission)</span><textarea class="inp" id="dc_medsum" rows="2">${esc(autoMedications(id))}</textarea></label>
    <div class="divider"></div>
    <div class="k muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Discharge medications (§1)</div>
    <div style="display:grid;grid-template-columns:1.5fr 1fr 1.2fr 1fr .9fr 1.4fr 30px;gap:6px;margin-bottom:4px;font-size:10.5px;color:var(--ink-2);text-transform:uppercase;letter-spacing:.03em">
      <span>Medicine</span><span>Dose</span><span>Frequency</span><span>Duration</span><span>Route</span><span>Instructions</span><span></span></div>
    <div id="dc_medlist"></div>
    <button type="button" class="btn sm" id="dc_addmed" style="margin-top:2px">${ICONS.plus}Add medicine</button>
    <div class="divider"></div>
    <label class="fld"><span>Pending investigations & follow-up plan (§18.9)</span><textarea class="inp" id="dc_pending" rows="2">${esc(autoPending(id))}</textarea></label>
    <label class="fld"><span>Follow-up advice (§18.10)</span><textarea class="inp" id="dc_fu" rows="2">Surgical OPD follow-up after 1 week. Suture removal as advised.</textarea></label>
    <label class="fld"><span>Special instructions / patient education (§18.11)</span><textarea class="inp" id="dc_instr" rows="2">Wound care as advised. Take medicines as prescribed. Return immediately if fever, increasing pain, bleeding, or wound discharge.</textarea></label>
    <div class="divider"></div>
    <div class="k muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Consultant approval (§18.12)</div>
    <div class="grid2">
      <label class="fld"><span>Approving consultant <span class="req">*</span></span><input class="inp" id="dc_consultant" value="${esc(p.consultant||(isConsultantish?currentUser().name:""))}"></label>
      <label class="fld"><span>Approval comments</span><input class="inp" id="dc_appcomments" value=""></label>
    </div>
    <label class="chk" style="display:flex;gap:8px;align-items:flex-start;margin-top:4px"><input type="checkbox" id="dc_override"><span style="font-size:12.5px">Finalise without consultant approval (per hospital policy). A reason will be required and recorded.</span></label>
    <label class="fld" id="dc_reasonWrap" style="display:none;margin-top:6px"><span>Override reason</span><input class="inp" id="dc_reason"></label>`,
    okText:"Finalise & discharge",onOk:()=>{
      const dischISO=new Date(mval("dc_date")||now()).toISOString();
      if(new Date(dischISO) < new Date(fmtDateInput(p.admittedAt))){ toast("Discharge date cannot precede the admission date.","err"); return false; }
      if(!mval("dc_finaldx")){ toast("Final diagnosis is required.","err"); return false; }
      const override=mchecked("dc_override");
      if(!override && !mval("dc_consultant")){ toast("Consultant approval is required before final discharge (or tick the policy override).","err"); return false; }
      if(override && !mval("dc_reason")){ toast("Please give a reason for discharging without consultant approval.","err"); return false; }
      const nowIso=now();
      const rx=dcCollectRx();
      const summary={
        outcome:"Discharged", status:"Discharged", finalizedAt:nowIso,
        date:dischISO, condition:mval("dc_cond"),
        finalDx:mval("dc_finaldx"), secondaryDx:mval("dc_secdx"), comorbidities:mval("dc_comorb"),
        procedures:mval("dc_proc"), hospitalCourse:mval("dc_course"),
        investigations:mval("dc_inv"), medicationSummary:mval("dc_medsum"),
        rx, pending:mval("dc_pending"), followup:mval("dc_fu"), instructions:mval("dc_instr"),
        consultant:mval("dc_consultant"), approvalComments:mval("dc_appcomments"),
        approvalOverride:override, overrideReason:mval("dc_reason"),
        preparedBy:currentUser().name, preparedAt:nowIso,
        admittedAt:p.admittedAt, lengthOfStay:losText(p.admittedAt,dischISO)
      };
      p.preDischargeStatus=p.status;
      p.status="Discharged"; p.archived=true; p.outcome="Discharged"; p.dischargeStatus="Discharged";
      p.dischargedAt=dischISO; p.dischargeSummary=summary; saveDB();
      if(!override) addTimeline(id,"discharge","Consultant approved discharge",summary.consultant,"teal");
      addTimeline(id,"discharge","Discharge summary generated","","blue");
      addTimeline(id,"discharge","Patient discharged","Condition: "+summary.condition,"blue");
      audit("Discharge patient",p.name+(override?" (approval overridden: "+summary.overrideReason+")":" · approved by "+summary.consultant));
      notify("Discharged: "+p.name,id,"info");
      toast("Patient discharged and archived.","ok"); route("patients");
    }});
  autoDischargeRx(id).forEach(d=>dcAddMedRow(d));
  if(!document.querySelectorAll(".dcrx-row").length) dcAddMedRow({});
  const add=document.getElementById("dc_addmed"); if(add)add.onclick=()=>dcAddMedRow({});
  const ov=document.getElementById("dc_override");
  if(ov)ov.onchange=()=>{ document.getElementById("dc_reasonWrap").style.display=ov.checked?"block":"none"; };
}

/* LAMA / Discharge on request — records requester details, auto date/time, archives */
function openLAMA(id){ const p=byId("patients",id);
  modal({title:"LAMA / Discharge on request — "+p.name,body:`
    <p class="muted" style="margin:0 0 12px;font-size:12px">The date & time of the request are recorded automatically. The record is archived on confirmation.</p>
    <div class="grid2">
      <label class="fld"><span>Type</span><select class="inp" id="lm_type">${OPT(["LAMA (Left Against Medical Advice)","DOR (Discharge On Request)"])}</select></label>
      <label class="fld"><span>Date & time requested</span><input class="inp" id="lm_when" type="datetime-local" value="${new Date().toISOString().slice(0,16)}"></label>
    </div>
    <label class="fld"><span>Requested by (name) <span class="req">*</span></span><input class="inp" id="lm_name"></label>
    <div class="grid2"><label class="fld"><span>CNIC <span class="req">*</span></span><input class="inp" id="lm_cnic"></label>
      <label class="fld"><span>Relationship to patient <span class="req">*</span></span><input class="inp" id="lm_rel"></label></div>
    <label class="fld"><span>Witness name</span><input class="inp" id="lm_witness"></label>
    <label class="fld"><span>Clinical condition / risks explained</span><textarea class="inp" id="lm_note" rows="2">Risks of leaving against medical advice explained to the patient and attendant.</textarea></label>`,
    okText:"Confirm & archive",okClass:"danger",onOk:()=>{
      if(!mval("lm_name")||!mval("lm_cnic")||!mval("lm_rel")){ toast("Requester name, CNIC and relationship are required.","err"); return false; }
      const type=mval("lm_type").startsWith("DOR")?"DOR":"LAMA";
      const whenIso=new Date(mval("lm_when")||now()).toISOString();
      p.preDischargeStatus=p.status;
      p.status="Discharged"; p.archived=true; p.outcome=type; p.dischargeStatus="Discharged"; p.dischargedAt=whenIso;
      p.lama={type,requestedAt:whenIso,by:mval("lm_name"),cnic:mval("lm_cnic"),rel:mval("lm_rel"),witness:mval("lm_witness"),note:mval("lm_note"),recordedBy:currentUser().name}; saveDB();
      addTimeline(id,"discharge",type+" recorded","Requested by "+mval("lm_name")+" ("+mval("lm_rel")+")","amber");
      audit(type,p.name+" — requested by "+mval("lm_name"));
      notify(type+": "+p.name,id,"info");
      toast("Recorded and archived.","ok"); route("patients"); }});
}

/* Record death — captures every required field; requires PASSWORD re-authentication before saving
   (Additional Modifications §5). Auto-archives. */
function openDeath(id){ const p=byId("patients",id);
  modal({title:"Record death — "+p.name,wide:true,body:`
    <p class="muted" style="margin:0 0 12px;font-size:12px">This is an irreversible action. All fields are recorded with the declaring user, date and time. You must confirm your password to save.</p>
    <div class="grid2">
      <label class="fld"><span>Date & time of death <span class="req">*</span></span><input class="inp" id="de_time" type="datetime-local" value="${new Date().toISOString().slice(0,16)}"></label>
      <label class="fld"><span>Autopsy recommended</span><select class="inp" id="de_autopsy">${OPT(["No","Yes"])}</select></label>
    </div>
    <label class="fld"><span>Primary cause of death <span class="req">*</span></span><input class="inp" id="de_cause1"></label>
    <div class="grid2">
      <label class="fld"><span>Secondary cause</span><input class="inp" id="de_cause2"></label>
      <label class="fld"><span>Tertiary cause</span><input class="inp" id="de_cause3"></label>
    </div>
    <div class="divider"></div>
    <div class="k muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Body handover</div>
    <label class="fld"><span>Date & time of body handing over</span><input class="inp" id="de_handover" type="datetime-local"></label>
    <div class="grid2">
      <label class="fld"><span>Attendant receiving body (name)</span><input class="inp" id="de_attname"></label>
      <label class="fld"><span>Attendant CNIC</span><input class="inp" id="de_attcnic"></label>
    </div>
    <div class="divider"></div>
    <div class="grid2">
      <label class="fld"><span>Doctor declaring death (name) <span class="req">*</span></span><input class="inp" id="de_docname" value="${esc(currentUser().name)}"></label>
      <label class="fld"><span>PMDC number</span><input class="inp" id="de_pmdc"></label>
    </div>
    <div class="divider"></div>
    <label class="fld"><span>Confirm your password <span class="req">*</span></span><input class="inp" id="de_pw" type="password" autocomplete="current-password"></label>
    <div id="de_err" class="hidden" style="color:var(--red);font-size:12.5px;margin-top:4px"></div>`,
    okText:"Record death & archive",okClass:"danger",onOk:async()=>{
      const err=document.getElementById("de_err"); const showErr=m=>{err.textContent=m;err.classList.remove("hidden");};
      if(!mval("de_cause1")){ showErr("Primary cause of death is required."); return false; }
      if(!mval("de_pw")){ showErr("Enter your password to confirm."); return false; }
      const vr=await api("POST","/api/auth/verify-password",{password:mval("de_pw")});
      if(!vr.ok){ showErr((vr.data&&vr.data.error)||"Incorrect password. No changes saved."); return false; }
      const deathIso=new Date(mval("de_time")||now()).toISOString();
      p.status="Discharged"; p.archived=true; p.outcome="Died"; p.dischargeStatus="Discharged"; p.dischargedAt=deathIso;
      p.death={
        at:deathIso, autopsy:mval("de_autopsy"),
        cause1:mval("de_cause1"), cause2:mval("de_cause2"), cause3:mval("de_cause3"),
        handoverAt:mval("de_handover")?new Date(mval("de_handover")).toISOString():null,
        attendantName:mval("de_attname"), attendantCnic:mval("de_attcnic"),
        declaredBy:mval("de_docname"), pmdc:mval("de_pmdc"),
        recordedBy:currentUser().name, recordedAt:now()
      }; saveDB();
      addTimeline(id,"discharge","Death recorded",mval("de_cause1"),"red");
      audit("Record death",p.name+" — "+mval("de_cause1"));
      notify("Death recorded: "+p.name,id,"critical");
      toast("Death recorded and archived.","ok"); route("patients");
    }});
}

/* Cancel an accidental discharge or LAMA and restore the patient to the active ward
   (Additional Modifications §4). Not available for deceased patients. */
function cancelDischarge(id){ const p=byId("patients",id); if(!p)return;
  if(p.outcome==="Died"){ toast("Death records cannot be cancelled.","err"); return; }
  if(!(can("discharge")||currentUser().role==="admin")){ toast("You are not authorised to cancel this.","err"); return; }
  const isLama=(p.outcome==="LAMA"||p.outcome==="DOR");
  const label=isLama?("Cancel "+p.outcome):"Cancel discharge";
  modal({title:label+" — "+p.name,narrow:true,body:`
    <p class="muted" style="margin:0 0 12px">This restores the patient to the active ward list and reverses the ${isLama?p.outcome:"discharge"}. All admission data is retained. A reason is recorded in the audit log.</p>
    <label class="fld"><span>Reason for cancellation <span class="req">*</span></span><textarea class="inp" id="cx_reason" rows="2"></textarea></label>`,
    okText:"Restore to active",okClass:"danger",onOk:()=>{
      const reason=mval("cx_reason"); if(!reason){ toast("Please give a reason for the cancellation.","err"); return false; }
      const was=p.outcome;
      p.archived=false; p.status=p.preDischargeStatus||"Post-operative"; p.priority=priorityFromStatus(p.status);
      p.outcome=null; p.dischargedAt=null; p.dischargeStatus=null;
      delete p.dischargeSummary; delete p.lama; saveDB();
      addTimeline(id,"discharge",(isLama?was+" cancelled":"Discharge cancelled"),reason,"amber");
      audit(isLama?"Cancel "+was:"Cancel discharge",p.name+" — "+reason);
      notify((isLama?was+" cancelled":"Discharge cancelled")+": "+p.name,id,"info");
      toast("Patient restored to the active list.","ok"); route("patient",{id});
    }});
}

/* On-screen discharge record (view), with a Print button that produces the formal document */
function viewDischargeSummary(id){
  const p=byId("patients",id); if(!p)return;
  const row=(k,v)=>v?`<div style="margin:2px 0"><b>${esc(k)}:</b> ${esc(v)}</div>`:"";
  const sec=(t,v)=>v?`<h3 style="margin:14px 0 4px;font-size:13px;border-bottom:1px solid var(--line);padding-bottom:3px">${esc(t)}</h3><div style="white-space:pre-wrap;font-size:12.5px">${esc(v)}</div>`:"";
  let body=`<div style="font-size:12.5px;line-height:1.5">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-weight:700;font-size:15px">${esc(DB.config.hospital||"")}</div>
      <div style="color:var(--ink-2)">${esc(DB.config.ward||"")} — Discharge record</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 24px">
      ${row("Name",p.name)}${row("Registration No",p.mrn)}
      ${row("Age / Gender",p.age+" / "+p.gender)}${row("Contact",p.mobile)}
      ${row("Consultant",p.consultant)}${row("Bed",p.bed)}
      ${row("Admitted",fmtDate(p.admittedAt))}${row("Discharged",fmtDate(p.dischargedAt))}
      ${row("Length of stay",losText(p.admittedAt,p.dischargedAt||now()))}${row("Outcome",p.outcome)}
    </div>`;
  if(p.outcome==="Discharged"&&p.dischargeSummary){ const s=p.dischargeSummary;
    body+=sec("Final diagnosis",s.finalDx)+sec("Secondary diagnoses",s.secondaryDx)+sec("Comorbidities",s.comorbidities)
      +sec("Operations & procedures",s.procedures)+sec("Hospital course",s.hospitalCourse)
      +sec("Investigation summary",s.investigations)+sec("Medication summary",s.medicationSummary);
    if(s.rx&&s.rx.length){ body+=`<h3 style="margin:14px 0 4px;font-size:13px;border-bottom:1px solid var(--line);padding-bottom:3px">Discharge medications</h3>
      <table class="tbl" style="font-size:12px"><thead><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Route</th><th>Instructions</th></tr></thead>
      <tbody>${s.rx.map(m=>`<tr style="cursor:default"><td>${esc(m.name)}</td><td>${esc(m.dose)}</td><td>${esc(m.freq)}</td><td>${esc(m.duration)}</td><td>${esc(m.route)}</td><td>${esc(m.remarks)}</td></tr>`).join("")}</tbody></table>`;
    } else body+=sec("Discharge medications",s.dischargeMeds);
    body+=sec("Pending investigations & follow-up",s.pending)+sec("Follow-up advice",s.followup)+sec("Special instructions",s.instructions)+sec("Condition on discharge",s.condition);
    body+=`<h3 style="margin:14px 0 4px;font-size:13px;border-bottom:1px solid var(--line);padding-bottom:3px">Approval</h3>
      ${row("Prepared by",s.preparedBy)}${row("Consultant approval",s.approvalOverride?("OVERRIDDEN — "+s.overrideReason):s.consultant)}${row("Comments",s.approvalComments)}${row("Finalised",fmtDT(s.finalizedAt))}`;
  } else if(p.outcome==="Died"&&p.death){ const d=p.death;
    body+=sec("Date & time of death",fmtDT(d.at))+sec("Primary cause",d.cause1)+sec("Secondary cause",d.cause2)+sec("Tertiary cause",d.cause3)
      +sec("Autopsy recommended",d.autopsy)
      +sec("Body handed over",d.handoverAt?fmtDT(d.handoverAt):"")+sec("Attendant receiving body",d.attendantName?(d.attendantName+(d.attendantCnic?" — CNIC "+d.attendantCnic:"")):"")
      +sec("Declared by",(d.declaredBy||"")+(d.pmdc?" (PMDC "+d.pmdc+")":""));
  } else if((p.outcome==="LAMA"||p.outcome==="DOR")&&p.lama){ const l=p.lama;
    body+=sec("Type",l.type)+sec("Requested at",fmtDT(l.requestedAt))
      +sec("Requested by",(l.by||"")+(l.cnic?" — CNIC "+l.cnic:"")+(l.rel?" ("+l.rel+")":""))+sec("Witness",l.witness)+sec("Notes",l.note)+sec("Recorded by",l.recordedBy);
  }
  body+=`</div>`;
  modal({title:"Discharge record — "+p.name,wide:true,body,okText:"Print / Save PDF",okClass:"primary",onOk:()=>{ printDischargeDoc(id); return false; }});
}

/* ============ Professional A4 printable documents (Additional Modifications §2) ============ */
const PRINT_CSS = `
@page { size: A4; margin: 16mm 15mm; }
* { box-sizing:border-box; }
body { font-family:'Times New Roman', Georgia, serif; color:#111; font-size:12.5px; line-height:1.5; margin:0; }
.doc { width:100%; }
.hdr { text-align:center; border-bottom:2.5px solid #0f766e; padding-bottom:8px; margin-bottom:6px; }
.hdr .hosp { font-size:22px; font-weight:700; letter-spacing:.5px; color:#0f4f4a; }
.hdr .ward { font-size:13px; color:#333; margin-top:2px; }
.hdr .addr { font-size:11px; color:#777; }
.title { text-align:center; font-size:14px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:10px 0 12px; padding:5px; background:#f0fdfa; border:1px solid #99f6e4; border-radius:3px; }
table.demog { width:100%; border-collapse:collapse; margin-bottom:12px; }
table.demog td { padding:4px 8px; font-size:12px; vertical-align:top; border:1px solid #d9d9d9; }
table.demog td.lbl { background:#f6f6f6; font-weight:700; width:19%; white-space:nowrap; color:#333; }
.sec { margin:10px 0; page-break-inside:avoid; }
.sec h4 { margin:0 0 3px; font-size:12px; color:#0f4f4a; border-bottom:1px solid #ccc; padding-bottom:2px; text-transform:uppercase; letter-spacing:.6px; }
.sec .b { white-space:pre-wrap; font-size:12px; }
table.rx { width:100%; border-collapse:collapse; font-size:11.5px; margin-top:4px; }
table.rx th, table.rx td { border:1px solid #b9b9b9; padding:4px 6px; text-align:left; vertical-align:top; }
table.rx th { background:#f0fdfa; font-weight:700; }
.decl { border:1px solid #ccc; padding:11px 13px; font-size:12px; margin:12px 0; background:#fafafa; line-height:1.6; }
.signs { display:flex; flex-wrap:wrap; justify-content:space-between; gap:18px 24px; margin-top:42px; }
.sign { flex:1 1 40%; min-width:150px; }
.sign .line { border-top:1px solid #333; margin-top:34px; padding-top:4px; font-size:11px; font-weight:600; }
.bottom { display:flex; justify-content:space-between; align-items:flex-end; margin-top:30px; gap:20px; }
.stamp { border:1px dashed #9a9a9a; border-radius:6px; height:96px; width:210px; display:flex; align-items:center; justify-content:center; color:#b0b0b0; font-size:11px; }
.foot { margin-top:14px; font-size:10px; color:#8a8a8a; text-align:center; border-top:1px solid #eee; padding-top:6px; }
`;
function openPrintWindow(title, innerHTML){
  const w=window.open("","_blank");
  if(!w){ toast("Pop-up blocked — allow pop-ups for this site to print or save as PDF.","err"); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head>
    <body><div class="doc">${innerHTML}</div><div class="foot">Generated by SUMS · ${esc(fmtDT(now()))} · ${esc(currentUser()?currentUser().name:"")}</div></body></html>`);
  w.document.close(); w.focus(); setTimeout(()=>w.print(),350);
}
function docHeader(docTitle){
  return `<div class="hdr"><div class="hosp">${esc(DB.config.hospital||"Hospital")}</div>
    <div class="ward">${esc(DB.config.ward||"")}</div>
    <div class="addr">Department of Surgery</div></div>
    <div class="title">${esc(docTitle)}</div>`;
}
function demogRows(pairs){
  return `<table class="demog"><tbody>${pairs.map(r=>`<tr>${r.map(c=>`<td class="lbl">${esc(c[0])}</td><td>${esc(c[1]||"—")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function psec(title, val){ return val?`<div class="sec"><h4>${esc(title)}</h4><div class="b">${esc(val)}</div></div>`:""; }
function signBlock(lines){ return `<div class="signs">${lines.map(l=>`<div class="sign"><div class="line">${esc(l)}</div></div>`).join("")}</div>`; }

function printDischargeDoc(id){
  const p=byId("patients",id); if(!p)return;
  if(p.outcome==="Died") return printDeathRecord(p);
  if(p.outcome==="LAMA"||p.outcome==="DOR") return printLAMACert(p);
  return printDischargeSlip(p);
}
function printDischargeSlip(p){
  const s=p.dischargeSummary||{};
  let rx="";
  if(s.rx&&s.rx.length){
    rx=`<div class="sec"><h4>Discharge Medications</h4><table class="rx"><thead><tr><th>#</th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Route</th><th>Instructions</th></tr></thead><tbody>${
      s.rx.map((m,i)=>`<tr><td>${i+1}</td><td>${esc(m.name)}</td><td>${esc(m.dose)}</td><td>${esc(m.freq)}</td><td>${esc(m.duration)}</td><td>${esc(m.route)}</td><td>${esc(m.remarks)}</td></tr>`).join("")}</tbody></table></div>`;
  } else if(s.dischargeMeds){ rx=psec("Discharge Medications",s.dischargeMeds); }
  const html=docHeader("Discharge Slip")
    +demogRows([
      [["Name",p.name],["Reg. No",p.mrn]],
      [["Age / Sex",p.age+" / "+p.gender],["Contact",p.mobile]],
      [["Consultant",p.consultant],["Ward / Bed",(DB.config.ward||"")+" / "+p.bed]],
      [["Admission Date",fmtDate(p.admittedAt)],["Discharge Date",fmtDate(p.dischargedAt)]],
      [["Length of Stay",losText(p.admittedAt,p.dischargedAt||now())],["Condition at Discharge",s.condition]]
    ])
    +psec("Final Diagnosis",s.finalDx)+psec("Secondary Diagnoses",s.secondaryDx)+psec("Comorbidities",s.comorbidities)
    +psec("Procedures Performed",s.procedures)+psec("Hospital Course / Summary",s.hospitalCourse)
    +psec("Investigations",s.investigations)
    +rx
    +psec("Follow-up Advice",s.followup)+psec("Special Instructions",s.instructions)
    +(s.pending?psec("Pending Investigations",s.pending):"")
    +signBlock(["Signature — House Officer","Signature — Resident / Registrar"])
    +`<div class="bottom"><div style="font-size:11px;color:#555">Prepared by: ${esc(s.preparedBy||"")}<br>Consultant: ${esc(s.consultant||p.consultant||"")}</div><div class="stamp">Hospital Stamp</div></div>`;
  openPrintWindow("Discharge Slip — "+p.name, html);
}
function printLAMACert(p){
  const l=p.lama||{}; const typeFull=l.type==="DOR"?"Discharge On Request (DOR)":"Leave Against Medical Advice (LAMA)";
  const decl=`I, <b>${esc(l.by||"____________")}</b> (CNIC ${esc(l.cnic||"____________")}), being the <b>${esc(l.rel||"____________")}</b> of the patient
    named above, hereby request discharge ${l.type==="DOR"?"on request":"against medical advice"}. The attending medical team has clearly explained
    to me the patient's condition and the potential risks and consequences of leaving the hospital at this time, including the risk to life.
    I take full responsibility for this decision and release the hospital and its staff from any liability arising from it.`;
  const html=docHeader(typeFull+" Certificate")
    +demogRows([
      [["Name",p.name],["Reg. No",p.mrn]],
      [["Age / Sex",p.age+" / "+p.gender],["Diagnosis",p.dx]],
      [["Admission Date",fmtDate(p.admittedAt)],["Date & Time of "+(l.type||"LAMA"),fmtDT(l.requestedAt||p.dischargedAt)]]
    ])
    +psec("Brief Clinical Condition",l.note)
    +`<div class="sec"><h4>Declaration</h4><div class="decl">${decl}</div></div>`
    +signBlock(["Signature — Patient / Attendant","Signature — Witness"+(l.witness?" ("+esc(l.witness)+")":""),"Signature — House Officer","Signature — Resident / Registrar"])
    +`<div class="bottom"><div style="font-size:11px;color:#555">Recorded by: ${esc(l.recordedBy||"")}</div><div class="stamp">Hospital Stamp</div></div>`;
  openPrintWindow(typeFull+" — "+p.name, html);
}
function printDeathRecord(p){
  const d=p.death||{};
  const html=docHeader("Death Record / Certificate")
    +demogRows([
      [["Name",p.name],["Reg. No",p.mrn]],
      [["Age / Sex",p.age+" / "+p.gender],["Consultant",p.consultant]],
      [["Admission Date",fmtDate(p.admittedAt)],["Date & Time of Death",fmtDT(d.at)]]
    ])
    +psec("Primary Cause of Death",d.cause1)+psec("Secondary Cause",d.cause2)+psec("Tertiary Cause",d.cause3)
    +psec("Autopsy Recommended",d.autopsy)
    +psec("Body Handed Over",d.handoverAt?fmtDT(d.handoverAt):"")
    +psec("Attendant Receiving Body",d.attendantName?(d.attendantName+(d.attendantCnic?" (CNIC "+d.attendantCnic+")":"")):"")
    +psec("Death Declared By",(d.declaredBy||"")+(d.pmdc?" — PMDC No. "+d.pmdc:""))
    +signBlock(["Signature — House Officer","Signature — Resident / Registrar"])
    +`<div class="bottom"><div style="font-size:11px;color:#555">Recorded by: ${esc(d.recordedBy||"")}</div><div class="stamp">Hospital Stamp</div></div>`;
  openPrintWindow("Death Record — "+p.name, html);
}

/* ---------------- photo upload ---------------- */
function handlePhoto(file,pid){
  if(!file)return; if(file.size>8*1024*1024){toast("Image too large (max 8MB).","err");return;}
  const reader=new FileReader();
  reader.onload=e=>{ const img=new Image(); img.onload=()=>{
    const max=900; let{width:w,height:h}=img; if(w>max||h>max){const r=Math.min(max/w,max/h);w=w*r|0;h=h*r|0;}
    const cv=document.createElement("canvas");cv.width=w;cv.height=h;cv.getContext("2d").drawImage(img,0,0,w,h);
    const data=cv.toDataURL("image/jpeg",0.72);
    modal({title:"Label photo",narrow:true,body:`<img src="${data}" style="width:100%;border-radius:8px;margin-bottom:12px">
      <label class="fld"><span>Label</span><input class="inp" id="ph_lbl" placeholder="e.g. Wound POD 2" value="Clinical photo"></label>`,
      okText:"Save",onOk:()=>{ insert("photos",{id:uid(),patientId:pid,data,label:mval("ph_lbl"),by:currentUser().name,at:now()});
        addTimeline(pid,"photo","Clinical photo added",mval("ph_lbl"),"blue"); audit("Upload photo",patientName(pid));
        toast("Photo saved.","ok"); render(); }});
  }; img.src=e.target.result; };
  reader.readAsDataURL(file);
}

/* ---------------- users / admin (§4.7, §4.12) ---------------- */
function openUserForm(edit){
  const u=edit?byId("users",edit):{};
  const isAdminAcct=edit&&u.role==="admin";
  const roles=ROLE_ORDER.map(r=>`<option value="${r}"${u.role===r?" selected":""}>${ROLES[r].label}</option>`).join("");
  // per-user override editor rows (Default / Allow / Deny) — not shown for admin accounts
  const ovRows=isAdminAcct?"":PERMS.filter(p=>p.key!=="userMgmt"&&p.key!=="viewPatients").map(p=>{
    const cur=(u.permOverrides&&Object.prototype.hasOwnProperty.call(u.permOverrides,p.key))?(u.permOverrides[p.key]?"allow":"deny"):"default";
    return `<tr style="cursor:default"><td style="padding:4px 8px;font-size:12px">${esc(p.label)}</td>
      <td style="padding:4px 8px"><select class="inp ov-cell" data-perm="${p.key}" style="padding:3px 6px;font-size:11.5px">
        <option value="default"${cur==="default"?" selected":""}>Role default (${matrixVal(u.role||"readonly",p.key)})</option>
        <option value="allow"${cur==="allow"?" selected":""}>Allow</option>
        <option value="deny"${cur==="deny"?" selected":""}>Deny</option></select></td></tr>`;}).join("");
  modal({title:edit?"Edit user":"Add user",wide:true,body:`
    <div class="grid2">
      <label class="fld"><span>Full name <span class="req">*</span></span><input class="inp" id="u_name" value="${esc(u.name||"")}"></label>
      <label class="fld"><span>Username <span class="req">*</span></span><input class="inp mono" id="u_username" value="${esc(u.username||"")}" ${edit?"disabled":""}></label>
      <label class="fld"><span>Role <span class="req">*</span></span><select class="inp" id="u_role" ${isAdminAcct?"disabled":""}>${roles}</select></label>
      <label class="fld"><span>Designation</span><input class="inp" id="u_desig" value="${esc(u.desig||"")}"></label>
      <label class="fld"><span>Employee ID</span><input class="inp" id="u_emp" value="${esc(u.emp||"")}"></label>
      <label class="fld"><span>Contact number</span><input class="inp" id="u_contact" value="${esc(u.contact||"")}"></label>
      <label class="fld"><span>Email address</span><input class="inp" id="u_email" value="${esc(u.email||"")}"></label>
    </div>
    ${edit?"":`<label class="fld"><span>Temporary password <span class="req">*</span></span><input class="inp" id="u_pw" value="temp1234"></label>
      <p class="muted" style="font-size:12px;margin:0 0 6px">Min 8 chars incl. a letter and a digit. User must change it at first login (§4.8).</p>`}
    ${isAdminAcct?`<p class="muted" style="font-size:12px">Administrator privileges cannot be modified (§4.3.1).</p>`:`
    <div class="divider"></div>
    <div class="k muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Individual permission overrides (§4.2)</div>
    <div class="tbl-wrap" style="max-height:200px"><table class="tbl" style="font-size:12px"><tbody>${ovRows}</tbody></table></div>`}`,
    okText:edit?"Save":"Create user",onOk:async()=>{
      const name=mval("u_name"),un=mval("u_username").toLowerCase(); if(!name||(!edit&&!un)){toast("Name & username required.","err");return false;}
      const role=isAdminAcct?"admin":mval("u_role");
      // gather overrides
      const overrides={}; if(!isAdminAcct)document.querySelectorAll(".ov-cell").forEach(s=>{ if(s.value==="allow")overrides[s.getAttribute("data-perm")]=true; else if(s.value==="deny")overrides[s.getAttribute("data-perm")]=false; });
      if(edit){
        const roleChanged=u.role!==role, ovChanged=JSON.stringify(u.permOverrides||{})!==JSON.stringify(overrides);
        u.name=name;u.desig=mval("u_desig")||ROLES[role].label;u.emp=mval("u_emp");u.contact=mval("u_contact");u.email=mval("u_email");
        if(!isAdminAcct){u.role=role;u.permOverrides=overrides;} saveDB();
        audit("Edit user",name);
        if(roleChanged)audit("Role assignment",name+" → "+ROLES[role].label);
        if(ovChanged)audit("Permission changes","Overrides updated for "+name);
        toast("Saved.","ok"); render();
      } else {
        if(coll("users").some(x=>x.username===un)){toast("Username taken.","err");return false;}
        const pw=mval("u_pw")||"temp1234";
        if(pw.length<(DB.config.pwMinLen||8)||!/[a-zA-Z]/.test(pw)||!/\d/.test(pw)){toast("Temp password too weak (min 8, letter + digit).","err");return false;}
        const hash=await hashPw(pw);
        const nu=insert("users",{id:uid(),name,username:un,role,desig:mval("u_desig")||ROLES[role].label,
          emp:mval("u_emp"),contact:mval("u_contact"),email:mval("u_email"),permOverrides:overrides,pw:hash,status:"active",
          mustChange:true,created:now(),createdBy:currentUser().name,lastLogin:null,failed:0,sessionEpoch:0});
        audit("Account creation",name+" ("+ROLES[role].label+")"); audit("Account activation",name);
        toast("User created.","ok"); render();
      }
    }});
}
function openUserLifecycle(uid_){ const u=byId("users",uid_);
  const act=(label,st,cls)=>`<button class="btn" style="justify-content:flex-start;width:100%" data-life="${st}" data-id="${uid_}">${label}</button>`;
  modal({title:"Account lifecycle · "+u.name,body:`
    <p class="muted" style="margin:0 0 12px">Current status: <span class="badge ${statusBadge(u.status)}">${esc(u.status)}</span> · every change is audited (§4.6).</p>
    <div class="stack">
      ${u.status!=="active"?act("Activate account","active"):""}
      ${u.status==="active"?act("Lock account","locked"):""}
      ${u.status==="locked"?act("Unlock account","active"):""}
      ${u.status!=="deactivated"&&u.status!=="archived"?act("Deactivate account","deactivated"):""}
      ${u.status!=="archived"?act("Archive account","archived"):""}
      <button class="btn" style="justify-content:flex-start;width:100%" data-life="terminate" data-id="${uid_}">Terminate active sessions</button>
    </div>`,hideFooter:true});
}
function applyLifecycle(uid_,st){ const u=byId("users",uid_); closeModal();
  if(st==="terminate"){ invalidateSessions(u); audit("Session terminated",u.name); toast("Sessions terminated.","ok");
    if(!SESSION){render();return;} render(); return; }
  const map={active:"Account activation",locked:"Account lock",deactivated:"Account deactivation",archived:"Account archive"};
  u.status=st; if(st!=="active"){ invalidateSessions(u); } if(st==="active")u.failed=0; saveDB();
  audit(map[st]||"Status change",u.name); toast("Account "+st+".","ok"); render();
}
function resetPw(uid_){ const u=byId("users",uid_);
  modal({title:"Reset password",narrow:true,body:`<p style="margin:0 0 12px">Set a temporary password for <b>${esc(u.name)}</b>. All their active sessions will be invalidated (§4.10).</p>
    <label class="fld"><span>Temporary password</span><input class="inp" id="rp_pw" value="temp1234"></label>`,
    okText:"Reset",onOk:async()=>{ const pw=mval("rp_pw")||"temp1234";
      if(pw.length<(DB.config.pwMinLen||8)||!/[a-zA-Z]/.test(pw)||!/\d/.test(pw)){toast("Too weak (min 8, letter + digit).","err");return false;}
      u.pw=await hashPw(pw); u.mustChange=true; invalidateSessions(u);
      audit("Password reset",u.name+" (forced change on next login)"); toast("Password reset.","ok");
      if(!SESSION)render(); else render(); }});
}
function editMyContact(){ const u=currentUser();
  modal({title:"Update contact information",body:`
    <label class="fld"><span>Contact number</span><input class="inp" id="mc_contact" value="${esc(u.contact||"")}"></label>
    <label class="fld"><span>Email address</span><input class="inp" id="mc_email" value="${esc(u.email||"")}"></label>`,
    okText:"Save",onOk:()=>{ u.contact=mval("mc_contact");u.email=mval("mc_email");saveDB();
      audit("Update profile","Contact info"); toast("Updated.","ok"); render(); }});
}
function openChangePw(forced){
  const minLen=DB.config.pwMinLen||8;
  modal({title:forced?"Set a new password":"Change password",narrow:true,hideFooter:false,body:`
    ${forced?`<p class="muted" style="margin:0 0 12px">Please set a new password to continue.</p>`:`<label class="fld"><span>Current password</span><input class="inp" id="cp_old" type="password"></label>`}
    <label class="fld"><span>New password <span class="req">*</span></span><input class="inp" id="cp_new" type="password"></label>
    <label class="fld"><span>Confirm new password</span><input class="inp" id="cp_conf" type="password"></label>
    <p class="muted" style="font-size:11.5px;margin:0">Minimum ${minLen} characters, at least one letter and one digit (§4.9).</p>`,
    okText:"Update password",onOk:async()=>{ const u=currentUser();
      if(!forced){ const oldH=await hashPw(mval("cp_old")); if(oldH!==u.pw){toast("Current password wrong.","err");return false;} }
      const np=mval("cp_new"); if(np.length<minLen||!/[a-zA-Z]/.test(np)||!/\d/.test(np)){toast("Min "+minLen+" chars with a letter and a digit.","err");return false;}
      if(np!==mval("cp_conf")){toast("Passwords don't match.","err");return false;}
      u.pw=await hashPw(np); u.mustChange=false; u.sessionEpoch=Date.now(); saveDB();
      if(SESSION){SESSION.epoch=u.sessionEpoch;localStorage.setItem(SESSION_KEY,JSON.stringify(SESSION));}
      audit("Password change",""); toast("Password updated.","ok"); }});
}


/* ================= EVENT BINDING ================= */
function bindShell(){
  // nav
  document.querySelectorAll("[data-nav]").forEach(el=>el.addEventListener("click",e=>{
    if(e.target.closest("#logoutBtn"))return;
    const n=el.getAttribute("data-nav"); route(n); closeSidebar();
  }));
  const lo=document.getElementById("logoutBtn"); if(lo)lo.onclick=e=>{e.stopPropagation();logout();};
  const mb=document.getElementById("menuBtn"); if(mb)mb.onclick=()=>{document.getElementById("sidebar").classList.toggle("open");
    if(document.getElementById("sidebar").classList.contains("open"))addBackdrop();else closeSidebar();};
  const bell=document.getElementById("bellBtn"); if(bell)bell.onclick=()=>route("notifications");
  // global search
  const gs=document.getElementById("gsearch");
  if(gs){ gs.addEventListener("input",()=>{ SEARCH_Q=gs.value; SEARCH_OPEN=true;
      const box=document.getElementById("searchRes"); const res=runSearch(SEARCH_Q);
      if(!SEARCH_Q){box.classList.add("hidden");return;}
      box.classList.remove("hidden");
      box.innerHTML=res.length?res.map(r=>`<div class="sr" data-pt="${r.id}"><span class="badge teal">${r.type}</span>
        <div><b>${esc(r.title)}</b><div class="muted" style="font-size:11.5px">${esc(r.sub)}</div></div></div>`).join("")
        :`<div class="sr muted">No matches for "${esc(SEARCH_Q)}"</div>`;
      box.querySelectorAll("[data-pt]").forEach(x=>x.onclick=()=>{SEARCH_Q="";SEARCH_OPEN=false;route("patient",{id:x.getAttribute("data-pt")});});
    });
    gs.addEventListener("blur",()=>setTimeout(()=>{const b=document.getElementById("searchRes");if(b)b.classList.add("hidden");},180));
  }
}
function addBackdrop(){ if(document.getElementById("sbBackdrop"))return; const b=document.createElement("div");
  b.className="sb-backdrop";b.id="sbBackdrop";b.onclick=closeSidebar;document.body.appendChild(b); }
function closeSidebar(){ const sb=document.getElementById("sidebar");if(sb)sb.classList.remove("open");
  const b=document.getElementById("sbBackdrop");if(b)b.remove(); }

function bindPage(){
  // patient card / row / anything with data-pt -> open profile
  document.querySelectorAll("[data-pt]").forEach(el=>{
    if(el.closest(".search-res")||el.closest(".topbar"))return;
    el.addEventListener("click",e=>{ const id=el.getAttribute("data-pt"); if(!id)return;
      if(e.target.closest("[data-act]")||e.target.closest("button")&&!e.target.closest("[data-pt]")===false&&e.target.closest("button").hasAttribute("data-act"))return;
      route("patient",{id}); });
  });
  // data-go navigation
  document.querySelectorAll("[data-go]").forEach(el=>el.addEventListener("click",e=>{e.stopPropagation();const g=el.getAttribute("data-go");if(g)route(g);}));
  // profile tabs
  document.querySelectorAll("[data-tab]").forEach(el=>el.onclick=()=>{ PROF_TAB=el.getAttribute("data-tab");
    document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("on",x===el));
    const p=byId("patients",ROUTE.params.id); document.getElementById("tabBody").innerHTML=renderTab(p); bindPage(); });
  // admin sub-tabs
  document.querySelectorAll("[data-atab]").forEach(el=>el.onclick=()=>{ ADMIN_TAB=el.getAttribute("data-atab"); render(); });
  // permission matrix cells (§4.5 configurable)
  document.querySelectorAll(".mx-cell").forEach(sel=>sel.onchange=()=>{ const role=sel.getAttribute("data-role"),perm=sel.getAttribute("data-perm");
    const m=getMatrix(); (m[role]=m[role]||{})[perm]=sel.value; apiSaveMatrix(PERM_LABEL(perm)+" · "+ROLES[role].label+" → "+sel.value);
    const c=sel.value; sel.style.borderColor=stateGranted(c)?"var(--green)":c==="no"?"var(--line)":"var(--amber)"; });
  // view toggle / sort / filters
  document.querySelectorAll("[data-view]").forEach(el=>el.onclick=()=>{PT_VIEW=el.getAttribute("data-view");render();});
  document.querySelectorAll("[data-show]").forEach(el=>el.onclick=()=>{PT_SHOW=el.getAttribute("data-show");PT_FILTER={status:null,priority:null,gender:null};render();});
  const ps=document.getElementById("ptSort"); if(ps)ps.onchange=()=>{PT_SORT=ps.value;render();};
  const psrch=document.getElementById("ptSearch"); if(psrch)psrch.oninput=()=>{ PT_Q=psrch.value; const pos=psrch.selectionStart; render();
    const el=document.getElementById("ptSearch"); if(el){ el.focus(); try{el.setSelectionRange(pos,pos);}catch(e){} } };
  const pf=document.getElementById("ptFrom"); if(pf)pf.onchange=()=>{PT_DFROM=pf.value;render();};
  const ptt=document.getElementById("ptTo"); if(ptt)ptt.onchange=()=>{PT_DTO=ptt.value;render();};
  document.querySelectorAll("[data-filter]").forEach(el=>el.onclick=()=>{ const g=el.getAttribute("data-filter"),v=el.getAttribute("data-val");
    PT_FILTER[g]=PT_FILTER[g]===v?null:v; render(); });
  // audit search
  const as=document.getElementById("auditSearch"); if(as)as.addEventListener("input",()=>{ const q=as.value.toLowerCase();
    const rows=coll("audit").slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).filter(a=>[a.uname,a.action,a.detail].join(" ").toLowerCase().includes(q)).slice(0,300);
    document.getElementById("auditBody").innerHTML=rows.map(a=>`<tr style="cursor:default"><td class="num">${fmtDT(a.at)}</td><td>${esc(a.uname)}</td>
      <td>${esc(ROLES[a.role]?.label||a.role||"")}</td><td><b>${esc(a.action)}</b></td><td>${esc(a.detail)}</td></tr>`).join(""); });
  // chat
  const ci=document.getElementById("chatInput"); if(ci){ci.addEventListener("keydown",e=>{if(e.key==="Enter")sendChat(ci.getAttribute("data-id"));});
    const cs=document.getElementById("chatScroll");if(cs)cs.scrollTop=cs.scrollHeight;}
  // photo input
  const pi=document.getElementById("photoInput"); if(pi)pi.onchange=e=>handlePhoto(e.target.files[0],pi.getAttribute("data-id"));
  const impf=document.getElementById("importFile"); if(impf)impf.onchange=e=>importData(e.target.files[0]);

  // ACTION DISPATCH
  document.querySelectorAll("[data-act]").forEach(el=>el.addEventListener("click",e=>{
    e.stopPropagation(); const act=el.getAttribute("data-act"); const id=el.getAttribute("data-id");
    switch(act){
      case"admit":return openAdmit();
      case"editPatient":return openEditPatient(id);
      case"changeStatus":return openChangeStatus(id);
      case"clearFilter":PT_FILTER={status:null,priority:null,gender:null};PT_Q="";PT_DFROM="";PT_DTO="";return render();
      case"addNote":return openAddNote(id);
      case"addSurgery":return openAddSurgery(id);
      case"editSurgery":return openAddSurgery(byId("surgeries",id).patientId,id);
      case"completeSurgery":return completeSurgery(id);
      case"addMed":return openAddMed(id);
      case"withholdMed":return withholdMed(id);
      case"restartMed":return restartMed(id);
      case"discontinueMed":return discontinueMed(id);
      case"administer":return administer(el.getAttribute("data-mid"),el.getAttribute("data-pid"));
      case"addLab":return openAddLab(id);
      case"resultLab":return resultLab(id);
      case"addIO":return openAddIO(id,el.getAttribute("data-kind"));
      case"addDrain":return openAddDrain(id);
      case"drainOutput":return drainOutput(id);
      case"removeDrain":return removeDrain(id);
      case"addorders":return openAddOrderTask(id,"orders");
      case"addtasks":return openAddOrderTask(id,"tasks");
      case"completeorders":return completeItem("orders",id);
      case"completetasks":return completeItem("tasks",id);
      case"sendChat":return sendChat(id);
      case"delPhoto":return delPhoto(id);
      case"dischargeMenu":return openDischargeMenu(id);
      case"deletePatient":return deletePatientFlow(id);
      case"viewSummary":return viewDischargeSummary(id);
      case"cancelDischarge":return cancelDischarge(id);
      case"deleteUser":return deleteUserFlow(id);
      case"markAllRead":coll("notifications").forEach(n=>n.read=true);saveDB();return render();
      case"changePw":return openChangePw(false);
      case"addUser":return openUserForm();
      case"editUser":return openUserForm(id);
      case"resetPw":return resetPw(id);
      case"userLifecycle":return openUserLifecycle(id);
      case"editMyContact":return editMyContact();
      case"resetMatrix":return confirmModal("Reset permission matrix","Restore all role permissions to the specification defaults? Per-user overrides are kept.","Reset matrix","danger",()=>{apiResetMatrix();});
      case"saveConfig":return saveConfig();
      case"exportData":return exportData();
      case"resetData":return resetData();
    }
  }));
  // notifications mark read on view
  if(ROUTE.name==="notifications"){ setTimeout(()=>{ let ch=false; coll("notifications").forEach(n=>{if(!n.read){n.read=true;ch=true;}}); if(ch)saveDB(); },1200); }
}

function delPhoto(pid){ const ph=byId("photos",pid);
  confirmModal("Delete photo","Permanently delete this clinical photo?","Delete","danger",()=>{ remove("photos",pid);
    audit("Delete photo",""); toast("Deleted.","ok"); render(); }); }

// Delete a patient — restricted to roles with the deletePatient permission,
// confirmed by re-entering the current user's password. Cascades to the
// patient's clinical records so nothing is left orphaned.
function deletePatientFlow(id){ const p=byId("patients",id); if(!p)return;
  if(!can("deletePatient")){ toast("You do not have permission to delete patients.","err"); return; }
  confirmWithPassword("Delete patient",
    "Permanently delete "+p.name+" (MRN "+p.mrn+") and ALL associated clinical records? This cannot be undone.",
    "Delete patient",()=>{
      const kids=["notes","surgeries","meds","mar","labs","io","drains","orders","tasks","chat","photos","timeline","notifications"];
      kids.forEach(c=>coll(c).filter(x=>x.patientId===id).forEach(x=>remove(c,x.id)));
      audit("Delete patient",p.name+" ("+p.mrn+")");
      remove("patients",id);
      toast("Patient deleted.","ok"); route("patients");
    });
}

// Delete a user account — administrators only, with confirmation.
function deleteUserFlow(id){ const u=byId("users",id); if(!u)return;
  confirmModal("Delete user",
    "Permanently delete the account for "+u.name+" ("+u.username+")? This cannot be undone. The user's audit-log history is retained.",
    "Delete user","danger",async()=>{
      const r=await api("DELETE","/api/admin/users/"+id);
      if(!r.ok){ toast((r.data&&r.data.error)||"Could not delete user.","err"); return; }
      await refreshUsers(); audit("Account deletion",u.name); toast("User deleted.","ok"); render();
    });
}

function saveConfig(){ DB.config.ward=mval("cfgWard")||DB.config.ward; DB.config.hospital=mval("cfgHosp")||DB.config.hospital;
  DB.config.capacity=parseInt(mval("cfgCap"))||DB.config.capacity; DB.config.inactivityMin=parseInt(mval("cfgTimeout"))||120;
  DB.config.pwMinLen=Math.max(6,parseInt(mval("cfgPwLen"))||8);
  saveDB(); audit("System configuration","Ward/security settings updated"); toast("Configuration saved.","ok"); render(); }

function exportData(){ const blob=new Blob([JSON.stringify(DB,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download="sums-backup-"+fmtDateInput(now())+".json"; a.click(); URL.revokeObjectURL(a.href);
  audit("Export backup",""); toast("Backup exported.","ok"); }
function importData(file){ if(!file)return; const r=new FileReader();
  r.onload=e=>{ try{ const data=JSON.parse(e.target.result);
    confirmModal("Import backup","This replaces ALL current data with the backup. Continue?","Import","danger",()=>{
      DB=data; COLLECTIONS.forEach(c=>{if(!DB[c])DB[c]=[];}); saveDB(); toast("Backup imported.","ok"); route("dashboard"); });
    }catch(err){ toast("Invalid backup file.","err"); } };
  r.readAsText(file); }
function resetData(){ confirmModal("Reset all data","This permanently deletes every patient, user, and record. This cannot be undone.","Reset everything","danger",()=>{
    localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION_KEY); location.reload(); }); }

/* ================= CLOCK + INACTIVITY ================= */
setInterval(()=>{ const c=document.getElementById("clock");
  if(c)c.textContent=new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}); },20000);

let lastActivity=Date.now();
["click","keydown","mousemove","touchstart"].forEach(ev=>document.addEventListener(ev,()=>lastActivity=Date.now(),{passive:true}));
setInterval(()=>{ if(!SESSION)return; const mins=(Date.now()-lastActivity)/60000;
  if(mins>=(DB.config.inactivityMin||120)){ toast("Signed out due to inactivity.","warn"); logout(); } },30000);

/* one-time delegation for modal-injected lifecycle buttons */
document.addEventListener("click",e=>{ const b=e.target.closest("[data-life]"); if(b){ applyLifecycle(b.getAttribute("data-id"),b.getAttribute("data-life")); } });
document.addEventListener("click",e=>{ const b=e.target.closest("[data-dmenu]"); if(b){ const id=b.getAttribute("data-id"),m=b.getAttribute("data-dmenu"); closeModal(); if(m==="normal")openDischarge(id); else if(m==="lama")openLAMA(id); else openDeath(id); } });

/* ================= BOOT (net layer) ================= */
/* ============================================================
   SUMS — network layer
   Overrides the offline (localStorage) data primitives with a live,
   server-backed, real-time implementation. Loaded AFTER the base app,
   so these definitions win. Every mutation goes to the API and is
   broadcast over WebSocket, so all users see changes instantly.
   ============================================================ */
"use strict";

let ME = null;
let TOKEN = null;
let SOCKET = null;
const SHADOW = {};                 // record id -> JSON snapshot last known to server (for diff-sync)
const RECORD_COLLECTIONS = ["patients","notes","surgeries","meds","mar","labs","io","drains","orders","tasks","chat","photos","timeline","notifications"];
let RENDER_TIMER = null;
let ONLINE = [];

/* ---------- token persistence (survives refresh) ---------- */
function saveToken(t){ TOKEN=t; try{ t?localStorage.setItem("sums_token",t):localStorage.removeItem("sums_token"); }catch(e){} }
function loadToken(){ try{ return localStorage.getItem("sums_token"); }catch(e){ return null; } }

/* ---------- REST helper ---------- */
async function api(method, path, body){
  const headers = { "Content-Type":"application/json" };
  if(TOKEN) headers["Authorization"] = "Bearer "+TOKEN;
  let res;
  try { res = await fetch(path, { method, headers, body: body!=null?JSON.stringify(body):undefined }); }
  catch(e){ toast("Network error — check your connection.","err"); throw e; }
  let data=null; try{ data=await res.json(); }catch(e){}
  if(res.status===401){ handleAuthLoss(); }
  return { status:res.status, ok:res.ok, data };
}
function handleAuthLoss(){
  if(!ME) return;
  ME=null; SESSION=null; saveToken(null);
  if(SOCKET){ try{SOCKET.disconnect();}catch(e){} SOCKET=null; }
  toast("Your session ended. Please sign in again.","err");
  route("login");
}

/* ---------- session / identity (override offline) ---------- */
function currentUser(){ return ME; }
function login(){ /* handled by bindLogin */ }
function logout(){
  api("POST","/api/audit",{ action:"Logout", detail:"" }).catch(()=>{});
  ME=null; SESSION=null; saveToken(null);
  if(SOCKET){ try{SOCKET.disconnect();}catch(e){} SOCKET=null; }
  route("login");
}

/* ---------- record cache primitives (override offline) ---------- */
function stripMeta(o){ const c={...o}; delete c._v; return c; }
function setShadow(o){ if(o&&o.id) SHADOW[o.id]=JSON.stringify(stripMeta(o)); }

// optimistic create + POST
function insert(name,obj){
  obj.id = obj.id || uid();
  if(!RECORD_COLLECTIONS.includes(name)){ (DB[name]=DB[name]||[]).push(obj); return obj; }  // local-only cache (e.g. audit)
  DB[name].push(obj);
  api("POST","/api/records/"+name, stripMeta(obj)).then(r=>{
    if(r.ok && r.data){ obj._v = r.data._v; setShadow(obj); }
    else { DB[name]=DB[name].filter(x=>x.id!==obj.id); toast(r.data&&r.data.error?r.data.error:"Could not save.","err"); scheduleRender(true); }
  }).catch(()=>{ DB[name]=DB[name].filter(x=>x.id!==obj.id); scheduleRender(true); });
  return obj;
}

// optimistic delete + DELETE
function remove(name,id){
  const prev = DB[name];
  DB[name]=DB[name].filter(x=>x.id!==id); delete SHADOW[id];
  if(!RECORD_COLLECTIONS.includes(name)) return;
  api("DELETE","/api/records/"+name+"/"+id).then(r=>{
    if(!r.ok){ DB[name]=prev; toast(r.data&&r.data.error?r.data.error:"Could not delete.","err"); scheduleRender(true); }
  }).catch(()=>{ DB[name]=prev; scheduleRender(true); });
}

// diff-sync: PUT every existing record whose contents changed since last sync
function saveDB(){
  RECORD_COLLECTIONS.forEach(name=>{
    (DB[name]||[]).forEach(obj=>{
      if(obj._v===undefined) return;                       // brand-new (handled by insert)
      const snap = JSON.stringify(stripMeta(obj));
      if(SHADOW[obj.id] === snap) return;                  // unchanged
      SHADOW[obj.id] = snap;                                // mark in-flight to avoid duplicate PUTs
      const payload = { ...stripMeta(obj), _v: obj._v };
      api("PUT","/api/records/"+name+"/"+obj.id, payload).then(r=>{
        if(r.status===409 && r.data && r.data.record){     // concurrent edit — take server copy
          applyServerRecord(name, r.data.record);
          toast("A colleague edited this record — reloaded the latest version.","warn");
          scheduleRender(true);
        } else if(r.ok && r.data){ obj._v=r.data._v; setShadow(obj); }
        else if(!r.ok){ toast(r.data&&r.data.error?r.data.error:"Save failed.","err"); }
      }).catch(()=>{});
    });
  });
}

/* ---------- audit (override offline) ---------- */
function audit(action, detail){
  api("POST","/api/audit",{ action, detail:detail||"" }).then(r=>{
    if(r.ok && r.data){ unshiftAudit(r.data); if(ROUTE&&ROUTE.name==="audit") scheduleRender(); }
  }).catch(()=>{});
}
function unshiftAudit(entry){
  DB.audit = DB.audit || [];
  if(DB.audit.some(a=>a.id===entry.id)) return;
  DB.audit.unshift(entry);
  if(DB.audit.length>800) DB.audit.length=800;
}

/* ---------- apply a record coming from the server ---------- */
function applyServerRecord(name, rec){
  DB[name]=DB[name]||[];
  const i=DB[name].findIndex(x=>x.id===rec.id);
  if(i>=0) DB[name][i]=rec; else DB[name].push(rec);
  setShadow(rec);
}

/* ---------- real-time event handling ---------- */
function applyChange(evt){
  const { collection, op } = evt;
  if(!RECORD_COLLECTIONS.includes(collection)) return;
  DB[collection]=DB[collection]||[];
  if(op==="delete"){ DB[collection]=DB[collection].filter(x=>x.id!==evt.id); delete SHADOW[evt.id]; }
  else if(op==="upsert" && evt.record){ applyServerRecord(collection, evt.record); }
  scheduleRender();
}

// Re-render without disrupting the user: debounce, and defer while a modal
// is open or the user is typing. Chat stays live-scrolled.
function scheduleRender(force){
  clearTimeout(RENDER_TIMER);
  RENDER_TIMER=setTimeout(()=>{
    const modalOpen=!!document.querySelector(".modal-back");
    const ae=document.activeElement;
    const typing=ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type!=="button";
    if(!force && (modalOpen||typing)){ scheduleRender(false); return; }  // try again shortly
    if(SESSION) render(); else render();
  }, force?0:250);
}

/* ---------- bootstrap: hydrate everything after login ---------- */
async function bootstrap(){
  const r = await api("GET","/api/bootstrap");
  if(!r.ok){ throw new Error(r.data&&r.data.error||"Bootstrap failed"); }
  const d=r.data;
  ME = d.me;
  DB = {};
  RECORD_COLLECTIONS.forEach(c=>DB[c]=[]);
  DB.users = d.users || [];
  DB.audit = [];
  DB.config = Object.assign({ seeded:true }, d.config, { matrix: d.matrix });
  Object.keys(d.data||{}).forEach(c=>{
    DB[c]=d.data[c]||[];
    DB[c].forEach(setShadow);
  });
  SESSION = { uid: ME.id, at: now() };
  if(can("auditView")) fetchAudit();
}

async function fetchAudit(q){
  if(!can("auditView")) return;
  const r = await api("GET","/api/admin/audit"+(q?("?q="+encodeURIComponent(q)):""));
  if(r.ok && Array.isArray(r.data)){ DB.audit=r.data; if(ROUTE&&ROUTE.name==="audit") scheduleRender(); }
}

async function refreshUsers(){
  if(!can("userMgmt")) return;
  const r = await api("GET","/api/admin/users");
  if(r.ok && Array.isArray(r.data)){ DB.users=r.data; scheduleRender(); }
}

/* ---------- socket connection ---------- */
function connectSocket(){
  if(SOCKET){ try{SOCKET.disconnect();}catch(e){} }
  SOCKET = io({ auth:{ token: TOKEN } });
  SOCKET.on("change", applyChange);
  SOCKET.on("audit", (entry)=>{ unshiftAudit(entry); if(ROUTE&&ROUTE.name==="audit") scheduleRender(); });
  SOCKET.on("config", (cfg)=>{ DB.config=Object.assign({}, DB.config, cfg.settings, { matrix: cfg.matrix }); scheduleRender(); });
  SOCKET.on("users-changed", ()=>{ refreshUsers(); });
  SOCKET.on("presence", (p)=>{ ONLINE=p.online||[]; updatePresenceUI(); });
  SOCKET.on("connect_error", (e)=>{ if(String(e.message).match(/token|unauthor|session/i)) handleAuthLoss(); });
}

function updatePresenceUI(){
  const el=document.getElementById("presenceChip");
  if(el){ el.textContent = ONLINE.length + " online"; el.title = ONLINE.map(u=>u.name).join(", "); }
}

/* ---------- server-backed login ---------- */
function bindLogin(){
  const doLogin=async()=>{
    const u=document.getElementById("lu").value.trim().toLowerCase();
    const p=document.getElementById("lp").value;
    const err=document.getElementById("loginErr");
    const show=(m)=>{err.textContent=m;err.classList.remove("hidden");};
    if(!u||!p){ show("Enter your username and password."); return; }
    const btn=document.getElementById("loginBtn"); if(btn){btn.disabled=true;btn.textContent="Signing in…";}
    const r=await api("POST","/api/auth/login",{ username:u, password:p });
    if(btn){btn.disabled=false;btn.textContent="Sign in";}
    if(!r.ok){ show(r.data&&r.data.error?r.data.error:"Sign-in failed."); return; }
    saveToken(r.data.token); ME=r.data.user;
    try{ await bootstrap(); }catch(e){ show("Could not load data."); return; }
    connectSocket();
    if(ME.mustChange){ route("dashboard"); setTimeout(()=>openChangePw(true),150); }
    else route("dashboard");
  };
  const b=document.getElementById("loginBtn"); if(b)b.onclick=doLogin;
  ["lu","lp"].forEach(id=>{ const el=document.getElementById(id); if(el)el.addEventListener("keydown",e=>{ if(e.key==="Enter")doLogin(); }); });
  const demo=document.getElementById("demoFill");
  if(demo)demo.onclick=()=>{ document.getElementById("lu").value="admin"; document.getElementById("lp").value="admin123"; };
}

/* ---------- config & matrix (server) ---------- */
function saveConfig(){
  const body={ ward:mval("cfgWard")||DB.config.ward, hospital:mval("cfgHosp")||DB.config.hospital,
    capacity:parseInt(mval("cfgCap"))||DB.config.capacity, inactivityMin:parseInt(mval("cfgTimeout"))||120,
    pwMinLen:Math.max(6,parseInt(mval("cfgPwLen"))||8) };
  api("PUT","/api/admin/config/settings",body).then(r=>{
    if(r.ok){ DB.config=Object.assign({},DB.config,r.data); toast("Configuration saved.","ok"); render(); }
    else toast(r.data&&r.data.error||"Save failed.","err");
  });
}
function apiSaveMatrix(note){
  api("PUT","/api/admin/config/matrix",{ matrix:DB.config.matrix, note }).then(r=>{
    if(!r.ok) toast(r.data&&r.data.error||"Matrix save failed.","err");
  });
}
function apiResetMatrix(){
  api("PUT","/api/admin/config/matrix",{ reset:true }).then(r=>{
    if(r.ok){ DB.config.matrix=r.data; toast("Matrix reset.","ok"); render(); }
    else toast(r.data&&r.data.error||"Reset failed.","err");
  });
}

/* ---------- user management (server) ---------- */
function openUserForm(edit){
  const u=edit?byId("users",edit):{};
  const isAdminAcct=edit&&u.role==="admin";
  const roles=ROLE_ORDER.map(r=>`<option value="${r}"${u.role===r?" selected":""}>${ROLES[r].label}</option>`).join("");
  const ovRows=isAdminAcct?"":PERMS.filter(p=>p.key!=="userMgmt"&&p.key!=="viewPatients").map(p=>{
    const cur=(u.permOverrides&&Object.prototype.hasOwnProperty.call(u.permOverrides,p.key))?(u.permOverrides[p.key]?"allow":"deny"):"default";
    return `<tr style="cursor:default"><td style="padding:4px 8px;font-size:12px">${esc(p.label)}</td>
      <td style="padding:4px 8px"><select class="inp ov-cell" data-perm="${p.key}" style="padding:3px 6px;font-size:11.5px">
        <option value="default"${cur==="default"?" selected":""}>Role default (${matrixVal(u.role||"readonly",p.key)})</option>
        <option value="allow"${cur==="allow"?" selected":""}>Allow</option>
        <option value="deny"${cur==="deny"?" selected":""}>Deny</option></select></td></tr>`;}).join("");
  modal({title:edit?"Edit user":"Add user",wide:true,body:`
    <div class="grid2">
      <label class="fld"><span>Full name <span class="req">*</span></span><input class="inp" id="u_name" value="${esc(u.name||"")}"></label>
      <label class="fld"><span>Username <span class="req">*</span></span><input class="inp mono" id="u_username" value="${esc(u.username||"")}" ${edit?"disabled":""}></label>
      <label class="fld"><span>Role <span class="req">*</span></span><select class="inp" id="u_role" ${isAdminAcct?"disabled":""}>${roles}</select></label>
      <label class="fld"><span>Designation</span><input class="inp" id="u_desig" value="${esc(u.desig||"")}"></label>
      <label class="fld"><span>Employee ID</span><input class="inp" id="u_emp" value="${esc(u.emp||"")}"></label>
      <label class="fld"><span>Contact number</span><input class="inp" id="u_contact" value="${esc(u.contact||"")}"></label>
      <label class="fld"><span>Email address</span><input class="inp" id="u_email" value="${esc(u.email||"")}"></label>
    </div>
    ${edit?"":`<label class="fld"><span>Temporary password <span class="req">*</span></span><input class="inp" id="u_pw" value="temp1234"></label>
      <p class="muted" style="font-size:12px;margin:0 0 6px">Min 8 chars incl. a letter and a digit. User must change it at first login (§4.8).</p>`}
    ${isAdminAcct?`<p class="muted" style="font-size:12px">Administrator privileges cannot be modified (§4.3.1).</p>`:`
    <div class="divider"></div>
    <div class="k muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Individual permission overrides (§4.2)</div>
    <div class="tbl-wrap" style="max-height:200px"><table class="tbl" style="font-size:12px"><tbody>${ovRows}</tbody></table></div>`}`,
    okText:edit?"Save":"Create user",onOk:async()=>{
      const name=mval("u_name"),un=mval("u_username").toLowerCase(); if(!name||(!edit&&!un)){toast("Name & username required.","err");return false;}
      const role=isAdminAcct?"admin":mval("u_role");
      const overrides={}; if(!isAdminAcct)document.querySelectorAll(".ov-cell").forEach(s=>{ if(s.value==="allow")overrides[s.getAttribute("data-perm")]=true; else if(s.value==="deny")overrides[s.getAttribute("data-perm")]=false; });
      const payload={ name, role, desig:mval("u_desig"), emp:mval("u_emp"), contact:mval("u_contact"), email:mval("u_email"), permOverrides:overrides };
      let r;
      if(edit){ r=await api("PUT","/api/admin/users/"+edit,payload); }
      else { payload.username=un; payload.password=mval("u_pw")||"temp1234"; r=await api("POST","/api/admin/users",payload); }
      if(!r.ok){ toast(r.data&&r.data.error||"Could not save user.","err"); return false; }
      await refreshUsers(); toast(edit?"Saved.":"User created.","ok"); render();
    }});
}
function applyLifecycle(uid_,st){ closeModal();
  api("POST","/api/admin/users/"+uid_+"/lifecycle",{ status:st }).then(async r=>{
    if(!r.ok){ toast(r.data&&r.data.error||"Action failed.","err"); return; }
    await refreshUsers(); toast(st==="terminate"?"Sessions terminated.":"Account "+st+".","ok"); render();
  });
}
function resetPw(uid_){ const u=byId("users",uid_);
  modal({title:"Reset password",narrow:true,body:`<p style="margin:0 0 12px">Set a temporary password for <b>${esc(u.name)}</b>. All their active sessions will be invalidated (§4.10).</p>
    <label class="fld"><span>Temporary password</span><input class="inp" id="rp_pw" value="temp1234"></label>`,
    okText:"Reset",onOk:async()=>{ const pw=mval("rp_pw")||"temp1234";
      const r=await api("POST","/api/admin/users/"+uid_+"/reset-password",{ password:pw });
      if(!r.ok){ toast(r.data&&r.data.error||"Reset failed.","err"); return false; }
      await refreshUsers(); toast("Password reset.","ok"); render(); }});
}
function editMyContact(){ const u=currentUser();
  modal({title:"Update contact information",body:`
    <label class="fld"><span>Contact number</span><input class="inp" id="mc_contact" value="${esc(u.contact||"")}"></label>
    <label class="fld"><span>Email address</span><input class="inp" id="mc_email" value="${esc(u.email||"")}"></label>`,
    okText:"Save",onOk:async()=>{ const r=await api("PUT","/api/auth/contact",{ contact:mval("mc_contact"), email:mval("mc_email") });
      if(!r.ok){ toast("Update failed.","err"); return false; }
      ME=r.data; toast("Updated.","ok"); render(); }});
}
function openChangePw(forced){
  const minLen=DB.config.pwMinLen||8;
  modal({title:forced?"Set a new password":"Change password",narrow:true,hideFooter:false,body:`
    ${forced?`<p class="muted" style="margin:0 0 12px">Please set a new password to continue.</p>`:`<label class="fld"><span>Current password</span><input class="inp" id="cp_old" type="password"></label>`}
    <label class="fld"><span>New password <span class="req">*</span></span><input class="inp" id="cp_new" type="password"></label>
    <label class="fld"><span>Confirm new password</span><input class="inp" id="cp_conf" type="password"></label>
    <p class="muted" style="font-size:11.5px;margin:0">Minimum ${minLen} characters, at least one letter and one digit (§4.9).</p>`,
    okText:"Update password",onOk:async()=>{
      const np=mval("cp_new"); if(np.length<minLen||!/[a-zA-Z]/.test(np)||!/\d/.test(np)){toast("Min "+minLen+" chars with a letter and a digit.","err");return false;}
      if(np!==mval("cp_conf")){toast("Passwords don't match.","err");return false;}
      const r=await api("POST","/api/auth/change-password",{ current: forced?undefined:mval("cp_old"), next:np });
      if(!r.ok){ toast(r.data&&r.data.error||"Could not update password.","err"); return false; }
      saveToken(r.data.token); ME=r.data.user; connectSocket();
      toast("Password updated.","ok"); }});
}

/* ---------- boot ---------- */
async function startApp(){
  TOKEN = loadToken();
  if(TOKEN){
    try{
      await bootstrap();
      connectSocket();
      route("dashboard");
      if(ME && ME.mustChange) setTimeout(()=>openChangePw(true),150);
      return;
    }catch(e){ saveToken(null); ME=null; SESSION=null; }
  }
  render();  // shows login
}
startApp();
