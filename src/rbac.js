"use strict";
/* Role-Based Access Control (SUMS spec §4).
   This is the AUTHORITATIVE copy — every mutating API route checks can().
   The identical logic runs in the browser for UI gating, but the server
   never trusts the client. */

const ROLE_ORDER = ["admin","hod","consultant","assocprof","asstprof","sr","resident","mo","ho","nurse","deo","readonly"];

const ROLES = {
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

const PERMS = [
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

function buildDefaultMatrix() {
  const y="yes",n="no",v="view",o="optional",l="limited",M={};
  PERMS.forEach(p=>{(M.admin=M.admin||{})[p.key]=y;});
  const cons={viewPatients:y,addPatient:y,editPatient:y,deletePatient:y,note:y,surgery:y,med:y,mar:v,lab:y,
    order:y,task:y,io:y,drain:y,photo:y,chat:y,discharge:y,otPlan:y,report:y,auditView:n,userMgmt:n};
  M.consultant={...cons}; M.assocprof={...cons}; M.asstprof={...cons}; M.sr={...cons};
  M.hod={...cons,auditView:y};
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

function stateGranted(s){ return s==="yes"||s==="limited"; }

// user: {role, perm_overrides|permOverrides}; matrix: current effective matrix
function can(user, perm, matrix) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (perm === "view") perm = "viewPatients";
  const ov = user.perm_overrides || user.permOverrides || {};
  if (Object.prototype.hasOwnProperty.call(ov, perm)) return !!ov[perm];
  const row = (matrix || buildDefaultMatrix())[user.role] || {};
  return stateGranted(row[perm] || "no");
}

// Which permission is required to create/update a record in a given collection.
const COLLECTION_PERM = {
  patients:"editPatient", notes:"note", surgeries:"surgery", meds:"med", mar:"mar",
  labs:"lab", io:"io", drains:"drain", orders:"order", tasks:"task", chat:"chat",
  photos:"photo", timeline:null, notifications:null
};

module.exports = { ROLE_ORDER, ROLES, PERMS, buildDefaultMatrix, stateGranted, can, COLLECTION_PERM };
