'use strict';
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const v5=require('./deckHtmlV5');

const ROOT=path.join(__dirname,'..','..','..');
const ASSET_DIR=path.join(ROOT,'web','public','report-assets','ceo-provided-onedrive-20260714-optimized');
const AI_ASSET_DIR=path.join(ROOT,'web','public','report-assets','v5d-photo-light-ai-20260714');
const ORIGINAL_ASSET_DIR=path.join(ROOT,'web','public','report-assets','ceo-provided-onedrive-20260714');
const SOURCE_MANIFEST_PATH=path.join(ASSET_DIR,'DECK_ASSET_MANIFEST.json');
const AI_SOURCE_MANIFEST_PATH=path.join(AI_ASSET_DIR,'SOURCE_MANIFEST.json');
const ORIGINAL_SOURCE_MANIFEST_PATH=path.join(ORIGINAL_ASSET_DIR,'SOURCE_MANIFEST.json');
const REAL_ASSET_FILES=['HD-0973.JPG','HD-0189.JPG','MC-0471.JPG','HD-0196.JPG','HD-0423.JPG','HDPT0320.jpg','MC-0454.JPG','HD-0187.JPG'];
const AI_ASSET_FILES=['week-ai-source-ecosystem.jpg','week-ai-portfolio-pathways.jpg','week-ai-risk-control.jpg','month-ai-group-synergy.jpg','month-ai-portfolio-priority.jpg','month-ai-governance-roadmap.jpg'];
const ASSET_FILES=[...REAL_ASSET_FILES,...AI_ASSET_FILES];
const GENERIC_ALT='Ảnh nội bộ DONAPHARM do CEO cung cấp';
const AI_ALT='Hình AI minh họa — không phải dữ liệu thực tế';
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const dataUri=f=>`data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`;
function loadAssets(){
  if(!fs.existsSync(SOURCE_MANIFEST_PATH))throw Error(`Missing CEO photo source manifest: ${SOURCE_MANIFEST_PATH}`);
  if(!fs.existsSync(AI_SOURCE_MANIFEST_PATH))throw Error(`Missing AI source manifest: ${AI_SOURCE_MANIFEST_PATH}`);
  const manifest=JSON.parse(fs.readFileSync(SOURCE_MANIFEST_PATH,'utf8')),aiManifest=JSON.parse(fs.readFileSync(AI_SOURCE_MANIFEST_PATH,'utf8'));
  if(manifest.count!==20||manifest.assets.length!==20)throw Error('CEO source manifest must contain exactly 20 photos');
  if(aiManifest.count!==6||aiManifest.assets.length!==6)throw Error('AI source manifest must contain exactly 6 decorative images');
  const expected=new Map(manifest.assets.map(x=>[x.asset,x.assetSha256])),aiExpected=new Map(aiManifest.assets.map(x=>[x.asset,x.assetSha256]));
  const real=REAL_ASSET_FILES.map(name=>{const file=path.join(ASSET_DIR,name);if(!fs.existsSync(file))throw Error(`Missing CEO-provided photo: ${file}`);const actual=sha(file);if(expected.get(name)!==actual)throw Error(`CEO photo hash mismatch: ${name}`);return[name,{name,path:file,sha256:actual,uri:dataUri(file),alt:GENERIC_ALT,type:'CEO_PHOTO'}]});
  const ai=AI_ASSET_FILES.map(name=>{const file=path.join(AI_ASSET_DIR,name);if(!fs.existsSync(file))throw Error(`Missing AI decorative image: ${file}`);const actual=sha(file);if(aiExpected.get(name)!==actual)throw Error(`AI image hash mismatch: ${name}`);return[name,{name,path:file,sha256:actual,uri:dataUri(file),alt:AI_ALT,type:'AI_DECORATIVE'}]});
  return Object.fromEntries([...real,...ai]);
}
// Exactly 7 image slides per report: 4 CEO photos + 3 AI decorative visuals.
// Week and month use disjoint image sets. AI is decorative only and never supports a factual claim.
const VISUAL_MAPS={
 week:{
  1:[['HD-0973.JPG'],'cover','50% 42%'],3:[['HD-0189.JPG'],'side','center'],
  10:[['week-ai-source-ecosystem.jpg'],'side narrow','center'],23:[['week-ai-portfolio-pathways.jpg'],'side','center'],35:[['week-ai-risk-control.jpg'],'side','center'],
  37:[['MC-0471.JPG'],'side narrow','50% 48%'],38:[['HD-0196.JPG'],'cover closing','center'],
 },
 month:{
  1:[['HD-0423.JPG'],'cover','70% center'],3:[['HDPT0320.jpg'],'side','center'],
  10:[['month-ai-group-synergy.jpg'],'side narrow','center'],23:[['month-ai-portfolio-priority.jpg'],'side','center'],35:[['month-ai-governance-roadmap.jpg'],'side','center'],
  37:[['MC-0454.JPG'],'side narrow','48% 52%'],38:[['HD-0187.JPG'],'cover closing','center'],
 },
};
const visualMapFor=d=>VISUAL_MAPS[d.kind]||(()=>{throw Error(`Unsupported V5D deck kind: ${d.kind}`)})();
function visualFigure(slideNo,spec,assets){const [names,treatment,position]=spec;const selected=names.map(name=>assets[name]);const imgs=selected.map(a=>`<img src="${a.uri}" alt="${a.alt}" data-v5d-asset="${a.name}" data-v5d-asset-type="${a.type}" data-v5d-sha256="${a.sha256}" style="object-position:${position}">`).join('');const caption=selected.some(a=>a.type==='AI_DECORATIVE')?AI_ALT:GENERIC_ALT;return `<figure class="v5dVisual ${treatment}" data-v5d-slide="${slideNo}"><div class="v5dPhotoGrid">${imgs}</div><figcaption>${caption}</figcaption><span aria-hidden="true"></span></figure>`}
function render(d,{theme='photo-light'}={}){
  const assets=loadAssets();
  const visualMap=visualMapFor(d);
  const safeTheme=theme==='classic-luxury'?'classic-luxury':'photo-light';
  let doc=v5.render(d);
  doc=doc.replace(/<title>CEO Deck V5 Deep/g,'<title>CEO Deck V5D Photo Light')
    .replace(/data-schema="5"/g,'data-schema="5.3"')
    .replace(/DRAFT V5 DEEP/g,'DRAFT V5D PHOTO LIGHT')
    .replace(/V5 Deep/g,'V5D Photo Light')
    .replace('<body data-schema="5.3"',`<body data-schema="5.3" data-v5d-theme="${safeTheme}" data-v5d-image-system="mixed-ceo-photos-ai-decorative"`);
  for(const [slideNo,spec] of Object.entries(visualMap)){
    const marker='<section class="slide ',dataSlide=`data-slide="${slideNo}"`;
    const start=doc.indexOf(dataSlide);if(start<0)throw Error(`Missing slide ${slideNo} for V5D photo`);
    const sectionStart=doc.lastIndexOf(marker,start);if(sectionStart<0)throw Error(`Missing section for slide ${slideNo}`);
    const classEnd=doc.indexOf('"',sectionStart+16);
    doc=doc.slice(0,classEnd)+` v5d-image-slide v5d-${String(slideNo).padStart(2,'0')}`+doc.slice(classEnd);
    const sectionEnd=doc.indexOf('</section>',start);if(sectionEnd<0)throw Error(`Missing section end ${slideNo}`);
    doc=doc.slice(0,sectionEnd)+visualFigure(Number(slideNo),spec,assets)+doc.slice(sectionEnd);
  }
  const css=`
/* V5D theme option: Classic Luxury — ivory/parchment, navy ink, champagne gold */
body[data-v5d-theme="classic-luxury"]{background:#1d2333;color:#1b2636}body[data-v5d-theme="classic-luxury"] .slide{background:radial-gradient(circle at 6% 0%,rgba(206,169,92,.18),transparent 24%),linear-gradient(135deg,#fffaf0 0%,#f6eddb 45%,#eef2f5 100%)}body[data-v5d-theme="classic-luxury"] .slide:after{border-color:rgba(154,119,49,.16);box-shadow:0 0 0 3vw rgba(206,169,92,.045),0 0 0 6vw rgba(31,47,79,.025)}body[data-v5d-theme="classic-luxury"] header{background:linear-gradient(90deg,rgba(255,252,245,.98),rgba(244,232,208,.94));border-bottom:2px solid #d7bd82}body[data-v5d-theme="classic-luxury"] header small{color:#9b6f22}body[data-v5d-theme="classic-luxury"] header h2{color:#24324b}body[data-v5d-theme="classic-luxury"] .logoPlate{border-color:#d7bd82;box-shadow:0 .8vh 2vh rgba(70,48,10,.13)}body[data-v5d-theme="classic-luxury"] footer{border-top-color:#d7bd82;color:#6f5b37}body[data-v5d-theme="classic-luxury"] .panel,body[data-v5d-theme="classic-luxury"] .cards article,body[data-v5d-theme="classic-luxury"] .kpi{background:rgba(255,252,246,.96);border-color:#ddc993;box-shadow:0 .7vh 1.8vh rgba(92,65,16,.08)}body[data-v5d-theme="classic-luxury"] .kpi{border-top-color:#b48735}body[data-v5d-theme="classic-luxury"] .kpi strong,body[data-v5d-theme="classic-luxury"] .cards h3,body[data-v5d-theme="classic-luxury"] .panel h3,body[data-v5d-theme="classic-luxury"] .conclusion strong{color:#24324b}body[data-v5d-theme="classic-luxury"] .panel h3{border-bottom-color:#e4d3a5}body[data-v5d-theme="classic-luxury"] th{background:linear-gradient(90deg,#1f2f4f,#3d4d6f);color:#fff7e8}body[data-v5d-theme="classic-luxury"] tbody tr:nth-child(even){background:#fbf4e6}body[data-v5d-theme="classic-luxury"] td{border-bottom-color:#eadbb5}body[data-v5d-theme="classic-luxury"] .track{background:#eadfca}body[data-v5d-theme="classic-luxury"] .track i{background:linear-gradient(90deg,#1f2f4f,#b48735)}body[data-v5d-theme="classic-luxury"] .track i.teal{background:linear-gradient(90deg,#2d6965,#c6a458)}body[data-v5d-theme="classic-luxury"] .track i.orange{background:linear-gradient(90deg,#b48735,#e4c878)}body[data-v5d-theme="classic-luxury"] .insight{background:#f3ead6;border-left-color:#1f2f4f}body[data-v5d-theme="classic-luxury"] .warning{background:#fff2cf;border-left-color:#b48735}body[data-v5d-theme="classic-luxury"] .cover{background:radial-gradient(circle at 74% 18%,rgba(228,200,120,.24),transparent 24%),linear-gradient(125deg,#18233b,#24324b 52%,#775d2c)}body[data-v5d-theme="classic-luxury"] .cover h1 em,body[data-v5d-theme="classic-luxury"] .coverBody>small,body[data-v5d-theme="classic-luxury"] .endBody>small{color:#e7c46b}body[data-v5d-theme="classic-luxury"] .coverStats span{background:rgba(28,39,62,.78);border-top-color:#e7c46b;color:#f7eacb}body[data-v5d-theme="classic-luxury"] .v5dVisual{border-color:#d7bd82;box-shadow:0 .9vh 2.2vh rgba(78,53,10,.18)}body[data-v5d-theme="classic-luxury"] .v5dVisual figcaption{background:rgba(32,42,62,.93);font-size:.78vw;padding:.52vh .72vw;box-shadow:0 .35vh .9vh rgba(0,0,0,.22)}
/* V5D photo-light system — 4 CEO photos + 3 clearly captioned AI decorative visuals */
.v5dVisual{position:absolute;z-index:2;margin:0;overflow:hidden;border-radius:.85vw;border:1px solid rgba(164,209,229,.85);background:#dcecf3;box-shadow:0 .9vh 2.2vh rgba(0,54,97,.16);pointer-events:none}.v5dPhotoGrid{display:grid;width:100%;height:100%;gap:3px;background:#fff}.v5dVisual img{display:block;width:100%;height:100%;min-width:0;min-height:0;object-fit:cover}.v5dVisual.collage2 .v5dPhotoGrid{grid-template-columns:1fr 1fr}.v5dVisual.collage2rows .v5dPhotoGrid{grid-template-columns:1fr;grid-template-rows:1fr 1fr}.v5dVisual>span{position:absolute;inset:0;background:linear-gradient(145deg,rgba(0,54,97,.02),rgba(0,138,134,.03));box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}.v5dVisual figcaption{position:absolute;z-index:3;left:.55vw;bottom:.55vh;max-width:92%;padding:.38vh .55vw;border-radius:.28vw;background:rgba(0,54,97,.88);color:#fff;font-size:.64vw;line-height:1.2;font-weight:800;letter-spacing:.005em}
.slide.v5d-image-slide:not(.cover) .v5dVisual.side{right:3.7vw;top:16.2vh;width:20vw;height:24vh}.slide.v5d-image-slide:not(.cover) .v5dVisual.side.narrow{width:15vw;height:21vh}.slide.v5d-image-slide:not(.cover) main{padding-right:25vw}.slide.v5d-image-slide:not(.cover):has(.v5dVisual.narrow) main{padding-right:19vw}
.slide.v5d-06 .v5dVisual,.slide.v5d-07 .v5dVisual,.slide.v5d-08 .v5dVisual,.slide.v5d-10 .v5dVisual,.slide.v5d-11 .v5dVisual,.slide.v5d-14 .v5dVisual,.slide.v5d-15 .v5dVisual,.slide.v5d-17 .v5dVisual,.slide.v5d-18 .v5dVisual,.slide.v5d-20 .v5dVisual,.slide.v5d-33 .v5dVisual{top:auto;bottom:6.2vh}
.slide.v5d-06 main,.slide.v5d-07 main,.slide.v5d-08 main{padding-right:22vw}.slide.v5d-06 .v5dVisual,.slide.v5d-07 .v5dVisual,.slide.v5d-08 .v5dVisual{width:18vw}.slide.v5d-06 .shareCol,.slide.v5d-07 .shareCol{width:18%!important;white-space:nowrap;font-size:.62vw;letter-spacing:-.015em}.slide.v5d-06 table,.slide.v5d-07 table{table-layout:fixed}.slide.v5d-03 .cards{grid-template-columns:1fr 1fr}.slide.v5d-03 .cards article:last-child{grid-column:1/-1;padding-top:1.1vh;padding-bottom:1.1vh}.slide.v5d-14 .tiers{gap:.5vw}.slide.v5d-14 .panel{padding-left:.55vw;padding-right:.55vw}.slide.v5d-14 table{font-size:.61vw;letter-spacing:-.01em}.slide.v5d-14 th,.slide.v5d-14 td{padding-left:.28vw;padding-right:.28vw}.slide.v5d-14 .shareCol{width:15%!important;font-size:.58vw}.slide.v5d-17 .v5dVisual{width:18vw!important;height:23vh!important}.slide.v5d-17 main{padding-right:22vw!important}.slide.v5d-15 table,.slide.v5d-17 table,.slide.v5d-18 table,.slide.v5d-20 table{font-size:.73vw}.slide.v5d-35 .riskGrid{grid-template-columns:1fr}.slide.v5d-35 .riskGrid article{padding-top:.65vh;padding-bottom:.65vh}.slide.v5d-36 .actionGrid{grid-template-columns:1fr}.slide.v5d-37 .conclusion{grid-template-columns:1fr}.slide.v5d-37 .conclusion article:last-child{grid-column:auto}.slide.v5d-37 .conclusion article{padding-top:.55vh;padding-bottom:.55vh}.slide.v5d-37 .conclusion p{font-size:.86vw}
.cover .v5dVisual.cover{inset:0 0 0 auto;width:48vw;height:100%;border:0;border-radius:0;box-shadow:none;z-index:0}.cover .v5dVisual.cover .v5dPhotoGrid{gap:3px}.cover .v5dVisual.cover>span{background:linear-gradient(90deg,#003661 0%,rgba(0,54,97,.92) 13%,rgba(0,54,97,.30) 70%,rgba(0,54,97,.08) 100%)}.cover .v5dVisual.cover figcaption{left:auto;right:.9vw;bottom:1.5vh;font-size:.72vw}.cover.v5d-38 .v5dVisual.cover:before{content:'VĂN HÓA & GẮN KẾT ĐỘI NGŨ';position:absolute;z-index:4;left:.8vw;top:1.2vh;padding:.48vh .65vw;border-radius:.3vw;background:rgba(0,54,97,.86);color:#fff;font-size:.68vw;font-weight:900;letter-spacing:.06em}.cover.v5d-01 .coverBody{padding-right:48vw}.cover.v5d-01 .coverStats{right:48vw}.cover.v5d-38 .v5dVisual.cover{left:0;right:auto;width:49vw}.cover.v5d-38 .v5dVisual.cover>span{background:linear-gradient(270deg,#003661 0%,rgba(0,54,97,.72) 10%,rgba(0,54,97,.05) 72%)}.cover.v5d-38 .endBody{padding-left:48vw}.cover.v5d-38 .endBody .logoPlate{align-self:flex-start}
`;
  return doc.replace('</style>',`${css}</style>`);
}
module.exports={render,loadAssets,visualMapFor,VISUAL_MAPS,ASSET_FILES,REAL_ASSET_FILES,AI_ASSET_FILES,ASSET_DIR,AI_ASSET_DIR,ORIGINAL_ASSET_DIR,SOURCE_MANIFEST_PATH,AI_SOURCE_MANIFEST_PATH,ORIGINAL_SOURCE_MANIFEST_PATH,GENERIC_ALT,AI_ALT,assertOfficialLogo:v5.assertOfficialLogo,OFFICIAL_LOGO_PATH:v5.OFFICIAL_LOGO_PATH,OFFICIAL_LOGO_REL:v5.OFFICIAL_LOGO_REL,OFFICIAL_LOGO_SHA256:v5.OFFICIAL_LOGO_SHA256};
