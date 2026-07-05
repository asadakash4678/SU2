"use strict";
const db = require("./index");
const { hashPw } = require("../src/auth");
const { ROLES, buildDefaultMatrix } = require("../src/rbac");
const { DEFAULT_CONFIG, setConfigKey, rid } = require("../src/store");

async function seed(){
  const existing = await db.query("SELECT COUNT(*)::int AS n FROM users");
  if(existing.rows[0].n > 0) return;                       // already seeded

  await setConfigKey("settings", DEFAULT_CONFIG);
  await setConfigKey("matrix", buildDefaultMatrix());

  const demo = String(process.env.SEED_DEMO || "true").toLowerCase() === "true";

  // Always create the initial administrator
  const users = [["Dr. Sana Iqbal","admin","admin","admin123","System Administrator","EMP-001"]];
  if(demo){
    users.push(
      ["Prof. Kamran Sheikh","hod","hod","demo123","Head of Department","EMP-002"],
      ["Prof. Nadia Rehman","consultant","consultant","demo123","Consultant Surgeon","EMP-003"],
      ["Dr. Faisal Qureshi","assocprof","assocprof","demo123","Associate Professor","EMP-007"],
      ["Dr. Asad Munawar","registrar","sr","demo123","Senior Registrar","EMP-014"],
      ["Dr. Hira Yousaf","resident","resident","demo123","Resident","EMP-031"],
      ["Dr. Bilal Ahmed","mo","mo","demo123","Medical Officer","EMP-045"],
      ["Dr. Omar Sethi","houseofficer","ho","demo123","House Officer","EMP-052"],
      ["Sr. Ayesha Khan","nurse","nurse","demo123","Staff Nurse","EMP-060"],
      ["Mr. Tariq Javed","dataentry","deo","demo123","Data Entry Operator","EMP-071"],
      ["Dr. Sadia Noor","readonly","readonly","demo123","Read-Only User","EMP-080"]
    );
  }
  for(const [name,username,role,pw,desig,emp] of users){
    await db.query(
      `INSERT INTO users(id,username,name,role,desig,emp,pw_hash,status,must_change,perm_overrides,session_epoch,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,'{}'::jsonb,0,'system')`,
      [rid(), username, name, role, desig, emp, await hashPw(pw), username==="admin"?false:false]
    );
  }
  if(!demo){ console.log("Seeded administrator account only (SEED_DEMO=false)."); return; }

  // ---- sample clinical data ----
  const T = Date.now(); const day = n => new Date(T - n*86400000).toISOString();
  const cons = ["Prof. Kamran Sheikh","Prof. Nadia Rehman","Dr. Faisal Qureshi"];
  const rec = async (collection,obj)=>{ obj.id=obj.id||rid();
    await db.query("INSERT INTO records(id,collection,data,version,updated_by) VALUES($1,$2,$3,1,'system')",[obj.id,collection,JSON.stringify(obj)]); return obj; };
  const tl = (patientId,type,title,desc,color,at)=>rec("timeline",{patientId,at:at||new Date().toISOString(),type,title,desc:desc||"",color:color||"teal",by:"system"});

  const pts = [
    {name:"Muhammad Rafiq",mrn:"SU2-24-1187",age:54,gender:"Male",bed:"12",dx:"Acute appendicitis — post appendicectomy",status:"Post-operative",priority:"green",admit:day(3),cons:cons[0],blood:"B+",flags:["Allergy"]},
    {name:"Fatima Bibi",mrn:"SU2-24-1192",age:38,gender:"Female",bed:"07",dx:"Perforated peptic ulcer — septic",status:"Critical",priority:"red",admit:day(1),cons:cons[1],blood:"O+",flags:["Blood Required","Infection Control"]},
    {name:"Ahmed Nawaz",mrn:"SU2-24-1201",age:46,gender:"Male",bed:"21",dx:"Right inguinal hernia — for elective repair",status:"Pre-operative",priority:"yellow",admit:day(2),cons:cons[0],blood:"A+",flags:[]},
    {name:"Zainab Malik",mrn:"SU2-24-1205",age:29,gender:"Female",bed:"04",dx:"Acute cholecystitis",status:"Urgent",priority:"yellow",admit:day(0),cons:cons[2],blood:"AB+",flags:["Allergy"]},
    {name:"Ghulam Hussain",mrn:"SU2-24-1160",age:63,gender:"Male",bed:"33",dx:"CA sigmoid colon — post anterior resection",status:"Post-operative",priority:"green",admit:day(6),cons:cons[1],blood:"O-",flags:["Medico-Legal Case"]}
  ];
  const ids = {};
  for(const p of pts){
    const o = await rec("patients",{ mrn:p.mrn,name:p.name,age:p.age,gender:p.gender,bed:p.bed,dx:p.dx,dx2:"",bloodGroup:p.blood,
      cnic:"",mobile:"03xx-xxxxxxx",address:"",attendant:"",attendantRel:"",attendantMobile:"",admitSource:"Emergency Department",
      consultant:p.cons,team:"Team A",status:p.status,priority:p.priority,flags:p.flags,admittedAt:p.admit,createdAt:p.admit,
      createdBy:"system",archived:false,outcome:null,dischargedAt:null });
    ids[p.name]=o.id;
    await tl(o.id,"admission","Patient admitted","Admitted to bed "+p.bed+" under "+p.cons,"blue",p.admit);
  }
  const F=ids["Fatima Bibi"], R=ids["Muhammad Rafiq"], G=ids["Ghulam Hussain"], A=ids["Ahmed Nawaz"];
  await rec("surgeries",{patientId:R,procedure:"Emergency Appendicectomy",type:"Emergency",surgeon:cons[0],assistant:"Dr. Hira Yousaf",anaesthetist:"Dr. Rana",otRoom:"OT-2",priority:"Emergency",indication:"Acute appendicitis",date:day(3),status:"Completed",findings:"Inflamed appendix, no perforation.",createdBy:"system",createdAt:day(3)});
  await rec("surgeries",{patientId:G,procedure:"Anterior Resection",type:"Elective",surgeon:cons[1],assistant:"Dr. Hira Yousaf",anaesthetist:"Dr. Rana",otRoom:"OT-1",priority:"Elective",indication:"CA sigmoid colon",date:day(6),status:"Completed",findings:"Tumour resected, primary anastomosis.",createdBy:"system",createdAt:day(6)});
  await rec("surgeries",{patientId:A,procedure:"Open Inguinal Hernia Repair (Lichtenstein)",type:"Elective",surgeon:cons[0],assistant:"",anaesthetist:"Dr. Rana",otRoom:"OT-2",priority:"Elective",indication:"Right inguinal hernia",date:new Date(T+86400000).toISOString(),status:"Scheduled",findings:"",createdBy:"system",createdAt:day(1)});
  await rec("meds",{patientId:F,name:"Meropenem",dose:"1",unit:"g",route:"IV",freq:"Every 8 Hours",timing:"08:00, 16:00, 00:00",indication:"Sepsis",duration:"Until Review",highRisk:false,antibiotic:true,status:"Active",prescriber:cons[1],startAt:day(1),createdAt:day(1)});
  await rec("meds",{patientId:F,name:"Noradrenaline",dose:"0.1",unit:"mcg/kg/min",route:"IV",freq:"Continuous",timing:"Infusion",indication:"Septic shock",duration:"Until Stopped",highRisk:true,antibiotic:false,status:"Active",prescriber:cons[1],startAt:day(1),createdAt:day(1)});
  await rec("meds",{patientId:R,name:"Co-amoxiclav",dose:"1.2",unit:"g",route:"IV",freq:"Three Times Daily",timing:"08:00, 14:00, 20:00",indication:"Surgical prophylaxis",duration:"3 Days",highRisk:false,antibiotic:true,status:"Active",prescriber:cons[0],startAt:day(3),createdAt:day(3)});
  await rec("labs",{patientId:F,test:"Complete Blood Count",category:"Laboratory",urgency:"Urgent",status:"Resulted",result:"WBC 21.4, Hb 9.8, Plt 132",orderedBy:cons[1],orderedAt:day(1),resultedAt:day(0)});
  await rec("labs",{patientId:F,test:"Serum Lactate",category:"Laboratory",urgency:"Urgent",status:"Pending",result:"",orderedBy:cons[1],orderedAt:new Date().toISOString(),resultedAt:null});
  await rec("io",{patientId:F,kind:"input",label:"IV Ringer's Lactate",volume:1500,at:day(0)});
  await rec("io",{patientId:F,kind:"output",label:"Urine",volume:640,at:day(0)});
  await rec("drains",{patientId:G,name:"Pelvic drain",site:"Left iliac fossa",insertedAt:day(6),removedAt:null,outputs:[{at:day(1),volume:70,character:"Serous"},{at:day(0),volume:40,character:"Serous"}]});
  await rec("orders",{patientId:F,text:"Hourly urine output monitoring; inform if <30 mL/hr",assignedTo:"nurse",priority:"Urgent",status:"Pending",createdBy:cons[1],createdAt:day(0),dueAt:null});
  await rec("tasks",{patientId:R,title:"Chase X-ray report",assignedTo:"ho",priority:"Routine",status:"Pending",createdBy:cons[0],createdAt:day(0),dueAt:new Date(T+86400000).toISOString()});
  await rec("notes",{patientId:F,type:"Progress Note",body:"POD 0. Patient drowsy, hypotensive. On noradrenaline. Continue resuscitation, hourly monitoring.",by:cons[1],at:day(0)});
  await rec("notes",{patientId:R,type:"Progress Note",body:"POD 3. Comfortable, afebrile. Tolerating orals. Wound clean. Plan discharge tomorrow if stable.",by:cons[0],at:day(0)});
  console.log("Seeded demo users and sample clinical data.");
}

if(require.main === module){
  require("dotenv").config();
  db.initSchema().then(seed).then(()=>{ console.log("Seed complete."); process.exit(0); })
    .catch(e=>{ console.error(e); process.exit(1); });
}

module.exports = { seed };
