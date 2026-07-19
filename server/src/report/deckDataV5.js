'use strict';

/** CEO Deck V5 Deep — grounded FACTS only. App Report. */
const v3 = require('./deckDataV3');
const v2 = require('./deckDataV2');
const store = require('../store');
const seq = require('../cstSequence');
const diemXu = require('../diemXu');

const SCHEMA_VERSION = 5;
const REGION_KEYS = Object.freeze(['Đồng Nai', 'Bình Phước']);
const n = (v) => Number(v || 0);
const txt = (v) => String(v == null ? '' : v).trim();
const upper = (v) => txt(v).toUpperCase();
const norm = seq.normalizeText;
const sum = (rows) => rows.reduce((s, r) => s + n(r.revenue), 0);
const pct = (v, total) => total ? v / total * 100 : 0;
const regionOf = (r) => { const p = norm(r.province); return (p === 'dong nai' || p === 'ong nai') ? 'Đồng Nai' : p === 'binh phuoc' ? 'Bình Phước' : null; };
const group = (rows, keyFn, labelFn = keyFn) => {
  const m = new Map();
  for (const r of rows) { const key = txt(keyFn(r)) || '—'; const x = m.get(key) || { key, label: txt(labelFn(r)) || key, revenue: 0, quantity: 0, rows: 0 }; x.revenue += n(r.revenue); x.quantity += n(r.quantity); x.rows++; m.set(key, x); }
  const total = sum(rows); return [...m.values()].sort((a,b)=>b.revenue-a.revenue).map((x,i)=>({...x,rank:i+1,share:pct(x.revenue,total)}));
};
const compare = (cur, prev, keyFn, labelFn, valid) => {
  const a = new Map(group(cur,keyFn,labelFn).map(x=>[x.key,x])), b = new Map(group(prev,keyFn,labelFn).map(x=>[x.key,x]));
  const all = [...new Set([...a.keys(),...b.keys()])].map(key=>{const c=a.get(key),p=b.get(key),current=c?.revenue||0,previous=valid?(p?.revenue||0):null,diff=valid?current-previous:null;return {key,label:c?.label||p?.label||key,current,previous,diff,growth:valid&&previous?diff/previous*100:null,isNew:valid&&current>0&&!previous,isDormant:valid&&!current&&previous>0};});
  return {valid,all,up:valid?all.filter(x=>x.diff>0).sort((x,y)=>y.diff-x.diff):[],down:valid?all.filter(x=>x.diff<0).sort((x,y)=>x.diff-y.diff):[],new:valid?all.filter(x=>x.isNew).sort((x,y)=>y.current-x.current):[],dormant:valid?all.filter(x=>x.isDormant).sort((x,y)=>y.previous-x.previous):[]};
};
function regionFacts(curRows, prevRows, valid) {
  const out = {};
  for (const name of REGION_KEYS) {
    const cur=curRows.filter(r=>regionOf(r)===name), prev=prevRows.filter(r=>regionOf(r)===name), total=sum(cur), prior=valid?sum(prev):null;
    out[name]={name,revenue:total,previousRevenue:prior,diff:valid?total-prior:null,growth:valid&&prior?(total-prior)/prior*100:null,rowCount:cur.length,unitCount:new Set(cur.map(r=>r.unit_code)).size,productCount:new Set(cur.map(r=>r.iit_code)).size,companyShare:0,
      routes:group(cur,v2.canonicalRoute),sources:group(cur,v3.contractorGroup),customers:group(cur,v2.customerType),therapy:group(cur,r=>txt(r.c14)||'Chưa phân nhóm'),employees:group(cur,r=>upper(r.emp_code),r=>txt(r.emp_name)||upper(r.emp_code)),units:group(cur,r=>txt(r.unit_code),r=>txt(r.unit_name)||txt(r.unit_code)),products:group(cur,r=>txt(r.iit_code),r=>txt(r.product_name)||txt(r.iit_code)),
      changes:{unit:compare(cur,prev,r=>txt(r.unit_code),r=>txt(r.unit_name)||txt(r.unit_code),valid),product:compare(cur,prev,r=>txt(r.iit_code),r=>txt(r.product_name)||txt(r.iit_code),valid)}};
    out[name].top3UnitShare=out[name].units.slice(0,3).reduce((s,x)=>s+x.revenue,0)/(total||1)*100;
    out[name].topRouteShare=out[name].routes[0]?.share||0;
    out[name].topProductShare=out[name].products[0]?.share||0;
  }
  const company=sum(curRows); REGION_KEYS.forEach(k=>out[k].companyShare=pct(out[k].revenue,company));
  return out;
}
function qlnbFacts() {
  const all = seq.classifyCstSequence(store.getCst({scope:{}}));
  const stats = seq.sequenceStats(all);
  const queued = all.filter(r=>r.cst_sequence.state===seq.STATES.QUEUED).sort((a,b)=>n(b.remain_amount)-n(a.remain_amount));
  const needsConfirmation = all.filter(r=>r.cst_sequence.state===seq.STATES.NEEDS_CONFIRMATION).sort((a,b)=>n(b.remain_amount)-n(a.remain_amount));
  const byName = new Map();
  for (const r of queued) { const key=seq.normalizeProductName(r.product_name); const x=byName.get(key)||{key,productName:txt(r.product_name)||txt(r.iit_code),rows:0,amount:0,units:new Set(),codes:new Set()}; x.rows++;x.amount+=n(r.remain_amount);x.units.add(txt(r.unit_code));x.codes.add(txt(r.iit_code));byName.set(key,x); }
  const products=[...byName.values()].map(x=>({...x,units:[...x.units],codes:[...x.codes]})).sort((a,b)=>b.amount-a.amount);
  const representatives=products.map(p=>{const row=queued.find(r=>seq.normalizeProductName(r.product_name)===p.key);return {productName:p.productName,amount:p.amount,rows:p.rows,unitCount:p.units.length,unitName:txt(row.unit_name)||txt(row.unit_code),currentCode:row.cst_sequence.current?.code||'Chưa có dữ liệu',nextCode:txt(row.iit_code),currentRemainPct:row.cst_sequence.current?.remainPct??null};});
  return {sourceRows:all.length,stats,queuedRows:queued.length,queuedAmount:queued.reduce((s,r)=>s+n(r.remain_amount),0),queuedUnitCount:new Set(queued.map(r=>r.unit_code)).size,distinctProductCount:products.length,products,representatives,fullDetail:queued.map((r,i)=>({no:i+1,unitCode:txt(r.unit_code),unitName:txt(r.unit_name)||txt(r.unit_code),productName:txt(r.product_name)||txt(r.iit_code),currentCode:r.cst_sequence.current?.code||'Chưa có dữ liệu',currentRemainPct:r.cst_sequence.current?.remainPct??null,nextCode:txt(r.iit_code),remainQty:n(r.remain_qty),uom:txt(r.uom)||'Chưa có dữ liệu',remainAmount:n(r.remain_amount),state:r.cst_sequence.state})),needsConfirmationRows:needsConfirmation.length,needsConfirmationAmount:needsConfirmation.reduce((s,r)=>s+n(r.remain_amount),0),mandatoryNote:seq.MANDATORY_NOTE};
}
function employeeTiers(rows) {
  const list=rows.slice(), total=list.reduce((s,x)=>s+x.revenue,0), avg=list.length?total/list.length:0;
  return {average:avg,top:list.filter(x=>x.revenue>=avg*1.25),core:list.filter(x=>x.revenue<avg*1.25&&x.revenue>=avg*.65),develop:list.filter(x=>x.revenue<avg*.65)};
}
function unitOpportunityFacts(curRows, rankedUnits) {
  return rankedUnits.slice(4,12).map(x=>{const rows=curRows.filter(r=>txt(r.unit_code)===x.key);return {...x,productCount:new Set(rows.map(r=>txt(r.iit_code)).filter(Boolean)).size,employeeCount:new Set(rows.map(r=>upper(r.emp_code)).filter(Boolean)).size,routeCount:new Set(rows.map(r=>v2.canonicalRoute(r)).filter(Boolean)).size};});
}
function scoreByRoute(facts, currentRows) {
  const routeByEmp=new Map(); const buckets=new Map();
  for(const r of currentRows){const e=upper(r.emp_code);if(!e||diemXu.EXCLUDE.has(e))continue;const k=`${e}|${v2.canonicalRoute(r)}`;buckets.set(k,(buckets.get(k)||0)+n(r.revenue));}
  for(const key of new Set([...buckets.keys()].map(k=>k.split('|')[0]))){const candidates=[...buckets].filter(([k])=>k.startsWith(`${key}|`)).sort((a,b)=>b[1]-a[1]);routeByEmp.set(key,candidates[0]?.[0].split('|')[1]||'Chưa phân loại');}
  const map=new Map();for(const x of facts.scoreXu.rows){const route=routeByEmp.get(x.empCode)||'Chưa phân loại',r=map.get(route)||{route,employees:0,diemQuy:0,xuQuy:0};r.employees++;r.diemQuy+=n(x.diem_quy);r.xuQuy+=n(x.xu_quy);map.set(route,r);}return [...map.values()].map(x=>({...x,rate:x.diemQuy?x.xuQuy/x.diemQuy*100:null})).sort((a,b)=>b.diemQuy-a.diemQuy);
}
async function build(opts={}) {
  const facts=await v3.build(opts), cur=v2.rowsInRange(facts.period.current), prev=v2.rowsInRange(facts.period.previous), valid=facts.quality.comparisonValid;
  facts.schemaVersion=SCHEMA_VERSION; facts.design='V5 Deep Premium Pharmaceutical'; facts.regionalScope=REGION_KEYS; facts.regions=regionFacts(cur,prev,valid); facts.regionTotals={revenue:REGION_KEYS.reduce((s,k)=>s+facts.regions[k].revenue,0),companyRevenue:facts.totals.companyRevenue};
  facts.qlnb=qlnbFacts(); facts.employeeTiers=employeeTiers(facts.dimensions.employee); facts.scoreXu.byRoute=scoreByRoute(facts,cur);
  facts.employeeDepth={eligibleRevenue:facts.totals.eligibleEmployeeRevenue,top3Share:facts.dimensions.employee.slice(0,3).reduce((s,x)=>s+x.revenue,0)/(facts.totals.eligibleEmployeeRevenue||1)*100,topGapToAverage:(facts.dimensions.employee[0]?.revenue||0)-facts.employeeTiers.average};
  facts.unitOpportunity=unitOpportunityFacts(cur,facts.dimensions.unit);
  facts.portfolio={top10Share:facts.dimensions.product.slice(0,10).reduce((s,x)=>s+x.revenue,0)/(facts.totals.companyRevenue||1)*100,newProducts:facts.comparisons.product.new,declining:facts.comparisons.product.down,growing:facts.comparisons.product.up};
  const detailPages=Math.ceil(facts.qlnb.fullDetail.length/9);
  facts.slideMap=['Bìa', 'Nguồn, phương pháp & chất lượng dữ liệu', 'Tóm tắt điều hành', 'Tổng doanh số công ty', 'Nhịp doanh thu & biến động', 'Đồng Nai — đào sâu', 'Bình Phước — đào sâu', 'Đồng Nai vs Bình Phước', 'Tuyến CL · NCL · NT', 'Nguồn Group-Dona vs Đối tác', 'Loại khách hàng & nhóm điều trị', 'Group-Dona — chi tiết', 'Đối tác — chi tiết', 'Nhân viên — phân tầng', 'Nhân viên — xếp hạng', 'Nhân viên — biến động', 'Doanh thu cao · Xu thấp', 'Đơn vị — Top', 'Đơn vị — tăng/giảm', 'Đơn vị — dư địa hạng giữa', 'Sản phẩm — Top & cơ cấu', 'Sản phẩm — tăng/giảm/mới', 'Định hướng danh mục', 'QLNB/CST — toàn cảnh', 'QLNB/CST — đại diện', 'QLNB/CST — sản phẩm 1/2', 'QLNB/CST — sản phẩm 2/2', ...Array.from({length:detailPages},(_,i)=>`QLNB/CST — chi tiết ${i+1}/${detailPages}`), 'Điểm & Xu quý — tổng/theo tuyến', 'Điểm & Xu quý — nhân viên/cảnh báo', 'Rủi ro tổng hợp', 'Cơ hội & hành động', 'Kết luận điều hành CEO', 'Kết thúc'];
  if(facts.qlnb.sourceRows!==2741||facts.qlnb.stats.multiQlnbGroups!==122||facts.qlnb.queuedRows!==44||facts.qlnb.queuedAmount!==9440828476||facts.qlnb.distinctProductCount!==18) throw new Error(`QLNB baseline mismatch: ${JSON.stringify(facts.qlnb.stats)} products=${facts.qlnb.distinctProductCount}`);
  return facts;
}
module.exports={build,SCHEMA_VERSION,REGION_KEYS,regionOf,regionFacts,qlnbFacts};
