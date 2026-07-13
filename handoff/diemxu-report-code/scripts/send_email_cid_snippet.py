"""Sanitized reference: attach DONAPHARM logo + Zalo QR into HTML email.

Do not commit real SMTP passwords/tokens. Load credentials from env/secret manager.
HTML should reference: <img src="cid:logo_dona"> and <img src="cid:qr_zalo">.
"""
import mimetypes
from pathlib import Path
from email.mime.image import MIMEImage
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formatdate, make_msgid

LOGO = Path('/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/logo_dona.png')
QR = Path('/home/osboxes/.openclaw/workspace-main/webapp_donapharm/public/qr_zalo_oa_dona.png')


def attach_img(msg: MIMEMultipart, path: Path, cid: str) -> None:
    if not path.exists():
        return
    ctype = mimetypes.guess_type(str(path))[0] or 'image/png'
    img = MIMEImage(path.read_bytes(), _subtype=ctype.split('/')[-1])
    img.add_header('Content-ID', f'<{cid}>')
    img.add_header('Content-Disposition', 'inline', filename=path.name)
    msg.attach(img)


def build_related_email(*, smtp_user: str, to: str, subject: str, html: str, plain: str) -> MIMEMultipart:
    msg = MIMEMultipart('related')
    msg['From'] = f'DONAPHARM <{smtp_user}>'
    msg['To'] = to
    msg['Subject'] = subject
    msg['Date'] = formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain='donapharm.vn')

    alt = MIMEMultipart('alternative')
    alt.attach(MIMEText(plain, 'plain', 'utf-8'))
    alt.attach(MIMEText(html, 'html', 'utf-8'))
    msg.attach(alt)

    attach_img(msg, LOGO, 'logo_dona')
    attach_img(msg, QR, 'qr_zalo')
    return msg
