// The four blockers found in the URD trace, each reproduced as it was before the
// fix and asserted closed after. Runs against a THROWAWAY copy.
const path=require('path');
const SERVER=path.join(__dirname,'..');
const DBC=process.env.DB_PATH;
if (!DBC || path.basename(DBC).toLowerCase() === 'doctracking.db') {
  console.error('REFUSING TO RUN: set DB_PATH to a COPY. This creates and rejects real memos.');
  process.exit(2);
}
process.chdir(SERVER);
require(SERVER+'/node_modules/dotenv').config({path:SERVER+'/.env'});
const jwt=require(SERVER+'/node_modules/jsonwebtoken');
const db=require(SERVER+'/node_modules/better-sqlite3')(DBC);
const SECRET=process.env.JWT_SECRET, API='http://127.0.0.1:3399';
let pass=0,fail=0;
const ok=(c,m)=>{console.log('  '+(c?'\u2713':'\u2717')+' '+m); c?pass++:fail++;};
const sess=u=>{const j='blk-'+process.pid+'-'+Math.floor(Math.random()*1e6);
  db.prepare('INSERT OR REPLACE INTO sessions (jti,username,full_name,role,ip,user_agent,expires_at) VALUES (?,?,?,?,?,?,?)')
    .run(j,u.username,u.full_name,u.role,'127.0.0.1','test',new Date(Date.now()+6e5).toISOString()); return j;};
const tok=u=>jwt.sign({id:u.id,username:u.username,name:u.full_name,role:u.role,dept_id:u.dept_id,jti:sess(u)},SECRET,{expiresIn:'10m'});
const call=async(t,p,o={})=>{const r=await fetch(API+p,{...o,headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'}});
  let b=null;try{b=await r.json();}catch(_){} return {status:r.status,body:b};};

(async()=>{
  const DEPT='mosques_guidance_dept', OTHER='accounts_dept';
  const author  = db.prepare("SELECT id,username,full_name,role,dept_id FROM users WHERE dept_id=? AND role='STAFF' AND is_active=1 LIMIT 1").get(DEPT);
  const peer    = db.prepare("SELECT id,username,full_name,role,dept_id FROM users WHERE dept_id=? AND role='STAFF' AND is_active=1 AND id!=? LIMIT 1").get(DEPT,author.id);
  const head    = db.prepare("SELECT id,username,full_name,role,dept_id FROM users WHERE dept_id=? AND role='MANAGER' AND is_active=1 LIMIT 1").get(DEPT);
  const rcpt    = db.prepare("SELECT id,username,full_name,role,dept_id FROM users WHERE dept_id=? AND is_active=1 LIMIT 1").get(OTHER);
  console.log('author '+author.username+' | colleague '+peer.username+' | head '+head.username+' | recipient dept '+OTHER+'\n');
  const tA=tok(author), tPeer=tok(peer), tHead=tok(head), tR=tok(rcpt);

  // ---------- BLOCKER 1: rejection must not publish to the department ----------
  console.log('\u2014 1. rejecting a memo keeps it private to its author \u2014');
  let r = await call(tA,'/correspondence',{method:'POST',body:JSON.stringify({to_dept_id:OTHER,service_id:'other',subject:'موضوع اختبار الحجب',body:'نص',priority:'med'})});
  const id = r.body?.item?.id;
  ok(!!id, 'memo created ('+r.status+')');

  ok((await call(tR,'/correspondence/'+id)).status===403, 'recipient dept CANNOT read it while pending');
  ok((await call(tPeer,'/correspondence/'+id)).status===403, 'colleague cannot read it while pending');

  r = await call(tHead,'/correspondence/'+id+'/reject',{method:'POST',body:JSON.stringify({reason:'الطلب غير مبرر ومرفقاتك ناقصة'})});
  ok(r.status===200, 'head rejected it ('+r.status+')');
  ok((await call(tPeer,'/correspondence/'+id)).status===403, 'colleague STILL cannot read it after the rejection');
  const inPeerArchive = (await call(tPeer,'/correspondence?box=archive')).body?.items||[];
  ok(!inPeerArchive.some(x=>x.id===id), 'and it is absent from the colleague\u2019s archive list');
  ok((await call(tA,'/correspondence/'+id)).status===200, 'the author can still read his own returned memo');
  ok(db.prepare('SELECT awaiting_dept_id a FROM correspondences WHERE id=?').get(id).a===null, 'awaiting_dept_id was not written on reject');

  // ---------- BLOCKER 2: dead-end departments ----------
  console.log('\n\u2014 2. a department with no staff is not a valid recipient \u2014');
  const list = (await call(tA,'/departments/requestable')).body;
  const offered = (list?.departments||list?.items||[]).map(d=>d.id);
  const dead = ['reception_dept','resources_information_dept','other_dept'];
  ok(offered.length>0, 'recipient list returned '+offered.length+' departments');
  dead.forEach(d=>ok(!offered.includes(d), d+' is not offered'));
  r = await call(tA,'/correspondence',{method:'POST',body:JSON.stringify({to_dept_id:'reception_dept',service_id:'other',subject:'محاولة يدوية',body:'نص',priority:'med'})});
  ok(r.status===400, 'a hand-made request to it is refused ('+r.status+'): '+(r.body?.message||''));

  // ---------- BLOCKER 3: serial spaces must not collide ----------
  console.log('\n\u2014 3. circular and correspondence serials cannot collide \u2014');
  const { sourceCode } = require(SERVER+'/utils/circularAuth');
  const cfg = require(SERVER+'/config/departments.json').departments;
  const dgCode = cfg.find(d=>d.id==='director_general_office')?.code;
  ok(sourceCode('director_general') !== dgCode, 'circular prefix ('+sourceCode('director_general')+') differs from the office code ('+dgCode+')');
  ok(sourceCode('deputy_chairman') !== cfg.find(d=>d.id==='board_office')?.code, 'same for نائب الرئيس ('+sourceCode('deputy_chairman')+')');
  ok(/^T-/.test(sourceCode('director_general')), 'circulars sit in their own T- space');

  // ---------- BLOCKER 4: reports scope ----------
  console.log('\n\u2014 4. reports are scoped, labelled, and limited to approvers \u2014');
  ok((await call(tA,'/correspondence/reports')).status===403, 'ordinary staff are refused the reports endpoint');
  const rep = await call(tHead,'/correspondence/reports');
  ok(rep.status===200, 'a رئيس قسم can read it ('+rep.status+')');
  ok(Array.isArray(rep.body?.scope?.departments) && rep.body.scope.departments.length>0,
     'the response names whose departments the figures cover: '+JSON.stringify((rep.body?.scope?.departments||[]).map(d=>d.label)));
  const bd = rep.body?.byDepartment||[];
  ok(bd.every(d=>typeof d.isMine==='boolean'), 'every department row declares isMine ('+bd.length+' rows)');

  db.close();
  console.log('\n'+(fail===0?'\u2705 ALL '+pass+' CHECKS PASSED':'\u274C '+fail+' FAILED, '+pass+' passed'));
  process.exit(fail?1:0);
})();
