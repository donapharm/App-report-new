'use strict';

/** CEO Deck V3 — canonical period semantics.
 * MONTH: latest completed calendar month vs immediately previous completed month.
 * WEEK: latest completed Monday–Saturday workweek vs previous Monday–Saturday.
 * MTD is a separate pulse and is never promoted to official MoM.
 */
const v2 = require('./deckDataV2');
const salesReport = require('../salesReport');
const analytics = require('../analytics');
const store = require('../store');
const diemXu = require('../diemXu');

const SCHEMA_VERSION = 3;
const EXCLUDED = diemXu.EXCLUDE || new Set();
const n = (v) => Number(v || 0);
const txt = (v) => String(v == null ? '' : v).trim();
const upper = (v) => txt(v).toUpperCase();
const normalizeEntity = (v) => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
const compactEntity = (v) => normalizeEntity(v).replace(/\s+/g, '');
const canonicalEntityLabel = (v) => txt(v).normalize('NFC').replace(/[^\p{L}\p{N}&]+/gu, ' ').replace(/\s*&\s*/g, '&').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN');
function entitySignature(v) {
  const normalized = normalizeEntity(v);
  const core = normalized
    .replace(/\bcong ty trach nhiem huu han\b/g, ' ')
    .replace(/\bcong ty (?:tnhh|co phan|cp)\b/g, ' ')
    .replace(/\bcty (?:tnhh|co phan|cp)\b/g, ' ')
    .replace(/\b(?:trach nhiem huu han|tnhh|co phan|mot thanh vien|mtv)\b/g, ' ')
    .replace(/\b(?:duoc pham|duoc my pham|duoc|pharmaceutical|trang thiet bi y te|thiet bi y te|y te|va)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return core || normalized || 'unknown';
}
function contractorIdentity(r) {
  const code = upper(r.contractor_code);
  const rawName = txt(r.contractor_name);
  const raw = rawName || txt(r.contractor_code) || '—';
  const codeCompact = compactEntity(code), nameCompact = compactEntity(rawName || raw);
  if (codeCompact === 'dona' || codeCompact === 'donapharm' || nameCompact.includes('donapharm')) return { key: 'LEGAL:DONAPHARM', label: 'DONAPHARM' };
  if (codeCompact === 'afp' || codeCompact === 'afppharma' || nameCompact.includes('afppharma')) return { key: 'LEGAL:AFP-PHARMA', label: 'AFP PHARMA' };
  if (!normalizeEntity(raw) || ['n a', 'na'].includes(normalizeEntity(raw))) return { key: 'LEGAL:UNKNOWN', label: 'Chưa xác định' };
  // Legal-form and industry words are omitted from the key so equivalent long,
  // abbreviated, punctuation and whitespace variants cannot split one entity.
  // The visible label is punctuation/case canonical and remains deterministic.
  return { key: `LEGAL:${entitySignature(rawName || raw)}`, label: canonicalEntityLabel(raw) || 'Chưa xác định' };
}
function contractorGroup(r) {
  const key = contractorIdentity(r).key;
  if (key === 'LEGAL:DONAPHARM' || key === 'LEGAL:AFP-PHARMA') return 'Group-Dona';
  if (key === 'LEGAL:UNKNOWN') return 'Chưa xác định';
  return v2.sourceGroup(r);
}
const sum = (rows) => analytics.sum(rows, (r) => n(r.revenue));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { const [y,m,d] = String(s).slice(0,10).split('-').map(Number); return new Date(y,m-1,d); };
const add = (s, days) => { const d=parse(s); d.setDate(d.getDate()+days); return ymd(d); };
const monthStart = (s) => { const d=parse(s); return ymd(new Date(d.getFullYear(),d.getMonth(),1)); };
const monthEnd = (s) => { const d=parse(s); return ymd(new Date(d.getFullYear(),d.getMonth()+1,0)); };
const prevMonth = (s) => { const d=parse(s); return ymd(new Date(d.getFullYear(),d.getMonth()-1,1)); };
const quarterStart = (s) => { const d=parse(s); return ymd(new Date(d.getFullYear(),Math.floor(d.getMonth()/3)*3,1)); };
const monthKey = (s) => { const d=parse(s); return `${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`; };
const monthLabel = (s) => { const d=parse(s); return `T${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; };
const rangeLabel = (r) => `${r.from} → ${r.to}`;
function lastCompletedMonth(asOf){ return prevMonth(monthStart(asOf)); }
function lastCompletedSaturday(asOf){ const d=parse(asOf); const day=d.getDay(); const delta=day===6 ? 7 : (day+1)%7; d.setDate(d.getDate()-delta); return ymd(d); }
function workweekEnding(sat){ return {from:add(sat,-5),to:sat}; }
function canonicalRoute(r){ return v2.canonicalRoute(r); }
function customerType(r){ return v2.customerType(r); }
function sourceGroup(r){ return contractorGroup(r); }
function therapy(r){ return txt(r.c14)||'Chưa phân nhóm'; }
function group(rows,key,label=key){ return v2.grouped(rows,key,label); }
function groupContractors(rows) {
  const map = new Map();
  for (const row of rows) {
    const identity = contractorIdentity(row), candidate = identity.label;
    const cur = map.get(identity.key) || {key:identity.key,label:candidate,group:contractorGroup(row),revenue:0,quantity:0,rowCount:0};
    // Prefer the fuller official-looking legal name, then use locale order as a
    // deterministic tie-breaker; source row order can never choose the label.
    if (candidate.length > cur.label.length || (candidate.length === cur.label.length && candidate.localeCompare(cur.label,'vi') < 0)) cur.label = candidate;
    cur.revenue += n(row.revenue); cur.quantity += n(row.quantity); cur.rowCount += 1; map.set(identity.key,cur);
  }
  const total=sum(rows);
  return [...map.values()].sort((a,b)=>b.revenue-a.revenue||a.label.localeCompare(b.label,'vi')).map((x,i)=>({...x,rank:i+1,share:total?x.revenue/total*100:0}));
}
function compareContractors(curRows,prevRows,valid) {
  const cur=new Map(groupContractors(curRows).map(x=>[x.key,x])),prev=new Map(groupContractors(prevRows).map(x=>[x.key,x]));
  const all=[...new Set([...cur.keys(),...prev.keys()])].map(key=>{const c=cur.get(key),p=prev.get(key),current=c?.revenue||0,previous=valid?(p?.revenue||0):null,diff=valid?current-previous:null;return{key,label:c?.label||p?.label||key,current,previous,diff,growth:valid&&previous?diff/previous*100:null,isNew:valid&&current>0&&!previous,isDormant:valid&&!current&&previous>0,group:c?.group||p?.group||'Chưa xác định'};});
  const withDiff=all.filter(x=>x.diff!=null);
  return{valid,all:(valid?withDiff.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff)):all.sort((a,b)=>b.current-a.current)),up:withDiff.filter(x=>x.diff>0).sort((a,b)=>b.diff-a.diff).slice(0,12),down:withDiff.filter(x=>x.diff<0).sort((a,b)=>a.diff-b.diff).slice(0,12),new:withDiff.filter(x=>x.isNew).sort((a,b)=>b.current-a.current).slice(0,12),dormant:withDiff.filter(x=>x.isDormant).sort((a,b)=>b.previous-a.previous).slice(0,12)};
}
function dims(rows){
  const eligible=rows.filter(r=>!EXCLUDED.has(upper(r.emp_code)));
  return {
    route:group(rows,canonicalRoute), sourceGroup:group(rows,sourceGroup), customerType:group(rows,customerType), therapy:group(rows,therapy),
    employee:group(eligible,r=>upper(r.emp_code),r=>txt(r.emp_name)||upper(r.emp_code)), unit:group(rows,r=>txt(r.unit_code),r=>txt(r.unit_name)||txt(r.unit_code)),
    product:group(rows,r=>txt(r.iit_code),r=>txt(r.product_name)||txt(r.iit_code)), contractor:groupContractors(rows)
  };
}
function comparisons(cur,prev,valid){
  const ecur=cur.filter(r=>!EXCLUDED.has(upper(r.emp_code))), eprev=prev.filter(r=>!EXCLUDED.has(upper(r.emp_code)));
  const spec={route:[cur,prev,canonicalRoute,canonicalRoute],sourceGroup:[cur,prev,sourceGroup,sourceGroup],employee:[ecur,eprev,r=>upper(r.emp_code),r=>txt(r.emp_name)||upper(r.emp_code)],unit:[cur,prev,r=>txt(r.unit_code),r=>txt(r.unit_name)||txt(r.unit_code)],product:[cur,prev,r=>txt(r.iit_code),r=>txt(r.product_name)||txt(r.iit_code)]};
  return {...Object.fromEntries(Object.entries(spec).map(([k,a])=>[k,v2.compared(a[0],a[1],a[2],a[3],1,valid)])),contractor:compareContractors(cur,prev,valid)};
}
function totals(rows,previous,valid,dimensions){ const cur=sum(rows), prev=valid?sum(previous):null, delta=valid?cur-prev:null; return {companyRevenue:cur,comparisonRevenue:prev,previousRevenueRaw:sum(previous),deltaRevenue:delta,deltaPct:valid&&prev?delta/prev*100:null,rowCount:rows.length,unitCount:dimensions.unit.length,productCount:dimensions.product.length,eligibleEmployeeRevenue:sum(rows.filter(r=>!EXCLUDED.has(upper(r.emp_code)))),excludedEmployeeRevenue:sum(rows.filter(r=>EXCLUDED.has(upper(r.emp_code))))}; }
function daily(rows,range){ const map=new Map(); for(let d=range.from;d<=range.to;d=add(d,1))map.set(d,0); for(const r of rows){const d=txt(r.date).slice(0,10);if(map.has(d))map.set(d,map.get(d)+n(r.revenue));} return [...map].map(([date,revenue])=>({date,revenue})); }
function completedMonthTrend(lastMonth,count=12){ const d=parse(lastMonth),out=[]; for(let i=count-1;i>=0;i--){const from=ymd(new Date(d.getFullYear(),d.getMonth()-i,1)),to=monthEnd(from),rows=v2.rowsInRange({from,to});out.push({ky:monthKey(from),label:monthLabel(from),from,to,revenue:sum(rows),isMtd:false,granularity:v2.granularityFor({from,to}).label});} return out; }
function qTrend(months){const map=new Map();for(const x of months){const d=parse(x.from),label=`Q${Math.floor(d.getMonth()/3)+1}/${d.getFullYear()}`,cur=map.get(label)||{label,revenue:0,months:0};cur.revenue+=x.revenue;cur.months++;map.set(label,cur);}return [...map.values()];}
function concentration(d,total){return {top5Share:d.unit.slice(0,5).reduce((s,x)=>s+x.revenue,0)/(total||1)*100,top10Share:d.unit.slice(0,10).reduce((s,x)=>s+x.revenue,0)/(total||1)*100};}
function company(){return {coverName:'GROUP DONAPHARM',legalName:'CÔNG TY CỔ PHẦN DONAPHARM',address:'C1A, khu phố 35, phường Tam Hiệp, Thành phố Đồng Nai, Việt Nam',taxCode:'3603611886',hotline:'0886.396.668',ceo:'Đặng Xuân Trung',website:'www.donapharm.vn',emails:['info@donapharm.vn','cskh@donapharm.vn','hoadon@donapharm.vn'],tagline:'Chất lượng cuộc sống'};}
const assets={logo:'artifacts/private/company/dnpharma-logo-transparent.png',qr:'artifacts/private/company/dnpharma-qr.png',signatureWhite:'artifacts/private/company/ceo-dang-xuan-trung-signature-white.png',signatureNavy:'artifacts/private/company/ceo-dang-xuan-trung-signature-navy.png'};
function scoreForRange(rows,monthRange,quarterRange,weekRange){
  const codes=[...new Set(rows.map(r=>upper(r.emp_code)).filter(x=>x&&!EXCLUDED.has(x)))].sort(); const names=new Map(rows.map(r=>[upper(r.emp_code),txt(r.emp_name)||upper(r.emp_code)]));
  const out=codes.map(empCode=>{const s=diemXu.scoreForEmp({empCode,weekRange,monthRange,quarterRange});const gap=n(s.xu_thang)-n(s.diem_thang),rate=n(s.diem_thang)?n(s.xu_thang)/n(s.diem_thang)*100:null;return {empCode,empName:names.get(empCode)||empCode,...s,monthlyGap:gap,monthlyMissing:Math.max(0,-gap),monthlySurplus:Math.max(0,gap),monthlyRate:rate,monthlyWarning:rate!=null&&rate<90};}).sort((a,b)=>b.diem_thang-a.diem_thang);
  const totals=out.reduce((a,x)=>{a.diemThang+=n(x.diem_thang);a.xuThang+=n(x.xu_thang);a.diemQuy+=n(x.diem_quy);a.xuQuy+=n(x.xu_quy);return a;},{diemThang:0,xuThang:0,diemQuy:0,xuQuy:0}); totals.monthlyRate=totals.diemThang?totals.xuThang/totals.diemThang*100:null;totals.quarterlyRate=totals.diemQuy?totals.xuQuy/totals.diemQuy*100:null;
  return {rows:out,totals,monthlyWarnings:out.filter(x=>x.monthlyWarning).sort((a,b)=>(a.monthlyRate||0)-(b.monthlyRate||0)),quarterlyWarnings:out.filter(x=>x.canh_bao).sort((a,b)=>(a.ty_le_quy||0)-(b.ty_le_quy||0)),policy:{monthlyPrimary:true,quarterContext:true,carryForward:false,excludedCodes:[...EXCLUDED]}};
}
function targetFor(rows,month){const rev=new Map(group(rows.filter(r=>!EXCLUDED.has(upper(r.emp_code))),r=>upper(r.emp_code),r=>txt(r.emp_name)||upper(r.emp_code)).map(x=>[x.key,x]));const list=store.getTargets({ky:monthKey(month),scope:{}}).map(t=>{const r=rev.get(upper(t.emp_code)),target=n(t.target),revenue=r?.revenue||0,rate=target?revenue/target*100:null;return {empCode:upper(t.emp_code),empName:r?.label||store.findUserByCode(upper(t.emp_code))?.name||upper(t.emp_code),target,revenue,rate,gap:target-revenue};}).sort((a,b)=>(a.rate??999)-(b.rate??999));return {rows:list,slow:list.filter(x=>x.rate!=null&&x.rate<80),near:list.filter(x=>x.rate!=null&&x.rate>=80&&x.rate<100)};}
function rec(f){const issues=[];if(!f.quality.comparisonValid)issues.push({severity:'high',title:'Không đủ dữ liệu ngày để tính WoW',evidence:f.quality.comparisonLabel,owner:'Data / App Report',action:'Giữ trạng thái không so sánh; tự mở WoW khi hai tuần đều daily.'});if(f.comparisons.unit.valid&&f.comparisons.unit.down[0])issues.push({severity:'high',title:`Đơn vị giảm: ${f.comparisons.unit.down[0].label}`,evidence:f.comparisons.unit.down[0].diff,owner:'Sale phụ trách',action:'Xác minh mất đơn và kế hoạch phục hồi.'});const slow=f.target.slow[0];if(slow)issues.push({severity:'high',title:`${slow.empCode} chậm target`,evidence:slow.rate,owner:slow.empCode,action:'Chốt đơn vị/sản phẩm kéo target.'});const xu=f.scoreXu.monthlyWarnings[0];if(xu)issues.push({severity:'medium',title:`${xu.empCode} thiếu nhịp Xu tháng`,evidence:xu.monthlyRate,owner:xu.empCode,action:'Rà soát hóa đơn đủ điều kiện.'});if(f.concentration.top5Share>60)issues.push({severity:'medium',title:'Doanh thu tập trung cao ở Top 5 đơn vị',evidence:f.concentration.top5Share,owner:'Trưởng Sale',action:'Mở rộng nhóm đơn vị hạng giữa.'});
  const c=f.cstOpportunity,opportunities=[];if(c.routes[0])opportunities.push({priority:'P1',title:`Khai thác tuyến ${c.routes[0].label}`,evidence:c.routes[0].remainAmount,owner:c.routes[0].owners.slice(0,4).join(', ')||'Trưởng Sale',deadline:f.kind==='week'?'7 ngày':'30 ngày',action:'Chốt 3 đơn vị CST trọng điểm.'});if(c.units[0])opportunities.push({priority:'P1',title:c.units[0].label,evidence:c.units[0].remainAmount,owner:c.units[0].owners.slice(0,4).join(', ')||'Sale phụ trách',deadline:f.kind==='week'?'7 ngày':'30 ngày',action:'Chốt lịch dự trù và gọi hàng.'});if(c.products[0])opportunities.push({priority:'P2',title:c.products[0].label,evidence:c.products[0].remainAmount,owner:c.products[0].owners.slice(0,4).join(', ')||'Sale phụ trách',deadline:f.kind==='week'?'7 ngày':'30 ngày',action:'Mở rộng độ phủ vào đơn vị có CST.'});const recommendations=[...opportunities,...issues.slice(0,2).map((x,i)=>({priority:`R${i+1}`,title:x.title,evidence:x.evidence,owner:x.owner,deadline:f.kind==='week'?'7 ngày':'30 ngày',action:x.action}))];return {issues,opportunities,recommendations};}

async function buildMonth(asOf){
  const mainFrom=lastCompletedMonth(asOf), current={from:mainFrom,to:monthEnd(mainFrom)}, prevFrom=prevMonth(mainFrom),previous={from:prevFrom,to:monthEnd(prevFrom)},pulse={from:monthStart(asOf),to:asOf};
  const curRows=v2.rowsInRange(current),prevRows=v2.rowsInRange(previous),pulseRows=v2.rowsInRange(pulse),d=dims(curRows),cmp=comparisons(curRows,prevRows,true),t=totals(curRows,prevRows,true,d);
  const q={from:quarterStart(current.from),to:current.to}; const score=scoreForRange(curRows,current,q,null); const v2Base=await v2.build({kind:'month',asOf:current.to});
  const pulseQuality=v2.granularityFor(pulse),previousAligned={from:previous.from,to:add(previous.from,Number(asOf.slice(8))-1)},alignedQuality=v2.granularityFor(previousAligned); const canAlign=pulseQuality.exact&&alignedQuality.exact;
  const f={schemaVersion:3,kind:'month',scope:'CEO',generatedAt:new Date().toISOString(),dataAsOf:asOf,period:{current,previous,pulse,comparisonMethod:'exact-full-month',comparisonLabel:`${rangeLabel(current)} so với ${rangeLabel(previous)} · hai tháng hoàn chỉnh`,pulseLabel:`${rangeLabel(pulse)} · MTD riêng, không phải MoM`,alignedMtd:canAlign?previousAligned:null,alignedMtdMethod:canAlign?'same-completed-workdays':'unavailable-no-daily-granularity'},quality:{currentGranularity:v2.granularityFor(current).label,previousGranularity:v2.granularityFor(previous).label,comparisonValid:true,canCompareExactly:true,comparisonLabel:'So sánh chính thức: hai tháng dương lịch hoàn chỉnh; không nội suy.',mtdComparable:canAlign,mtdComparisonLabel:canAlign?`MTD đối chiếu ${rangeLabel(previousAligned)} theo cùng số ngày hoàn tất.`:'Không so MTD với tháng trước: kỳ trước không có dữ liệu ngày thực.',mappingCoverage:t.companyRevenue?d.sourceGroup.filter(x=>x.key!=='Chưa xác định').reduce((s,x)=>s+x.revenue,0)/t.companyRevenue*100:0,warnings:[]},totals:t,pulse:{revenue:sum(pulseRows),rowCount:pulseRows.length,unitCount:dims(pulseRows).unit.length,productCount:dims(pulseRows).product.length,comparisonRevenue:canAlign?sum(v2.rowsInRange(previousAligned)):null,deltaPct:null},dimensions:d,comparisons:cmp,timeline:{monthly:completedMonthTrend(mainFrom,12),quarterly:[],daily:daily(curRows,current)},scoreXu:score,target:targetFor(curRows,current.from),cstOpportunity:v2Base.cstOpportunity,concentration:concentration(d,t.companyRevenue),context:{monthRevenue:t.companyRevenue,quarterRevenue:sum(v2.rowsInRange(q)),monthLabel:monthLabel(current.from),quarterLabel:`Q${Math.floor(parse(current.from).getMonth()/3)+1}/${parse(current.from).getFullYear()}`},company:company(),assets};
  f.timeline.quarterly=qTrend(f.timeline.monthly); if(canAlign&&f.pulse.comparisonRevenue)f.pulse.deltaPct=(f.pulse.revenue-f.pulse.comparisonRevenue)/f.pulse.comparisonRevenue*100; Object.assign(f,rec(f)); f.quality.warnings=[f.quality.comparisonLabel,f.quality.mtdComparisonLabel,...f.cstOpportunity.warnings]; return f;
}
async function buildWeek(asOf){
  const sat=lastCompletedSaturday(asOf),current=workweekEnding(sat),previous=workweekEnding(add(sat,-7));const curRows=v2.rowsInRange(current),prevRows=v2.rowsInRange(previous),cq=v2.granularityFor(current),pq=v2.granularityFor(previous),valid=cq.exact&&pq.exact,d=dims(curRows),cmp=comparisons(curRows,prevRows,valid),t=totals(curRows,prevRows,valid,d);
  const month={from:monthStart(asOf),to:asOf},q={from:quarterStart(asOf),to:asOf},monthRows=v2.rowsInRange(month);const base=await v2.build({kind:'week',asOf});const score=scoreForRange(monthRows,month,q,current);
  const availableDaily=prevRows.filter(r=>txt(r.date_granularity).toLowerCase()==='day');const f={schemaVersion:3,kind:'week',scope:'CEO',generatedAt:new Date().toISOString(),dataAsOf:asOf,period:{current,previous,comparisonMethod:valid?'exact-workweek-mon-sat':'insufficient-daily-history',comparisonLabel:valid?`${rangeLabel(current)} so với ${rangeLabel(previous)} · Thứ Hai–Thứ Bảy`:`${rangeLabel(current)} so với ${rangeLabel(previous)} · kỳ trước có dữ liệu ${pq.label.replace(/,/g, ', ')}, không đủ chuẩn WoW`,pulse:month},quality:{currentGranularity:cq.label,previousGranularity:pq.label.replace(/,/g, ', '),comparisonValid:valid,canCompareExactly:valid,comparisonLabel:valid?'Hai tuần làm việc có dữ liệu ngày thực.':'Không tính WoW: tuần trước giao thoa dữ liệu tháng dạng period; tuyệt đối không phân bổ giả.',availablePriorDailyRevenue:sum(availableDaily),availablePriorDailyRows:availableDaily.length,mappingCoverage:t.companyRevenue?d.sourceGroup.filter(x=>x.key!=='Chưa xác định').reduce((s,x)=>s+x.revenue,0)/t.companyRevenue*100:0,warnings:[]},totals:t,dimensions:d,comparisons:cmp,timeline:{daily:daily(curRows,current),monthly:completedMonthTrend(lastCompletedMonth(asOf),12),quarterly:[]},scoreXu:score,target:targetFor(monthRows,asOf),cstOpportunity:base.cstOpportunity,concentration:concentration(d,t.companyRevenue),context:{monthRevenue:sum(monthRows),quarterRevenue:sum(v2.rowsInRange(q)),monthLabel:monthLabel(asOf),quarterLabel:`Q${Math.floor(parse(asOf).getMonth()/3)+1}/${parse(asOf).getFullYear()}`},company:company(),assets};f.timeline.quarterly=qTrend(f.timeline.monthly);Object.assign(f,rec(f));f.quality.warnings=[f.quality.comparisonLabel,'Số daily kỳ trước nếu nêu chỉ là pulse không so sánh.',...f.cstOpportunity.warnings];return f;
}
async function build({kind='week',asOf}={}){const dataAsOf=asOf||salesReport.defaultRanges().asOf;if(kind==='month')return buildMonth(dataAsOf);if(kind==='week')return buildWeek(dataAsOf);throw new Error(`Unsupported V3 deck kind: ${kind}`);}
module.exports={build,buildMonth,buildWeek,SCHEMA_VERSION,lastCompletedMonth,lastCompletedSaturday,workweekEnding,contractorIdentity,contractorGroup,normalizeEntity,canonicalEntityLabel,entitySignature};
