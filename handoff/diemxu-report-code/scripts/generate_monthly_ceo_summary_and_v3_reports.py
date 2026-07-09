from pathlib import Path
import json, html, re, shutil
from collections import defaultdict
from datetime import datetime

DATA=Path('/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/report_lastUploadData.json')
OLD_TARGETS=Path('/home/osboxes/.openclaw/workspace-report/t05_2026_integrated/batch_sale_t05/batch_targets_summary.json')
OUT=Path('/home/osboxes/.openclaw/workspace-report/t06_2026_employee_reports')
OUT.mkdir(parents=True, exist_ok=True)
LOGO=Path('/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/logo_dona.png')
QR=Path('/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/qr_zalo_oa_dona.png')
rows=json.loads(DATA.read_text(encoding='utf-8'))
rows=[r for r in rows if str(r.get('DATE','')).startswith('2026-06')]
targets=json.loads(OLD_TARGETS.read_text(encoding='utf-8'))
target_by_code={t['code']:t for t in targets}
# fallback name/salute from AGENTS context
fallback={
'DN001':('Đặng Xuân Trung','Anh Trung'),'DN003':('Nguyễn Trần Hoàng Anh','Anh Hoàng Anh'),'DN005':('Nguyễn Thị Dung','Chị Dung'),'DN006':('Nguyễn Trọng Hiếu','Anh Hiếu'),'DN007':('Trần Thị Kiều Linh','Chị Linh'),'DN008':('Đoàn Văn Triệu','Anh Triệu'),'DN009':('Trần Thị Thanh Huyền','Chị Huyền'),'DN010':('Trần Quốc Cường','Anh Cường'),'DN011':('Phan Tuấn','Anh Tuấn'),'DN012':('Đặng Thị Hồng Hạnh','Chị Hạnh'),'DN016':('Trần Thị Ngọc Ánh','Chị Ánh'),'DN017':('Trần Trịnh Kiều Oanh','Chị Oanh'),'DN018':('Nguyễn Huỳnh Phương Mai','Chị Mai'),'DN019':('Dương Thị Mến','Chị Mến'),'DN024':('Hoàng Văn Hà','Anh Hà')}

def money(n): return f"{round(float(n)):,}".replace(',', '.')+'đ'
def pct(n): return f"{n:.1f}%".replace('.', ',')

def agg(items, key):
    d=defaultdict(float)
    for r in items:
        d[key(r)]+=float(r.get('REVENUE') or 0)
    return sorted(d.items(), key=lambda kv: kv[1], reverse=True)

total=sum(float(r.get('REVENUE') or 0) for r in rows)
by_nv=agg(rows, lambda r: r.get('EMP_NUMBER') or '#N/A')
rank={code:i+1 for i,(code,rev) in enumerate(by_nv)}
company_routes=agg(rows, lambda r: r.get('TUYEN') or '#N/A')
company_top_nv=by_nv[:10]
summary=[]
all_codes=[c for c,_ in by_nv if c and c!='#N/A']
email_codes=[c for c in all_codes if c in target_by_code and target_by_code[c].get('email')]
missing_email=[c for c in all_codes if c not in email_codes]

STYLE='''
body{margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033}.wrap{max-width:880px;margin:0 auto;background:#fff}.hero{background:linear-gradient(135deg,#0b5cad,#0c8ac8);color:#fff;padding:24px 28px}.hero img{height:54px;background:white;border-radius:10px;padding:8px}.h1{font-size:24px;font-weight:700;margin:16px 0 6px}.sub{font-size:14px;opacity:.95}.content{padding:24px 28px}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1;min-width:160px;background:#f1f7ff;border:1px solid #d8eaff;border-radius:12px;padding:14px}.label{font-size:12px;color:#4b607a;text-transform:uppercase}.value{font-size:22px;font-weight:700;color:#0b5cad;margin-top:5px}.note{background:#fff7e6;border-left:4px solid #f0a000;padding:12px;border-radius:8px;margin:14px 0;font-size:14px}.section{margin-top:22px}.section h2{font-size:18px;color:#0b5cad;margin:0 0 10px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px 8px;border-bottom:1px solid #e8edf5;text-align:left}th{background:#f4f8ff;color:#244766}.right{text-align:right}.badge{display:inline-block;border-radius:999px;padding:4px 9px;background:#eaf6ef;color:#13783a;font-size:12px}.warn{background:#fff0f0;color:#a80000}.footer{padding:20px 28px;background:#eef3f9;color:#42546a;font-size:12px}.qr{height:72px}.small{font-size:12px;color:#667}ul{margin-top:8px}li{margin:6px 0}.pre{white-space:pre-wrap}.brand{display:flex;align-items:center;justify-content:space-between;gap:16px}.brand-title{font-size:13px;letter-spacing:.04em;opacity:.95}.delta-pos{color:#0a7a38}.delta-neg{color:#c0392b}
'''

def rows_table(pairs, limit=8):
    out='<table><tr><th>Nội dung</th><th class="right">Doanh thu</th><th class="right">Tỷ trọng</th></tr>'
    for k,v in pairs[:limit]:
        out+=f'<tr><td>{html.escape(str(k))}</td><td class="right">{money(v)}</td><td class="right">{pct(v/total*100 if total else 0)}</td></tr>'
    out+='</table>'
    return out

for code,rev in by_nv:
    if code=='#N/A': continue
    nv_rows=[r for r in rows if (r.get('EMP_NUMBER') or '#N/A')==code]
    t=target_by_code.get(code,{})
    name=t.get('name') or fallback.get(code,('', 'Anh/Chị'))[0] or code
    salute=t.get('salute') or fallback.get(code,('', 'Anh/Chị'))[1]
    email=t.get('email','')
    routes=agg(nv_rows, lambda r:r.get('TUYEN') or '#N/A')
    units=agg(nv_rows, lambda r:r.get('DONVI') or '(trống)')
    items=agg(nv_rows, lambda r:(r.get('ITEM_NAME') or '(trống)'))
    vendors=agg(nv_rows, lambda r:(r.get('NHA_THAU') or '(trống)'))
    dates=agg(nv_rows, lambda r:r.get('DATE') or '(trống)')
    t05=t.get('dt_t05')
    delta=None
    if t05:
        delta=(rev-float(t05))/float(t05)*100
    comment=[]
    if rank.get(code,999)<=5:
        comment.append('Doanh thu thuộc nhóm dẫn đầu, cần giữ nhịp chăm sóc các đơn vị lớn và tránh hụt hàng ở mặt hàng chủ lực.')
    elif delta is not None and delta>=0:
        comment.append('T06 tăng so với T05, nên rà lại các đơn vị/mặt hàng tăng tốt để nhân rộng trong T07.')
    elif delta is not None and delta<-20:
        comment.append('T06 giảm đáng chú ý so với T05, cần rà các đơn vị giảm/đơn hàng chưa phát sinh để có kế hoạch bù trong T07.')
    else:
        comment.append('Cần tập trung vào nhóm đơn vị và mặt hàng đang chiếm tỷ trọng cao để giữ doanh số nền.')
    if units:
        comment.append(f'Đơn vị trọng tâm tháng 06: {units[0][0]} ({money(units[0][1])}).')
    if items:
        comment.append(f'Mặt hàng trọng tâm tháng 06: {items[0][0]} ({money(items[0][1])}).')
    delta_html='Chưa có dữ liệu T05 để so sánh'
    delta_plain='Chưa có dữ liệu T05 để so sánh'
    if delta is not None:
        cls='delta-pos' if delta>=0 else 'delta-neg'
        sign='+' if delta>=0 else ''
        delta_html=f'<span class="{cls}">{sign}{pct(delta)}</span> so với T05 ({money(t05)})'
        delta_plain=f'{sign}{pct(delta)} so với T05 ({money(t05)})'
    html_body=f'''<!doctype html><html><head><meta charset="utf-8"><style>{STYLE}</style></head><body><div class="wrap">
<div class="hero"><div class="brand"><div><div class="brand-title">DONAPHARM • APP REPORT</div><div class="h1">Báo cáo doanh thu T06/2026</div><div class="sub">Kính gửi {html.escape(salute)} - {html.escape(code)} • {html.escape(name)}</div></div><img src="cid:logo_dona" alt="DONAPHARM"></div></div>
<div class="content">
<div class="note"><b><i>Ghi chú: đây là dữ liệu trích xuất từ hệ thống CRM/App Report, nên chưa thể coi là doanh số chính thức, vì chưa bao gồm số chứng từ kèm theo.</i></b></div>
<div class="cards"><div class="card"><div class="label">Doanh thu T06</div><div class="value">{money(rev)}</div></div><div class="card"><div class="label">Xếp hạng</div><div class="value">#{rank.get(code)}</div></div><div class="card"><div class="label">Tỷ trọng công ty</div><div class="value">{pct(rev/total*100 if total else 0)}</div></div><div class="card"><div class="label">So với T05</div><div class="value" style="font-size:16px">{delta_html}</div></div></div>
<div class="section"><h2>1. Cơ cấu doanh thu theo tuyến</h2>{rows_table(routes,10)}</div>
<div class="section"><h2>2. Top đơn vị/bệnh viện</h2>{rows_table(units,10)}</div>
<div class="section"><h2>3. Top mặt hàng</h2>{rows_table(items,10)}</div>
<div class="section"><h2>4. Nhận xét & hành động T07</h2><ul>{''.join('<li>'+html.escape(x)+'</li>' for x in comment)}<li>Đề nghị phản hồi lại các đơn vị có nguy cơ giảm đơn và kế hoạch giữ doanh số chủ lực trong tháng 07/2026.</li></ul></div>
<div class="section"><h2>5. Thông tin tổng quan công ty</h2><table><tr><td>Tổng doanh thu T06/2026</td><td class="right">{money(total)}</td></tr><tr><td>Số dòng dữ liệu</td><td class="right">{len(rows)}</td></tr></table></div>
</div><div class="footer"><div style="display:flex;justify-content:space-between;gap:16px;align-items:center"><div><b>DONAPHARM – Hệ thống báo cáo điều hành bán hàng nội bộ</b><br>Developed by Donapharm • Công ty TNHH Dược phẩm DONAPHARM<br>CEO: Đặng Xuân Trung • Website: donapharm.vn<br><span class="small">Email chỉ dùng nội bộ, vui lòng không chuyển tiếp ra ngoài nếu chưa được phép.</span></div><img class="qr" src="cid:qr_zalo" alt="Zalo OA"></div></div>
</div></body></html>'''
    plain=f'''DONAPHARM - APP REPORT\nBÁO CÁO DOANH THU T06/2026\n\nKính gửi {salute} - {code} • {name}\n\nGhi chú: đây là dữ liệu trích xuất từ hệ thống CRM/App Report, nên chưa thể coi là doanh số chính thức, vì chưa bao gồm số chứng từ kèm theo.\n\n1) KẾT QUẢ CHÍNH\n- Doanh thu T06: {money(rev)}\n- Xếp hạng: #{rank.get(code)}\n- Tỷ trọng công ty: {pct(rev/total*100 if total else 0)}\n- So với T05: {delta_plain}\n\n2) THEO TUYẾN\n''' + '\n'.join(f'- {k}: {money(v)}' for k,v in routes) + '\n\n3) TOP ĐƠN VỊ\n' + '\n'.join(f'- {k}: {money(v)}' for k,v in units[:10]) + '\n\n4) TOP MẶT HÀNG\n' + '\n'.join(f'- {k}: {money(v)}' for k,v in items[:10]) + '\n\n5) NHẬN XÉT & HÀNH ĐỘNG T07\n' + '\n'.join(f'- {x}' for x in comment) + '\n- Đề nghị phản hồi lại các đơn vị có nguy cơ giảm đơn và kế hoạch giữ doanh số chủ lực trong tháng 07/2026.\n\nDONAPHARM – Hệ thống báo cáo điều hành bán hàng nội bộ\n'
    (OUT/f'{code}_T06_2026_EMAIL_V3.html').write_text(html_body, encoding='utf-8')
    (OUT/f'{code}_T06_2026_EMAIL_V3.txt').write_text(plain, encoding='utf-8')
    summary.append({'code':code,'name':name,'email':email,'salute':salute,'revenue_t06':rev,'rank':rank.get(code),'share_pct':rev/total*100 if total else 0,'revenue_t05':t05,'delta_pct':delta,'units':len(set(r.get('DONVI') for r in nv_rows)),'items':len(set(r.get('ITEM_NAME') for r in nv_rows)),'top_unit':units[0] if units else None,'top_item':items[0] if items else None,'has_email':bool(email)})

# CEO summary report
summary_sorted=sorted(summary,key=lambda x:x['revenue_t06'], reverse=True)
json.dump({'totalRevenue':total,'rows':len(rows),'byNv':summary_sorted,'emailCodes':email_codes,'missingEmailCodes':missing_email,'generatedAt':datetime.now().isoformat()}, open(OUT/'summary_t06_employee_reports.json','w',encoding='utf-8'), ensure_ascii=False, indent=2)
md=[]
md.append('# Báo cáo phân tích doanh thu từng NV - T06/2026')
md.append(f'- Tổng doanh thu: {money(total)}')
md.append(f'- Số dòng dữ liệu: {len(rows)}')
md.append(f'- Số mã NV có doanh thu: {len(all_codes)}')
md.append(f'- Có email để gửi: {len(email_codes)} mã')
if missing_email: md.append(f'- Chưa có email/không nằm danh sách gửi chuẩn: {", ".join(missing_email)}')
md.append('\n## Xếp hạng doanh thu NV')
md.append('| Hạng | Mã NV | Họ tên | Doanh thu T06 | Tỷ trọng | So T05 | Top đơn vị | Top mặt hàng | Email |')
md.append('|---:|---|---|---:|---:|---:|---|---|---|')
for s in summary_sorted:
    d='-' if s['delta_pct'] is None else (('+' if s['delta_pct']>=0 else '')+pct(s['delta_pct']))
    topu=f"{s['top_unit'][0]} ({money(s['top_unit'][1])})" if s['top_unit'] else ''
    topi=f"{s['top_item'][0]} ({money(s['top_item'][1])})" if s['top_item'] else ''
    md.append(f"| {s['rank']} | {s['code']} | {s['name']} | {money(s['revenue_t06'])} | {pct(s['share_pct'])} | {d} | {topu} | {topi} | {s['email'] or 'CHƯA CÓ'} |")
(OUT/'BAO_CAO_PHAN_TICH_NV_T06_2026.md').write_text('\n'.join(md)+'\n',encoding='utf-8')
# Send script, not executed until approved
send_script=r'''import json, time, ssl, smtplib, mimetypes
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
from email.utils import formatdate, make_msgid
BASE=Path('/home/osboxes/.openclaw/workspace-report/t06_2026_employee_reports')
LOGO=Path('/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/logo_dona.png')
QR=Path('/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/qr_zalo_oa_dona.png')
SMTP_HOST='smtp.gmail.com'; SMTP_PORT=465; SMTP_USER='trung.ceo@donapharm.vn'; SMTP_PASS='__SMTP_PASS_FROM_SECURE_LOCAL_SCRIPT__'
# Do not run this generated script until CEO approval. Fill SMTP_PASS from existing secure sender script at runtime if needed.
SUMMARY=json.load(open(BASE/'summary_t06_employee_reports.json',encoding='utf-8'))
TARGETS=[x for x in SUMMARY['byNv'] if x.get('has_email')]
def attach_img(msg,path,cid):
    img=MIMEImage(path.read_bytes(), _subtype=(mimetypes.guess_type(str(path))[0] or 'image/png').split('/')[-1])
    img.add_header('Content-ID', f'<{cid}>'); img.add_header('Content-Disposition','inline',filename=path.name); msg.attach(img)
def send_one(s,t):
    code=t['code']; email=t['email']; name=t['name']
    html=(BASE/f'{code}_T06_2026_EMAIL_V3.html').read_text(encoding='utf-8')
    plain=(BASE/f'{code}_T06_2026_EMAIL_V3.txt').read_text(encoding='utf-8')
    subject=f'[DONAPHARM] Báo cáo doanh thu T06.2026 - {code}'
    msg=MIMEMultipart('related'); msg['From']=f'DONAPHARM <{SMTP_USER}>'; msg['To']=email; msg['Subject']=subject; msg['Date']=formatdate(localtime=True); msg['Message-ID']=make_msgid(domain='donapharm.vn')
    alt=MIMEMultipart('alternative'); alt.attach(MIMEText(plain,'plain','utf-8')); alt.attach(MIMEText(html,'html','utf-8')); msg.attach(alt); attach_img(msg,LOGO,'logo_dona'); attach_img(msg,QR,'qr_zalo')
    s.sendmail(SMTP_USER,[email],msg.as_string()); return {'code':code,'name':name,'email':email,'status':'ok','subject':subject}
def main():
    raise SystemExit('This script is a preview placeholder. Use approved sender script with secure SMTP_PASS after CEO approval.')
if __name__=='__main__': main()
'''
(OUT/'send_t06_emails_preview_guarded.py').write_text(send_script,encoding='utf-8')
print(OUT)
print((OUT/'BAO_CAO_PHAN_TICH_NV_T06_2026.md').read_text(encoding='utf-8')[:4000])
