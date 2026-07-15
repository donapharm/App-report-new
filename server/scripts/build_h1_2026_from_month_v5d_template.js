'use strict';
const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const v2=require('../src/report/deckDataV2'); const v3=require('../src/report/deckDataV3'); const v5data=require('../src/report/deckDataV5'); const v5dHtml=require('../src/report/deckHtmlV5D'); const {buildPptxV5D}=require('../src/report/deckPptxV5D');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'artifacts/sales-report/h1-2026-v5d-month-template-led');
const VERIFY=path.join(ROOT,'verification-screenshots/20260715-h1-v5d-month-template-led');
fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true}); fs.rmSync(VERIFY,{recursive:true,force:true}); fs.mkdirSync(VERIFY,{recursive:true});
const n=v=>Number(v||0), txt=v=>String(v==null?'':v).trim(), upper=v=>txt(v).toUpperCase();
const sum=rows=>rows.reduce((s,r)=>s+n(r.revenue),0); const pct=(v,t)=>t?v/t*100:0;
function group(rows,keyFn,labelFn=keyFn){ return v2.grouped(rows,keyFn,labelFn); }
function contractorDims(rows){
 const map=new Map();
 for(const r of rows){const id=v3.contractorIdentity(r), group=v3.contractorGroup(r), label=id.label; const cur=map.get(id.key)||{key:id.key,label,group,revenue:0,quantity:0,rowCount:0}; if(label.length>cur.label.length) cur.label=label; cur.revenue+=n(r.revenue); cur.quantity+=n(r.quantity); cur.rowCount++; map.set(id.key,cur);}
 const total=sum(rows); return [...map.values()].sort((a,b)=>b.revenue-a.revenue).map((x,i)=>({...x,rank:i+1,share:pct(x.revenue,total)}));
}
function compared(cur,prev,key,label,valid=false){ return v2.compared(cur,prev,key,label,1,valid); }
function monthRows(){
 const months=[]; for(let m=1;m<=6;m++){const from=`2026-${String(m).padStart(2,'0')}-01`, to=new Date(2026,m,0).toISOString().slice(0,10); const rows=v2.rowsInRange({from,to}); months.push({date:from,label:`T${String(m).padStart(2,'0')}/2026`,from,to,revenue:sum(rows),rows:rows.length});}
 return months;
}
function employeeTiers(list){ const total=list.reduce((s,x)=>s+x.revenue,0), avg=list.length?total/list.length:0; return {average:avg,top:list.filter(x=>x.revenue>=avg*1.25),core:list.filter(x=>x.revenue<avg*1.25&&x.revenue>=avg*.65),develop:list.filter(x=>x.revenue<avg*.65)}; }
function unitOpportunity(rows, units){ return units.slice(4,12).map(x=>{const rr=rows.filter(r=>txt(r.unit_code)===x.key); return {...x,productCount:new Set(rr.map(r=>txt(r.iit_code)).filter(Boolean)).size,employeeCount:new Set(rr.map(r=>upper(r.emp_code)).filter(Boolean)).size,routeCount:new Set(rr.map(r=>v2.canonicalRoute(r)).filter(Boolean)).size};}); }
async function main(){
 const base=await v5data.build({kind:'month',asOf:'2026-07-13'}); // exact approved monthly LED template/data shape
 const current={from:'2026-01-01',to:'2026-06-30'}, previous={from:'2025-07-01',to:'2025-12-31'};
 const rows=v2.rowsInRange(current), prev=[]; const total=sum(rows);
 const dims={
  route:group(rows,v2.canonicalRoute), sourceGroup:group(rows,v3.contractorGroup), customerType:group(rows,v2.customerType), therapy:group(rows,r=>txt(r.c14)||'Chưa phân nhóm'),
  employee:group(rows.filter(r=>!(require('../src/diemXu').EXCLUDE||new Set()).has(upper(r.emp_code))),r=>upper(r.emp_code),r=>txt(r.emp_name)||upper(r.emp_code)),
  unit:group(rows,r=>txt(r.unit_code),r=>txt(r.unit_name)||txt(r.unit_code)), product:group(rows,r=>txt(r.iit_code),r=>txt(r.product_name)||txt(r.iit_code)), contractor:contractorDims(rows)
 };
 const valid=false;
 base.kind='month'; base.dataAsOf='2026-06-30';
 base.period={current,previous,pulse:current,comparisonMethod:'h1-template-report',comparisonLabel:'Báo cáo 06 tháng đầu năm 2026; không dựng so sánh 6 tháng trước khi chưa có cùng nguồn dữ liệu chuẩn.',pulseLabel:'T01–T06/2026',alignedMtd:null,alignedMtdMethod:'not-applicable'};
 base.quality={...base.quality,currentGranularity:'day/month source',previousGranularity:'not used',comparisonValid:false,canCompareExactly:false,comparisonLabel:'Không công bố biến động so kỳ trước trong bản này; tập trung tổng hợp T01–T06/2026 theo mẫu báo cáo tháng đã duyệt.',mtdComparable:false,mtdComparisonLabel:'Không áp dụng MTD cho báo cáo 06 tháng.',mappingCoverage: total?dims.sourceGroup.filter(x=>x.key!=='Chưa xác định').reduce((s,x)=>s+x.revenue,0)/total*100:0,warnings:['Bản này dùng đúng khuôn V5D Photo Light 16:9 của báo cáo tháng 06/2026 để trình chiếu LED.']};
 base.totals={companyRevenue:total,comparisonRevenue:null,previousRevenueRaw:0,deltaRevenue:null,deltaPct:null,rowCount:rows.length,unitCount:dims.unit.length,productCount:dims.product.length,eligibleEmployeeRevenue:sum(rows.filter(r=>!(require('../src/diemXu').EXCLUDE||new Set()).has(upper(r.emp_code)))),excludedEmployeeRevenue:sum(rows.filter(r=>(require('../src/diemXu').EXCLUDE||new Set()).has(upper(r.emp_code))))};
 base.dimensions=dims;
 base.comparisons={route:compared(rows,prev,v2.canonicalRoute,v2.canonicalRoute,valid),sourceGroup:compared(rows,prev,v3.contractorGroup,v3.contractorGroup,valid),employee:compared(rows,prev,r=>upper(r.emp_code),r=>txt(r.emp_name)||upper(r.emp_code),valid),unit:compared(rows,prev,r=>txt(r.unit_code),r=>txt(r.unit_name)||txt(r.unit_code),valid),product:compared(rows,prev,r=>txt(r.iit_code),r=>txt(r.product_name)||txt(r.iit_code),valid),contractor:{valid:false,all:dims.contractor.map(x=>({key:x.key,label:x.label,current:x.revenue,previous:null,diff:null,growth:null,group:x.group})),up:[],down:[],new:[],dormant:[]}};
 base.timeline={monthly:monthRows().map(x=>({ky:x.label,label:x.label,from:x.from,to:x.to,revenue:x.revenue,isMtd:false,granularity:'month'})),quarterly:[{label:'Q1/2026',revenue:monthRows().slice(0,3).reduce((s,x)=>s+x.revenue,0),months:3},{label:'Q2/2026',revenue:monthRows().slice(3,6).reduce((s,x)=>s+x.revenue,0),months:3}],daily:monthRows().map(x=>({date:x.from,revenue:x.revenue}))};
 base.regions=v5data.regionFacts(rows,prev,false); base.regionTotals={revenue:Object.values(base.regions).reduce((s,x)=>s+x.revenue,0),companyRevenue:total};
 base.employeeTiers=employeeTiers(dims.employee); base.employeeDepth={eligibleRevenue:base.totals.eligibleEmployeeRevenue,top3Share:dims.employee.slice(0,3).reduce((s,x)=>s+x.revenue,0)/(base.totals.eligibleEmployeeRevenue||1)*100,topGapToAverage:(dims.employee[0]?.revenue||0)-base.employeeTiers.average};
 base.unitOpportunity=unitOpportunity(rows,dims.unit); base.portfolio={top10Share:dims.product.slice(0,10).reduce((s,x)=>s+x.revenue,0)/(total||1)*100,newProducts:[],declining:[],growing:[]}; base.concentration={top5Share:dims.unit.slice(0,5).reduce((s,x)=>s+x.revenue,0)/(total||1)*100,top10Share:dims.unit.slice(0,10).reduce((s,x)=>s+x.revenue,0)/(total||1)*100};
 base.context={monthRevenue:total,quarterRevenue:base.timeline.quarterly[1].revenue,monthLabel:'06 tháng đầu năm 2026',quarterLabel:'Q2/2026'};
 base.issues=[{severity:'high',title:'T05–T06 giảm tốc so với đỉnh T04',evidence:base.timeline.monthly[5].revenue-base.timeline.monthly[3].revenue,owner:'Trưởng Sale',action:'Rà đơn vị/sản phẩm giảm tốc và lập kế hoạch kéo lại tháng 7.'},{severity:'medium',title:'Doanh thu tập trung cao ở nhóm đơn vị trụ',evidence:base.concentration.top5Share,owner:'Trưởng Sale',action:'Mở rộng nhóm đơn vị hạng giữa có nền doanh thu.'}];
 base.recommendations=[{priority:'P1',title:'Giữ nhóm đơn vị trụ cột',evidence:dims.unit.slice(0,5).reduce((s,x)=>s+x.revenue,0),owner:'Trưởng Sale / NV phụ trách',deadline:'30 ngày',action:'Chốt lịch chăm sóc và kiểm tra cơ số/QLNB.'},{priority:'P1',title:'Kéo lại nhịp doanh thu sau T04',evidence:base.timeline.monthly[5].revenue-base.timeline.monthly[3].revenue,owner:'Sale Manager',deadline:'Tháng 07/2026',action:'Lập danh sách đơn vị giảm tốc T05–T06.'},{priority:'P2',title:'Bán chéo top sản phẩm vào đơn vị hạng giữa',evidence:dims.product.slice(0,10).reduce((s,x)=>s+x.revenue,0),owner:'Sale / Data',deadline:'30 ngày',action:'Ghép sản phẩm top với đơn vị có nền và CST còn dư địa.'}];
 base.slideMap=base.slideMap.map((t,i)=> i===0?'Bìa — Báo cáo 06 tháng đầu năm 2026': t.replace(/tháng|Tháng/g,'06 tháng'));
 let doc=v5dHtml.render(base);
 doc=doc.replace('BÁO CÁO DOANH SỐ<br><em>THÁNG CHUYÊN SÂU</em>','BÁO CÁO DOANH SỐ<br><em>06 THÁNG ĐẦU NĂM 2026</em>')
  .replace('Premium Pharmaceutical Executive Intelligence · V5 Deep','Premium Pharmaceutical Executive Intelligence · V5D Photo Light · LED 16:9')
  .replace(/DRAFT V5D PHOTO LIGHT/g,'DRAFT V5D PHOTO LIGHT · H1/2026')
  .replace(/Báo cáo tháng V5 Deep/g,'Báo cáo 06 tháng V5D Photo Light')
  .replace(/Tháng dương lịch hoàn chỉnh/g,'T01–T06/2026 · đúng khuôn báo cáo tháng')
  .replace(/Doanh thu theo ngày/g,'Doanh thu theo tháng')
  .replace(/Nhịp doanh thu theo ngày & biến động chi tiết/g,'Nhịp doanh thu theo tháng & cơ cấu 06 tháng')
  .replace(/Báo cáo tháng/g,'Báo cáo 06 tháng');
 const htmlPath=path.join(OUT,'BAO_CAO_DOANH_THU_6_THANG_DAU_NAM_2026_THEO_MAU_THANG_V5D_LED.html'); fs.writeFileSync(htmlPath,doc);
 const imageDir=path.join(VERIFY,'slides');
 const pptxPath=path.join(OUT,'BAO_CAO_DOANH_THU_6_THANG_DAU_NAM_2026_THEO_MAU_THANG_V5D_LED.pptx');
 await buildPptxV5D({htmlPath,outputPath:pptxPath,imageDir,title:'DONAPHARM H1/2026 — Theo mẫu báo cáo tháng V5D Photo Light',expectedCount:38});
 const manifest={createdAt:new Date().toISOString(),templateSource:'deck-v5d-photo-light month 06/2026 approved LED template',period:current,slides:38,totalRevenue:total,rowCount:rows.length,unitCount:dims.unit.length,productCount:dims.product.length,files:{html:path.basename(htmlPath),pptx:path.basename(pptxPath)},sha256:{html:crypto.createHash('sha256').update(fs.readFileSync(htmlPath)).digest('hex'),pptx:crypto.createHash('sha256').update(fs.readFileSync(pptxPath)).digest('hex')}};
 fs.writeFileSync(path.join(OUT,'MANIFEST.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({OUT,VERIFY,manifest},null,2));
}
main().catch(e=>{console.error(e.stack||e); process.exit(1);});
