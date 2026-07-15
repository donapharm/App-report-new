'use strict';
const crypto=require('crypto');const fs=require('fs');const path=require('path');const v3=require('./deckHtmlV3');
const ROOT=path.join(__dirname,'..','..','..');
const OFFICIAL_LOGO_REL='web/public/logo-dnpharma.png';
const OFFICIAL_LOGO_PATH=path.join(ROOT,OFFICIAL_LOGO_REL);
const OFFICIAL_LOGO_SHA256='c5d9986df442c45a8af1ef78550d026626435940a4fa4e8d3404c4066838134e';
const THEMES={
  v4a:{id:'V4A',label:'Luxury Editorial',bodyClass:'theme-v4a'},
  v4b:{id:'V4B',label:'Premium Pharmaceutical',bodyClass:'theme-v4b'},
};
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function assertOfficialLogo(){if(!fs.existsSync(OFFICIAL_LOGO_PATH))throw Error(`Missing official logo: ${OFFICIAL_LOGO_PATH}`);const actual=sha(OFFICIAL_LOGO_PATH);if(actual!==OFFICIAL_LOGO_SHA256)throw Error(`Official logo hash mismatch: ${actual}`);return actual}
function logoPlate(src){return `<div class="brand-logo-plate" data-brand="DONAPHARM" data-logo-sha256="${OFFICIAL_LOGO_SHA256}"><img class="brand-logo" src="${src}" alt="DONAPHARM official logo" width="640" height="369"></div>`}
const BRAND_CSS=`
.brand-logo-plate{position:absolute;z-index:12;display:flex;align-items:center;justify-content:center;background:#FFFFFF;padding:7px;width:132px;height:82px;right:42px;top:17px;box-shadow:0 6px 18px rgba(4,42,77,.14);overflow:hidden}
.brand-logo{display:block;width:118px!important;height:auto!important;max-height:68px;aspect-ratio:640/369;object-fit:contain!important;filter:none!important}
.editorial header{padding-right:292px;position:relative}.editorial header>div{max-width:770px}.editorial header>b{position:absolute;right:196px;top:40px;white-space:nowrap}
.cover .brand-logo-plate,.end .brand-logo-plate{left:60px;right:auto;top:34px;width:194px;height:119px;padding:10px;box-shadow:0 10px 26px rgba(0,0,0,.28)}
.cover .brand-logo,.end .brand-logo{width:174px!important;max-height:101px}
.cover-copy{top:178px}.end-hero{padding-top:178px!important}.end-grid .brand-logo-plate{left:60px;top:32px}
.cinematic .brand-logo-plate{right:52px;top:38px}
`;
const V4A_CSS=`
.theme-v4a .brand-logo-plate{border:1px solid rgba(181,138,42,.42);border-radius:3px}
.theme-v4a .editorial .brand-logo-plate{box-shadow:0 7px 20px rgba(17,42,77,.13)}
`;
const V4B_CSS=`
.theme-v4b{--navy:#004B8D;--navy2:#003661;--gold:#F7A31C;--ivory:#F2F9FC;--paper:#FFFFFF;--ink:#0B2740;--muted:#557084;--red:#C94048;--green:#008A86;--line:#CFE2ED}
.theme-v4b .editorial{background-color:#F7FBFD;background-image:radial-gradient(circle at 91% 18%,rgba(41,166,184,.045) 0 2px,transparent 3px),radial-gradient(circle at 95% 28%,rgba(0,93,170,.035) 0 4px,transparent 5px),linear-gradient(135deg,#FFFFFF 0%,#F3FAFD 100%);background-size:96px 96px,137px 137px,auto}
.theme-v4b .editorial:after{right:-95px;top:-115px;width:310px;height:310px;border:2px solid rgba(0,93,170,.10);box-shadow:0 0 0 42px rgba(41,166,184,.035),0 0 0 86px rgba(0,93,170,.025)}
.theme-v4b .editorial header{border-bottom:2px solid #D7E8F1}.theme-v4b .editorial header>div{max-width:850px}.theme-v4b header h2{font-size:35px}.theme-v4b header h2,.theme-v4b .insight h3,.theme-v4b .hero-note h3,.theme-v4b .cards h3,.theme-v4b .road h3,.theme-v4b .decision-board h3,.theme-v4b .call-list h3,.theme-v4b .action-board h3,.theme-v4b .issue-board h3,.theme-v4b .gap-board h3{font-family:'Aptos Display','Segoe UI',Arial,sans-serif}
.theme-v4b header small,.theme-v4b .section-copy small,.theme-v4b .cover-copy small,.theme-v4b .end small,.theme-v4b .insight small,.theme-v4b .method-grid small{color:#F7A31C}
.theme-v4b .brand-logo-plate{border:1px solid #D7E8F1;border-radius:12px;box-shadow:0 10px 26px rgba(0,75,141,.16)}
.theme-v4b .kpi,.theme-v4b .insight,.theme-v4b .chartbox,.theme-v4b .cards article,.theme-v4b .road>div,.theme-v4b .decision-board>div,.theme-v4b .call-list article,.theme-v4b .action-board article,.theme-v4b .issue-board article,.theme-v4b .gap-board article,.theme-v4b .compare>div,.theme-v4b .method-grid>div,.theme-v4b .automation>div,.theme-v4b .no-compare{border-color:#D5E7F0;border-radius:10px;box-shadow:0 9px 24px rgba(0,75,141,.07)}
.theme-v4b .chartbox{background:rgba(255,255,255,.96)}.theme-v4b th{background:linear-gradient(90deg,#004B8D,#005DAA)}
.theme-v4b .method,.theme-v4b .hero-note,.theme-v4b .contract-hero,.theme-v4b .drilldown{background:#EAF6FA;border-color:#F7A31C}.theme-v4b .track,.theme-v4b .bullets i,.theme-v4b .gap-board i{fill:#E1EFF5;background:#E1EFF5}
.theme-v4b .cover,.theme-v4b .cinematic,.theme-v4b .end{background-color:#003661}.theme-v4b .veil{background:linear-gradient(90deg,rgba(0,54,97,.98),rgba(0,75,141,.88) 48%,rgba(0,93,170,.26) 100%)}
.theme-v4b .cover-copy h1,.theme-v4b .section-copy h1,.theme-v4b .end h1{font-family:'Aptos Display','Segoe UI',Arial,sans-serif;letter-spacing:-2px}.theme-v4b .cover-copy>div,.theme-v4b .end h1 em{color:#F7A31C}.theme-v4b .section-copy{border-left-color:#F7A31C}
.theme-v4b .end-shade{background:linear-gradient(90deg,rgba(0,54,97,.99),rgba(0,75,141,.88))}.theme-v4b .end-decisions p{background:rgba(0,54,97,.90);border-top-color:#F7A31C}.theme-v4b .contact{background:#F7FBFD;border-left-color:#F7A31C}
.theme-v4b .editorial main:has(.sequence-call-list){gap:8px;padding-top:10px}
.theme-v4b .sequence-call-list{gap:8px;flex:0 0 auto}
.theme-v4b .sequence-call-list article{grid-template-columns:48px 1fr 132px;min-height:88px;padding:9px 15px}
.theme-v4b .sequence-call-list article>span{font-size:25px}.theme-v4b .sequence-call-list h3{font-size:19px;margin:2px 0}
.theme-v4b .sequence-call-list p{font-size:14px;line-height:1.15;margin:3px 0}.theme-v4b .sequence-call-list small{font-size:12px}
.theme-v4b .sequence-call-list strong{font-size:21px}.theme-v4b .sequence-call-list+.insight{min-height:68px;padding:9px 15px}
.theme-v4b .sequence-call-list+.insight p{font-size:15px;line-height:1.2}.theme-v4b .sequence-call-list+.insight small{font-size:11px}
`;
function replacePalette(html){const map={
  '#112A4D':'#004B8D','#07182F':'#003661','#17365D':'#005DAA','#B58A2A':'#F7A31C','#D4AE52':'#F7A31C','#E8C96D':'#FFC766','#54775E':'#008A86','#7E6B8F':'#29A6B8','#A44A43':'#C94048','#F5F0E6':'#F2F9FC','#FBF8F1':'#FFFFFF','#D9D1C2':'#CFE2ED','#ECE6DA':'#E1EFF5','#EDE5D5':'#EAF6FA','#EEE6D8':'#EAF6FA','#EFE9DD':'#EDF7FA','#E8E1D5':'#E1EFF5','#172236':'#0B2740','#697180':'#557084','#27354A':'#27495F','#404A5A':'#466477','#4A5565':'#526D80','#AFA89C':'#9FBBCB'
};for(const [a,b] of Object.entries(map))html=html.split(a).join(b);return html}
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const vn=v=>Number(v||0).toLocaleString('vi-VN',{maximumFractionDigits:1});
const short=v=>{const x=Number(v||0),a=Math.abs(x);return a>=1e9?`${vn(x/1e9)} tỷ`:a>=1e6?`${vn(x/1e6)} tr`:vn(x)};
function sequenceList(d){const a=(d.cstOpportunity?.sequenceDisplay||[]),shown=a.slice(0,2),note=d.cstOpportunity?.mandatoryNote||'';return `<div class="call-list sequence-call-list">${shown.map((x,i)=>{const queued=x.sequenceState==='QUEUED_WAITING',confirm=x.sequenceState==='NEEDS_CONFIRMATION',current=x.sequence?.current;return `<article><span>0${i+1}</span><div><small>${esc(x.unitName)} · ${queued?'ĐANG CHỜ':confirm?'CẦN XÁC NHẬN':'CÓ THỂ XEM XÉT'}</small><h3>${esc(x.productName)}</h3><p>${current?`Hiện hành <b>${esc(current.code)}</b> · còn ${vn(current.remainPct)}% / ${vn(current.remainQty)} ${esc(x.uom)}<br>`:''}Kế tiếp <b>${esc(x.iitCode)}</b> · ${esc(x.sequence?.transition||'')}</p></div><strong>${short(x.remainAmount)}</strong></article>`}).join('')}</div><aside class="insight"><small>NGUYÊN TẮC TRÌNH TỰ QLNB</small><p>${esc(note)}</p></aside>`}
function makeSequenceAware(doc,d){
  doc=doc.replace('CST còn nguyên — 3 cuộc gọi đầu tiên','Trình tự QLNB — mã hiện hành và mã kế tiếp').replace('CST chưa khai thác — 3 cuộc gọi đầu tiên','Trình tự QLNB — mã hiện hành và mã kế tiếp').replace('<small>UNTOUCHED CST</small>','<small>TRÌNH TỰ QLNB</small>').replace('<small>UNTOUCHED</small>','<small>TRÌNH TỰ QLNB</small>');
  doc=doc.replace('Xếp theo giá trị CST còn; danh sách đầy đủ mở trong HTML.','Phân loại trung lập theo trạng thái hiện hành / đang chờ / cần xác nhận; không dùng mã đang chờ để đánh giá nhân viên.');
  doc=doc.replace(/<div class="call-list">[\s\S]*?<\/div><details class="drilldown">[\s\S]*?<\/details>/,sequenceList(d));
  return doc;
}
function render(d,{theme='v4a'}={}){const t=THEMES[String(theme).toLowerCase()];if(!t)throw Error(`Unknown V4 theme: ${theme}`);assertOfficialLogo();const clone={...d,assets:{...d.assets,logo:OFFICIAL_LOGO_REL}};const a=v3.assets(clone);let doc=v3.render(clone);doc=doc.replace(/<img class="logo" src="[^"]*">/g,'');doc=doc.replace(/<section class="slide ([^"]+)"([^>]*)>/g,(m,classes,rest)=>`<section class="slide ${classes}"${rest}>${logoPlate(a.logo)}`);doc=doc.replace(/DRAFT V3/g,`DRAFT ${t.id}`).replace(/CEO LUXURY EDITORIAL/g,t.id==='V4A'?'CEO LUXURY EDITORIAL':'CEO PREMIUM PHARMACEUTICAL').replace(/CEO Deck V3/g,`CEO Deck ${t.id}`);doc=doc.replace('<body>',`<body class="deck-v4 ${t.bodyClass}" data-theme="${t.id}" data-official-logo-sha256="${OFFICIAL_LOGO_SHA256}">`);doc=doc.replace('</style>',`${BRAND_CSS}${t.id==='V4A'?V4A_CSS:V4B_CSS}</style>`);if(t.id==='V4B'){doc=replacePalette(doc);doc=makeSequenceAware(doc,d)}const count=(doc.match(/class="brand-logo"/g)||[]).length;if(count!==32)throw Error(`${t.id} requires logo on 32 slides, got ${count}`);return doc}
module.exports={render,THEMES,OFFICIAL_LOGO_REL,OFFICIAL_LOGO_PATH,OFFICIAL_LOGO_SHA256,assertOfficialLogo};
