from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, HRFlowable, Image as RLImage)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.graphics.shapes import Drawing, Rect, Line, String, PolyLine
import datetime, sys, json, os

# ── Palette style email Cockpit ────────────────────────────
NAVY    = colors.HexColor('#0F2444')   # bleu principal email
NAVY2   = colors.HexColor('#1E3A5F')   # bleu section
BLUE    = colors.HexColor('#2563EB')   # badge bleu
GOLD    = colors.HexColor('#F59E0B')   # ambre
GOLD_D  = colors.HexColor('#D97706')
TEAL    = colors.HexColor('#0891B2')   # cyan
TEAL_D  = colors.HexColor('#0E7490')
GREEN   = colors.HexColor('#15803D')
RED     = colors.HexColor('#DC2626')
CORAL   = colors.HexColor('#EF4444')
PURPLE  = colors.HexColor('#7C3AED')
GRAY    = colors.HexColor('#374151')
GRAY2   = colors.HexColor('#6B7280')
LGRAY   = colors.HexColor('#F8FAFC')   # fond léger email
LGRAY2  = colors.HexColor('#E2E8F0')
MGRAY   = colors.HexColor('#CBD5E1')
WHITE   = colors.white
GOLD_L  = colors.HexColor('#FEF3C7')
TEAL_L  = colors.HexColor('#ECFEFF')
CORAL_L = colors.HexColor('#FEE2E2')
GREEN_L = colors.HexColor('#DCFCE7')
BLUE_L  = colors.HexColor('#EFF6FF')

W, H = A4
M  = 1.8*cm
PW = W - 2*M

def S(name, **kw):
    return ParagraphStyle(name, **kw)

sTitle  = S('T',  fontSize=24, textColor=WHITE, fontName='Helvetica-Bold',
            alignment=TA_CENTER, spaceAfter=3, leading=30, spaceBefore=2)
sSub    = S('S',  fontSize=11, textColor=colors.HexColor('#93C5FD'),
            fontName='Helvetica', alignment=TA_CENTER, spaceAfter=2, leading=16)
sMeta   = S('M',  fontSize=8,  textColor=colors.HexColor('#94A3B8'),
            fontName='Helvetica', alignment=TA_CENTER, spaceAfter=2, leading=12)
sH1     = S('H1', fontSize=11, textColor=WHITE, fontName='Helvetica-Bold', leading=15)
sH2     = S('H2', fontSize=10, textColor=NAVY,  fontName='Helvetica-Bold',
            spaceBefore=10, spaceAfter=5, leading=15, leftIndent=0)
sBody   = S('B',  fontSize=9.5, textColor=GRAY, fontName='Helvetica',
            leading=16, spaceAfter=6, leftIndent=0, rightIndent=0, alignment=TA_JUSTIFY)
sIntro  = S('I',  fontSize=10.5, textColor=colors.HexColor('#0C1A0A'),
            fontName='Helvetica',
            backColor=colors.HexColor('#F0FDF4'),
            leftIndent=0, rightIndent=0,
            leading=20, spaceAfter=4, spaceBefore=4,
            alignment=TA_LEFT)
sNote   = S('N',  fontSize=9, textColor=colors.HexColor('#1E3A5F'), fontName='Helvetica',
            backColor=BLUE_L, leftIndent=0, rightIndent=0,
            leading=14, spaceAfter=4, spaceBefore=2)
sGood   = S('G',  fontSize=9, textColor=colors.HexColor('#064E3B'), fontName='Helvetica',
            backColor=GREEN_L, leftIndent=0, rightIndent=0,
            leading=14, spaceAfter=4)
sWarn   = S('W',  fontSize=9, textColor=colors.HexColor('#7F1D1D'), fontName='Helvetica',
            backColor=CORAL_L, leftIndent=0, rightIndent=0,
            leading=14, spaceAfter=4)
sTH     = S('TH', fontSize=8.5, textColor=WHITE, fontName='Helvetica-Bold',
            alignment=TA_CENTER, leading=13)
sTD     = S('TD', fontSize=9,   textColor=GRAY,  fontName='Helvetica', leading=13)
sTDc    = S('TDc',fontSize=9,   textColor=NAVY,  fontName='Helvetica',
            alignment=TA_CENTER, leading=13)
sTDr    = S('TDr',fontSize=9,   textColor=NAVY,  fontName='Helvetica',
            alignment=TA_CENTER, leading=13)
sKV     = S('KV', fontSize=24, textColor=NAVY,  fontName='Helvetica-Bold',
            alignment=TA_CENTER, leading=30)
sKL     = S('KL', fontSize=8,  textColor=GRAY2, fontName='Helvetica',
            alignment=TA_CENTER, leading=12)

fmt    = lambda n: f'{int(n):,}'.replace(',', ' ')
fmtTND = lambda n: f'{fmt(n)} TND'
fmtP   = lambda n: f'{float(n):.1f}%'

def section_hdr(text, color=None, icon=''):
    col  = color or NAVY
    # Badge + titre sur fond coloré — style email Cockpit
    badge_col = colors.HexColor('#3B82F6')
    sH1x = S('H1x', fontSize=11, textColor=WHITE, fontName='Helvetica-Bold', leading=16)
    sBadge = S('Bdg', fontSize=7, textColor=WHITE, fontName='Helvetica-Bold',
               leading=10, alignment=TA_CENTER)
    cells = [[Paragraph(text, sH1x)]]
    tbl = Table(cells, colWidths=[PW],
        style=TableStyle([
            ('BACKGROUND',    (0,0),(-1,-1), col),
            ('TOPPADDING',    (0,0),(-1,-1), 11),
            ('BOTTOMPADDING', (0,0),(-1,-1), 11),
            ('LEFTPADDING',   (0,0),(-1,-1), 16),
            ('RIGHTPADDING',  (0,0),(-1,-1), 12),
            ('LINEBELOW',     (0,0),(-1,-1), 2, GOLD),
        ]))
    return [Spacer(1,14), tbl, Spacer(1,6)]

def kpi_tbl(items):
    n = len(items)
    cw = [PW/n]*n
    r1 = [Paragraph(v, sKV) for _,v,_ in items]
    r2 = [Paragraph(l, sKL) for l,_,_ in items]
    r3 = [Paragraph(s or '', sKL) for _,_,s in items]
    return Table([r1,r2,r3], colWidths=cw, style=TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), LGRAY),
        ('BOX',           (0,0),(-1,-1), 0.5, MGRAY),
        ('INNERGRID',     (0,0),(-1,-1), 0.5, MGRAY),
        ('TOPPADDING',    (0,0),(-1,-1), 10),
        ('BOTTOMPADDING', (0,0),(-1,-1), 10),
    ]))

def bar_tbl(items, total, col=TEAL, hdr_col=NAVY):
    sBar = S('bar', fontSize=5.5, textColor=col, fontName='Helvetica', leading=9)
    sLbl = S('lbl', fontSize=8.5, textColor=GRAY, fontName='Helvetica', leading=12)
    sNum = S('num', fontSize=8.5, textColor=NAVY, fontName='Helvetica-Bold',
             alignment=TA_CENTER, leading=12)
    sPct = S('pct', fontSize=8.5, textColor=col,  fontName='Helvetica-Bold',
             alignment=TA_CENTER, leading=12)
    rows = [[Paragraph(h, sTH) for h in ['Libellé', 'Répartition', 'Nb', '%']]]
    for name, cnt in items:
        if not cnt: continue
        p = int(cnt/total*100) if total else 0
        bar = chr(9612) * min(int(p*0.55), 44)
        rows.append([
            Paragraph(str(name)[:52], sLbl),
            Paragraph(bar, sBar),
            Paragraph(fmt(cnt), sNum),
            Paragraph(f'{p} %', sPct),
        ])
    tbl = Table(rows, colWidths=[8.5*cm, 5.5*cm, 2.2*cm, 1.2*cm],
        style=TableStyle([
            ('BACKGROUND',    (0,0),(-1,0),  hdr_col),
            ('FONTSIZE',      (0,0),(-1,0),  8.5),
            ('ROWBACKGROUNDS',(0,1),(-1,-1), [WHITE, LGRAY]),
            ('LINEBELOW',     (0,0),(-1,-1), 0.3, MGRAY),
            ('LINEAFTER',     (0,0),(-1,-1), 0.3, MGRAY),
            ('TOPPADDING',    (0,0),(-1,-1), 5),
            ('BOTTOMPADDING', (0,0),(-1,-1), 5),
            ('LEFTPADDING',   (0,0),(-1,-1), 7),
            ('RIGHTPADDING',  (0,0),(-1,-1), 5),
            ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
        ]))
    return tbl

def simple_tbl(headers, rows, hdr_col=NAVY, col_widths=None, last_bold=True):
    cw = col_widths or [PW/len(headers)]*len(headers)
    data = [[Paragraph(h, sTH) for h in headers]]
    n = len(rows)
    for i, row in enumerate(rows):
        is_last = (i == n-1) and last_bold
        st = S(f'td{i}', fontSize=9,
               textColor=NAVY if not is_last else NAVY,
               fontName='Helvetica-Bold' if is_last else 'Helvetica',
               alignment=TA_CENTER, leading=13)
        stl = S(f'tdl{i}', fontSize=9,
                textColor=NAVY if not is_last else NAVY,
                fontName='Helvetica-Bold' if is_last else 'Helvetica',
                alignment=TA_LEFT, leading=13)
        cells = []
        for j, cell in enumerate(row):
            cells.append(Paragraph(str(cell), stl if j == 0 else st))
        data.append(cells)
    ts = [
        ('BACKGROUND',    (0,0),(-1,0),  hdr_col),
        ('ROWBACKGROUNDS',(0,1),(-1,-2), [WHITE, LGRAY]),
        ('LINEBELOW',     (0,0),(-1,-1), 0.3, MGRAY),
        ('LINEAFTER',     (0,0),(-1,-1), 0.3, MGRAY),
        ('TOPPADDING',    (0,0),(-1,-1), 7),
        ('BOTTOMPADDING', (0,0),(-1,-1), 7),
        ('LEFTPADDING',   (0,0),(-1,-1), 8),
        ('RIGHTPADDING',  (0,0),(-1,-1), 8),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ]
    if last_bold and n > 0:
        ts += [
            ('BACKGROUND',  (0,n),(- 1,n), LGRAY2),
            ('LINEABOVE',   (0,n),(-1,n),  0.8, MGRAY),
        ]
    return Table(data, colWidths=cw, style=TableStyle(ts))

def line_chart(datasets, labels, w_pt, h_pt):
    """
    datasets = [(data_list, color, legend_label), ...]
    labels   = liste des étiquettes X
    """
    pad_l, pad_r, pad_t, pad_b = 45, 15, 22, 35
    cw = w_pt - pad_l - pad_r
    ch = h_pt - pad_t - pad_b
    all_vals = [v for ds,_,_ in datasets for v in ds if v is not None and v > 0]
    if not all_vals: return None
    vmax = max(all_vals) or 1
    n = max(len(labels), 1)
    d = Drawing(w_pt, h_pt)
    d.add(Rect(0,0,w_pt,h_pt, fillColor=colors.HexColor('#F7F8FA'), strokeColor=None))

    # Grilles horizontales
    for i in range(5):
        y = pad_b + ch*i/4
        d.add(Line(pad_l, y, pad_l+cw, y,
                   strokeColor=colors.HexColor('#E2E8F0'), strokeWidth=0.5))
        val = int(vmax*i/4)
        d.add(String(pad_l-4, y-3, str(val),
                     fontSize=6, fillColor=GRAY, textAnchor='end'))

    # Labels X (max 12)
    step = max(1, n//12)
    for i, lbl in enumerate(labels):
        if i % step == 0 or i == n-1:
            x = pad_l + cw*i/max(n-1,1)
            # Format : si contient 'h' ET chiffres → laisser tel quel,
            # sinon formater en jj/mm
            lbl_str = str(lbl)
            d.add(String(x, pad_b-16, lbl_str,
                         fontSize=6, fillColor=GRAY, textAnchor='middle'))

    # Courbes
    def draw_series(data, col):
        pts = []
        for i, v in enumerate(data):
            if v is not None:
                x = pad_l + cw*i/max(n-1,1)
                y = pad_b + ch*(v/vmax)
                pts.append((x,y))
        if len(pts) > 1:
            flat = []
            for p in pts: flat += [p[0], p[1]]
            d.add(PolyLine(flat, strokeColor=col, strokeWidth=1.8, fillColor=None))
        for x,y in pts:
            d.add(Rect(x-2.5, y-2.5, 5, 5, fillColor=col, strokeColor=None))

    for ds, col, _ in datasets:
        draw_series(ds, col)

    # Légende
    lx = pad_l
    for ds, col, lbl in datasets:
        d.add(Rect(lx, h_pt-13, 10, 7, fillColor=col, strokeColor=None))
        d.add(String(lx+12, h_pt-12, lbl, fontSize=7.5, fillColor=GRAY))
        lx += 80

    return d


def pie_chart(items, title, w_pt, h_pt, colors_list=None):
    """
    items = [(label, value), ...]
    Retourne un Drawing avec camembert + légende
    """
    import math
    if not items: return None
    total = sum(v for _, v in items) or 1
    default_colors = [
        colors.HexColor('#E8A33D'), colors.HexColor('#2BC5B4'),
        colors.HexColor('#8B5CF6'), colors.HexColor('#E5556B'),
        colors.HexColor('#0D1B3E'), colors.HexColor('#34D399'),
    ]
    cols = colors_list or default_colors

    pad = 10
    cx = w_pt * 0.38
    cy = h_pt / 2
    r  = min(cx - pad, h_pt/2 - pad - 20) * 0.85

    d = Drawing(w_pt, h_pt)
    d.add(Rect(0, 0, w_pt, h_pt, fillColor=colors.HexColor('#F7F8FA'), strokeColor=None))

    # Titre
    d.add(String(w_pt/2, h_pt - 10, title,
                 fontSize=8.5, fillColor=NAVY, textAnchor='middle',
                 fontName='Helvetica-Bold'))

    # Secteurs
    start_angle = 90
    for i, (lbl, val) in enumerate(items):
        sweep = val / total * 360
        col   = cols[i % len(cols)]
        # Dessiner le secteur via des lignes (approche polygonale)
        steps  = max(3, int(sweep / 3))
        pts    = [cx, cy]
        for s in range(steps + 1):
            a = math.radians(start_angle - s * sweep / steps)
            pts += [cx + r * math.cos(a), cy + r * math.sin(a)]
        from reportlab.graphics.shapes import Polygon
        d.add(Polygon(pts, fillColor=col, strokeColor=WHITE, strokeWidth=1))
        start_angle -= sweep

    # Légende à droite
    lx = cx + r + 15
    ly = h_pt - 25
    for i, (lbl, val) in enumerate(items):
        col = cols[i % len(cols)]
        pct = round(val / total * 100)
        d.add(Rect(lx, ly - i*18, 10, 10, fillColor=col, strokeColor=None))
        label_str = f'{lbl[:22]} — {fmt(val)} ({pct}%)'
        d.add(String(lx + 14, ly - i*18 + 1, label_str,
                     fontSize=7, fillColor=GRAY, fontName='Helvetica'))
    return d

def two_pie_row(items1, title1, items2, title2, w_pt, h_pt):
    """Deux camemberts côte à côte avec chiffres sur secteurs"""
    import math
    half = w_pt / 2
    cols = [
        colors.HexColor('#E8A33D'), colors.HexColor('#2BC5B4'),
        colors.HexColor('#8B5CF6'), colors.HexColor('#E5556B'),
        colors.HexColor('#0D1B3E'), colors.HexColor('#34D399'),
    ]

    def draw_pie(d, items, title, ox, w, h):
        total = sum(v for _, v in items) or 1
        cx = ox + w * 0.35; cy = h / 2
        r  = min(w * 0.26, h/2 - 24)
        d.add(Rect(ox, 0, w, h, fillColor=colors.HexColor('#F7F8FA'), strokeColor=None))
        d.add(String(ox + w/2, h - 12, title, fontSize=8, fillColor=NAVY,
                     textAnchor='middle', fontName='Helvetica-Bold'))
        start_angle = 90
        mid_angles = []
        for i, (lbl, val) in enumerate(items):
            sweep = val/total*360
            col   = cols[i % len(cols)]
            steps = max(3, int(sweep/3))
            pts   = [cx, cy]
            for s in range(steps+1):
                a = math.radians(start_angle - s*sweep/steps)
                pts += [cx + r*math.cos(a), cy + r*math.sin(a)]
            from reportlab.graphics.shapes import Polygon
            d.add(Polygon(pts, fillColor=col, strokeColor=WHITE, strokeWidth=1))
            # Angle milieu pour placer le chiffre
            mid_a = math.radians(start_angle - sweep/2)
            mid_angles.append((mid_a, val, sweep))
            start_angle -= sweep
        # Chiffres sur les secteurs
        for mid_a, val, sweep in mid_angles:
            if sweep < 15: continue  # trop petit
            tx = cx + r * 0.6 * math.cos(mid_a)
            ty = cy + r * 0.6 * math.sin(mid_a)
            d.add(String(tx, ty - 3, fmt(val),
                         fontSize=6.5, fillColor=WHITE, textAnchor='middle',
                         fontName='Helvetica-Bold'))
        # Légende droite
        lx = cx + r + 8; ly = h - 26
        for i, (lbl, val) in enumerate(items):
            col = cols[i % len(cols)]
            pct = round(val/total*100)
            d.add(Rect(lx, ly - i*17, 8, 8, fillColor=col, strokeColor=None))
            d.add(String(lx+11, ly - i*17 + 1, f'{lbl[:16]}',
                         fontSize=6.5, fillColor=GRAY, fontName='Helvetica'))
            d.add(String(lx+11, ly - i*17 - 7, f'{fmt(val)} ({pct}%)',
                         fontSize=6, fillColor=NAVY, fontName='Helvetica-Bold'))

    d = Drawing(w_pt, h_pt)
    draw_pie(d, items1, title1, 0,    half, h_pt)
    draw_pie(d, items2, title2, half, half, h_pt)
    return d

# ── Données par défaut (remplacées par les vraies données) ─
D = dict(
    date_debut='20/08/2026',
    date_fin=datetime.date.today().strftime('%d/%m/%Y'),
    generated=(datetime.datetime.now() + datetime.timedelta(hours=1)).strftime('%d/%m/%Y a %H:%M'),
    enrolled=75416,
    total_tentatives=92000,
    amount=37708000,
    success_rate=81.9,
    adjusted_rate=89.4,
    timeout_count=6840,
    ctp_enrolled=63621,
    psm_enrolled=11795,
    psm_carte=6940,
    psm_wallet=4849,
    web_count=8229,
    mob_count=3343,
    ussd_count=268,
    peak_label='20/08/2026 10h',
    peak_count=4820,
    launch_date='20/08/2026',
    fail_timeout=6840,
    fail_auth3ds=2100,
    fail_banque=1900,
    ctp_networks=[('VISA',42500),('MASTERCARD',18200),('VISA ELECTRON',2921)],
    psm_fsp=[('MY BIAT',4820),('VIAMOBILE',2890),('QNB',1640),('AMEN BANK',1280),('ATB',890),('STB',275)],
    psm_moyen=[('Carte via KIT CNTE',5200),('Wallet IZI Client',3100),('Wallet Flouci',890),('Mobile Poste',605)],
    psm_mode=[('Carte',6940),('Wallet mobile',4849)],
    psm_canal=[('WEB',8229),('MOBILE',3343),('USSD',268)],
    timeline_daily=[
        ('20/08',18473,3890),('21/08',24600,4820),('22/08',20548,3085),
    ],
    timeline_hourly=[
        ('20/08 08h',2100,420),('20/08 09h',4800,980),('20/08 10h',6200,1240),
        ('20/08 11h',5100,1020),('21/08 08h',3200,640),('21/08 09h',4800,960),
        ('21/08 10h',6800,1360),('21/08 11h',5600,1120),('22/08 08h',2800,560),
        ('22/08 09h',4200,840),('22/08 10h',5800,1160),('22/08 11h',4200,840),
    ],
)

# ── Charger les vraies données si passées en argument ──────
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rapport_inscriptions.pdf'

if len(sys.argv) > 2:
    try:
        arg2 = sys.argv[2]
        if arg2.endswith('.json') and os.path.exists(arg2):
            with open(arg2) as jf:
                real = json.load(jf)
        else:
            real = json.loads(arg2)

        if real.get('kpis'):
            kpi  = real.get('kpis', {})
            ins  = real.get('insight', {})
            psm  = real.get('psm', {})
            ctp  = real.get('ctp', {})
            tl   = real.get('timeline', {})
            meta = real.get('meta', {})

            # Construire timeline journalière depuis les buckets
            buckets = tl.get('buckets', [])
            # Regrouper par jour (jj/mm) si mode horaire
            if buckets and not tl.get('byDay', False):
                day_map = {}
                for b in buckets:
                    lbl = b.get('label','')
                    day = lbl[:5] if len(lbl) >= 5 else lbl  # "22/08"
                    if day not in day_map:
                        day_map[day] = [0, 0]
                    day_map[day][0] += b.get('ctp', 0)
                    day_map[day][1] += b.get('psm', 0)
                tl_daily = [(d, v[0], v[1]) for d, v in day_map.items()]
            else:
                tl_daily = [(b.get('label',''), b.get('ctp',0), b.get('psm',0))
                            for b in buckets]

            # Timeline horaire = tous les buckets avec label jj/mm hh
            tl_hourly = []
            for b in buckets:
                lbl = b.get('label','')
                # Reformater label pour afficher date + heure
                if '-' in lbl and len(lbl) >= 13:
                    parts = lbl.split(' ')
                    date_parts = parts[0].split('-')
                    heure = parts[1] if len(parts) > 1 else ''
                    lbl_fmt = f"{date_parts[2]}/{date_parts[1]} {heure}"
                elif len(lbl) <= 4 and 'h' in lbl:
                    df_str = meta.get('df', '')
                    if df_str and len(df_str) >= 5:
                        lbl_fmt = f"{df_str[0:5]} {lbl}"
                    else:
                        lbl_fmt = lbl
                else:
                    lbl_fmt = lbl
                    tl_hourly.append((lbl_fmt, b.get('ctp',0), b.get('psm',0)))

            D.update({
                'date_debut'     : meta.get('dd', D['date_debut']),
                'date_fin'       : meta.get('df', D['date_fin']),
                'generated'      : (datetime.datetime.now() + datetime.timedelta(hours=1)).strftime('%d/%m/%Y a %H:%M'),
                'enrolled'       : kpi.get('enrolled', 0),
                'total_tentatives': kpi.get('total', 0),
                'amount'         : kpi.get('amount', 0),
                'success_rate'   : kpi.get('successRate', 0),
                'adjusted_rate'  : kpi.get('adjustedRate', 0),
                'timeout_count'  : kpi.get('timeoutCount', 0),
                'ctp_enrolled'   : ins.get('ctpEnrolled', 0),
                'psm_enrolled'   : ins.get('psmEnrolled', 0),
                'psm_carte'      : psm.get('carte', 0),
                'psm_wallet'     : psm.get('wallet', 0),
                'psm_virement'   : psm.get('virement', 0),
                'web_count'      : ins.get('webCount', 0),
                'mob_count'      : ins.get('mobCount', 0),
                'ussd_count'     : ins.get('ussdCount', 0),
                'fail_timeout'   : ctp.get('failByCategory', {}).get('timeout', 0),
                'fail_auth3ds'   : ctp.get('failByCategory', {}).get('auth3ds', 0),
                'fail_banque'    : ctp.get('failByCategory', {}).get('banque', 0),
                'peak_label'     : tl.get('peak', {}).get('label', '—') if tl.get('peak') else '—',
                'peak_count'     : (tl.get('peak', {}).get('ctp', 0) + tl.get('peak', {}).get('psm', 0)) if tl.get('peak') else 0,
                'ctp_networks'   : [(n['name'], n['count']) for n in ctp.get('networks', [])],
                'psm_fsp'        : [(n['name'], n['count']) for n in psm.get('fsp', [])],
                'psm_moyen'      : [(n['name'], n['count']) for n in psm.get('moyen', [])],
                'psm_mode'       : [(n['name'], n['count']) for n in psm.get('mode', [])],
                'psm_canal'      : [(n['name'], n['count']) for n in psm.get('canal', [])],
                'timeline_daily' : tl_daily,
                'timeline_hourly': tl_hourly,
            })
    except Exception as e:
        print(f'[rapport] Erreur chargement données: {e}', file=sys.stderr)

D.setdefault('psm_virement', 0)
total_cartes = D['ctp_enrolled'] + D['psm_carte']

# ── Document ───────────────────────────────────────────────
def footer(canvas, doc):
    canvas.saveState()
    # Bande footer NAVY
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, W, 1.8*cm, fill=1, stroke=0)
    # Ligne dorée au dessus
    canvas.setFillColor(GOLD)
    canvas.rect(0, 1.8*cm, W, 0.12*cm, fill=1, stroke=0)
    # Texte
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(colors.HexColor('#94A3B8'))
    canvas.drawString(M, 0.9*cm, 'Monétique Tunisie — Document confidentiel')
    canvas.setFillColor(colors.HexColor('#93C5FD'))
    canvas.setFont('Helvetica-Bold', 7)
    canvas.drawCentredString(W/2, 0.9*cm, 'SMT  ·  ClicToPay  ·  Paysmart')
    canvas.setFillColor(colors.HexColor('#94A3B8'))
    canvas.setFont('Helvetica', 7)
    canvas.drawRightString(W-M, 0.9*cm, f'Page {doc.page}')
    canvas.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4,
      leftMargin=M, rightMargin=M, topMargin=1.5*cm, bottomMargin=2*cm)
story = []

# Logos
sMT  = S('mt',  fontSize=13, textColor=colors.HexColor('#4A90A4'), fontName='Helvetica-Bold', alignment=TA_CENTER, leading=17)
sPS  = S('ps',  fontSize=13, textColor=colors.HexColor('#00C4B4'), fontName='Helvetica-Bold', alignment=TA_CENTER, leading=17)
sCTP = S('ctp', fontSize=13, textColor=colors.HexColor('#E8A33D'), fontName='Helvetica-Bold', alignment=TA_CENTER, leading=17)
sSub3 = S('sb3', fontSize=7, textColor=colors.HexColor('#94A3B8'), fontName='Helvetica', alignment=TA_CENTER, leading=10)

logos = Table([[
    Table([[Paragraph('Monétique', sMT)],[Paragraph('Tunisie', sMT)]], colWidths=[PW/3-8],
          style=TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                            ('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2)])),
    Table([[Paragraph('Paysmart', sPS)],[Paragraph('by Monétique Tunisie', sSub3)]], colWidths=[PW/3-8],
          style=TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                            ('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2)])),
    Table([[Paragraph('ClicToPay', sCTP)]], colWidths=[PW/3-8],
          style=TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                            ('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2)])),
]],
    colWidths=[PW/3, PW/3, PW/3],
    style=TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), WHITE),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
        ('ALIGN',         (0,0),(-1,-1), 'CENTER'),
        ('TOPPADDING',    (0,0),(-1,-1), 14),
        ('BOTTOMPADDING', (0,0),(-1,-1), 14),
        ('LEFTPADDING',   (0,0),(-1,-1), 4),
        ('RIGHTPADDING',  (0,0),(-1,-1), 4),
        ('LINEAFTER',     (0,0),(1,-1),  0.5, colors.HexColor('#E2E8F0')),
    ]))

# ── Header style email : fond NAVY avec titre centré ──────
from reportlab.platypus import KeepTogether
from reportlab.graphics.shapes import Rect as GRect

sHdrTitle = S('HT', fontSize=22, textColor=WHITE, fontName='Helvetica-Bold',
              alignment=TA_CENTER, leading=28, spaceBefore=0, spaceAfter=2)
sHdrSub   = S('HS', fontSize=11, textColor=colors.HexColor('#93C5FD'),
              fontName='Helvetica', alignment=TA_CENTER, leading=16, spaceAfter=2)
sHdrMeta  = S('HM', fontSize=8,  textColor=colors.HexColor('#94A3B8'),
              fontName='Helvetica', alignment=TA_CENTER, leading=12, spaceAfter=0)
sHdrConf  = S('HC', fontSize=8,  textColor=GOLD, fontName='Helvetica-Bold',
              alignment=TA_CENTER, leading=12)

# ── Zone logos : fond blanc centré ───────────────────────
story.append(Table(
    [[logos]],
    colWidths=[PW],
    style=TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), WHITE),
        ('TOPPADDING',    (0,0),(-1,-1), 0),
        ('BOTTOMPADDING', (0,0),(-1,-1), 0),
        ('LEFTPADDING',   (0,0),(-1,-1), 0),
        ('RIGHTPADDING',  (0,0),(-1,-1), 0),
    ])))
story.append(HRFlowable(width=PW, thickness=3, color=GOLD, spaceAfter=0))

# ── Zone titre : fond NAVY ────────────────────────────────
titre_items = [
    Spacer(1, 10),
    Paragraph('Rapport de suivi des inscriptions scolaires', sHdrTitle),
    Paragraph('Campagne nationale de paiement en ligne — Tunisie', sHdrSub),
    Spacer(1, 6),
    Paragraph(f'Campagne du {D["date_debut"]} au {D["date_fin"]}', sHdrMeta),
    Paragraph(f'Généré le {D["generated"]} — CONFIDENTIEL', sHdrConf),
    Spacer(1, 10),
]
story.append(Table(
    [[item] for item in titre_items],
    colWidths=[PW],
    style=TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), NAVY),
        ('TOPPADDING',    (0,0),(-1,-1), 0),
        ('BOTTOMPADDING', (0,0),(-1,-1), 0),
        ('LEFTPADDING',   (0,0),(-1,-1), 0),
        ('RIGHTPADDING',  (0,0),(-1,-1), 0),
    ])))
story.append(HRFlowable(width=PW, thickness=4, color=GOLD, spaceAfter=8))
story.append(Spacer(1, 4))

# ── SECTION 1 : Situation ──────────────────────────────────
# Titre = date et heure de génération du rapport
gen_date = D['generated'].split(' a ')[0].upper()
gen_heure = D['generated'].split(' a ')[1] if ' a ' in D['generated'] else ''
story += section_hdr(f'SITUATION AU {gen_date} A {gen_heure}')

# ── Normaliser les buckets en liste [label, ctp, psm] ────
def _norm_label(lbl):
    """Normalise une clé date vers DD/MM"""
    lbl = str(lbl).strip()
    if len(lbl) == 10 and lbl[4] == '-':   # 2026-08-24
        return f"{lbl[8:10]}/{lbl[5:7]}"
    if len(lbl) > 5 and ' ' in lbl:         # 24/08 09h ou 2026-08-24 09h
        return _norm_label(lbl.split(' ')[0])
    return lbl[:5] if len(lbl) >= 5 else lbl

tl_raw = D.get('timeline_daily', []) or D.get('timeline_hourly', [])

# Agréger par jour normalisé (DD/MM)
day_agg = {}
for b in tl_raw:
    lbl = b[0] if isinstance(b,(list,tuple)) else b.get('label','')
    cv  = int(b[1] if isinstance(b,(list,tuple)) else b.get('ctp',0) or 0)
    pv  = int(b[2] if isinstance(b,(list,tuple)) else b.get('psm',0) or 0)
    day_key = _norm_label(lbl)
    if day_key not in day_agg:
        day_agg[day_key] = [day_key, 0, 0]
    day_agg[day_key][1] += cv
    day_agg[day_key][2] += pv

tl_data = sorted(day_agg.values(), key=lambda x: x[0])

# Dernier jour non-vide
today_ctp = 0; today_psm = 0; today_label = ''
veille_ctp = 0; veille_psm = 0

non_empty = [b for b in tl_data if b[1]+b[2] > 0]
if non_empty:
    last = non_empty[-1]
    today_ctp = last[1]; today_psm = last[2]; today_label = last[0]
if len(non_empty) >= 2:
    prev = non_empty[-2]
    veille_ctp = prev[1]; veille_psm = prev[2]

evol = (today_ctp + today_psm) - (veille_ctp + veille_psm)
evol_str = ('+' if evol >= 0 else '') + fmt(abs(evol))
evol_pct  = f' ({round(evol/(veille_ctp+veille_psm)*100):+}%)' if (veille_ctp+veille_psm) > 0 else ''

intro_global = (
    f'Depuis le lancement de la campagne le <b>{D["date_debut"]}</b>, '
    f'<b>{fmt(D["enrolled"])} élèves</b> ont été inscrits via le système SMT, '
    f'dont <b>{fmt(D["ctp_enrolled"])}</b> par carte bancaire directement via ClicToPay '
    f'(incluant {fmt(D["psm_carte"])} paiements via le site Paysmart) '
    f'et <b>{fmt(D["psm_wallet"])}</b> par portefeuille mobile Paysmart. '
    f'Le montant total encaissé s\'élève à <b>{fmtTND(D["amount"])}</b>, '
    f'avec un taux de réussite de <b>{fmtP(D["success_rate"])}</b> '
    f'(taux ajusté hors sessions expirées : <b>{fmtP(D["adjusted_rate"])}</b>). '
    f'Les paiements Paysmart se répartissent sur {fmt(D["web_count"])} transactions WEB, '
    f'{fmt(D["mob_count"])} MOBILE et {fmt(D["ussd_count"])} USSD.'
)
story.append(Paragraph(intro_global, sIntro))
story.append(Spacer(1,6))

if today_label:
    intro_jour = (
        f'<b>Journée du {today_label} :</b> '
        f'<b>{fmt(today_ctp + today_psm)}</b> inscriptions enregistrées '
        f'— {fmt(today_ctp)} via ClicToPay et {fmt(today_psm)} via Paysmart'
        + (f' — évolution vs veille : <b>{evol_str}{evol_pct}</b>.' if len(tl_data) >= 2 else '.')
    )
    story.append(Paragraph(intro_jour, sNote))
    story.append(Spacer(1,6))

nota = (
    f'<b>Méthodologie :</b> Les {fmt(D["psm_carte"])} paiements par carte via Paysmart '
    f'transitent par ClicToPay et sont déjà inclus dans les {fmt(D["ctp_enrolled"])} inscriptions CTP. '
    f'Total = {fmt(D["ctp_enrolled"])} (cartes CTP) + {fmt(D["psm_wallet"])} (wallets) = {fmt(D["enrolled"])}.'
)
story.append(Paragraph(nota, sGood))
story.append(Spacer(1,10))


# Deux camemberts côte à côte
pie_ctp = [
    ('CTP direct', max(D['ctp_enrolled'] - D['psm_carte'], 0)),
    ('Via site Paysmart', D['psm_carte']),
]
pie_psm = [
    ('Cartes (via CTP)', D['psm_carte']),
    ('Portefeuille mobile',   D['psm_wallet']),
]
if D.get('psm_virement', 0) > 0:
    pie_psm.append(('Virement', D['psm_virement']))

dpie = two_pie_row(
    pie_ctp, 'Répartition ClicToPay',
    pie_psm, 'Répartition Paysmart',
    PW, 120
)
story.append(dpie)
story.append(Spacer(1,10))

# ── SECTION 2 : Evolution ─────────────────────────────────
story += section_hdr('ÉVOLUTION TEMPORELLE — CLICTOPAY VS PAYSMART', TEAL_D)

# Utiliser tl_data déjà agrégé et normalisé par jour
tl_for_chart = [b for b in tl_data if b[1]+b[2] > 0]


if tl_for_chart:
    labels   = [r[0] for r in tl_for_chart]
    data_ctp = [r[1] for r in tl_for_chart]
    data_psm = [r[2] for r in tl_for_chart]
    chart = line_chart(
        [(data_ctp, colors.HexColor('#E8A33D'), 'ClicToPay'),
         (data_psm, colors.HexColor('#2BC5B4'), 'Paysmart')],
        labels, PW, 130)
    if chart:
        story.append(chart)
        story.append(Spacer(1,4))
    # Tableau journalier compact avec chiffres
    rows_j = [[r[0], fmt(r[1]), fmt(r[2]), fmt(r[1]+r[2])] for r in tl_for_chart]
    rows_j.append(['TOTAL',
        fmt(sum(r[1] for r in tl_for_chart)),
        fmt(sum(r[2] for r in tl_for_chart)),
        fmt(sum(r[1]+r[2] for r in tl_for_chart))])
    tbl_j = Table(
        [[Paragraph(h, sTH) for h in ['Date', 'ClicToPay', 'Paysmart', 'Total']]] +
        [[Paragraph(str(cell), sTDc) for cell in row] for row in rows_j],
        colWidths=[PW*0.28, PW*0.24, PW*0.24, PW*0.24],
        style=TableStyle([
            ('BACKGROUND',    (0,0),(-1,0),  TEAL_D),
            ('BACKGROUND',    (0,-1),(-1,-1),LGRAY2),
            ('FONTNAME',      (0,-1),(-1,-1),'Helvetica-Bold'),
            ('ROWBACKGROUNDS',(0,1),(-1,-2), [WHITE, LGRAY]),
            ('GRID',          (0,0),(-1,-1), 0.3, MGRAY),
            ('TOPPADDING',    (0,0),(-1,-1), 4),
            ('BOTTOMPADDING', (0,0),(-1,-1), 4),
        ]))
    story.append(tbl_j)
    story.append(Spacer(1,8))

# ── SECTION 3 : Repartition ───────────────────────────────
story += section_hdr('RÉPARTITION PAR PLATEFORME, MODE ET CANAL', NAVY2)

# Tableau plateforme
ctp_pct = round(D['ctp_enrolled']/D['enrolled']*100) if D['enrolled'] else 0
psm_c_pct = round(D['psm_carte']/D['enrolled']*100) if D['enrolled'] else 0
psm_w_pct = round(D['psm_wallet']/D['enrolled']*100) if D['enrolled'] else 0
plat_rows = [
    ['Cartes bancaires (ClicToPay)', fmt(D['ctp_enrolled']), f'{ctp_pct}%'],
    ['Portefeuille mobile (Paysmart)',     fmt(D['psm_wallet']),   f'{psm_w_pct}%'],
]
if D.get('psm_virement', 0) > 0:
    psm_v_pct = round(D['psm_virement']/D['enrolled']*100) if D['enrolled'] else 0
    plat_rows.append(['Virement (Paysmart)', fmt(D['psm_virement']), f'{psm_v_pct}%'])
plat_rows.append(['TOTAL élèves inscrits', fmt(D['enrolled']), '100%'])
story.append(simple_tbl(
    ['Moyen de paiement', 'Inscrits', 'Part'],
    plat_rows,
    hdr_col=NAVY, col_widths=[11*cm, 3.8*cm, 2.6*cm]
))
story.append(Spacer(1,8))

# Canaux
story.append(Table([[Paragraph('Canaux de paiement Paysmart (WEB / MOBILE / USSD)',
    S('h2c', fontSize=10, textColor=TEAL_D, fontName='Helvetica-Bold', leading=14,
      leftIndent=0, spaceBefore=8, spaceAfter=4))]],
    colWidths=[PW],
    style=TableStyle([
        ('TOPPADDING',(0,0),(-1,-1),2), ('BOTTOMPADDING',(0,0),(-1,-1),2),
        ('LEFTPADDING',(0,0),(-1,-1),0), ('RIGHTPADDING',(0,0),(-1,-1),0),
    ])))
canal_total = D['web_count'] + D['mob_count'] + D['ussd_count']
canal_data = [(n,v) for n,v in D['psm_canal'] if v > 0]
if not canal_data:
    canal_data = [('WEB',D['web_count']),('MOBILE',D['mob_count']),('USSD',D['ussd_count'])]
story.append(bar_tbl(canal_data, canal_total or 1, TEAL, TEAL))
# Note CTP canal web
ctp_direct = D.get('ctp_enrolled', 0) - D.get('psm_carte', 0)
story.append(Paragraph(
    f'<b>Note :</b> Les paiements effectués directement via ClicToPay sont réalisés '
    f'exclusivement sur le canal <b>WEB</b>, soit <b>{fmt(ctp_direct)}</b> transactions '
    f'(cartes directes ClicToPay, hors paiements Paysmart).',
    sNote))
story.append(Spacer(1,8))

# FSP Paysmart
story.append(Paragraph('Établissements de paiement Paysmart — CNTE', sH2))
story.append(bar_tbl(D['psm_fsp'], D['psm_enrolled'] or 1, TEAL, NAVY))
story.append(Spacer(1,8))

# Moyen de paiement
story.append(Paragraph('Moyens de paiement Paysmart', sH2))
story.append(bar_tbl(D['psm_moyen'], D['psm_enrolled'] or 1, GOLD, GOLD))
story.append(Spacer(1,8))

# Mode Carte vs Wallet
story.append(Paragraph('Mode de paiement — Carte vs Portefeuille mobile', sH2))
mode_data = D['psm_mode'] if D['psm_mode'] else [('Carte',D['psm_carte']),('Wallet',D['psm_wallet'])]
story.append(bar_tbl(mode_data, D['psm_enrolled'] or 1, PURPLE, NAVY))
story.append(Spacer(1,8))

# Reseaux CTP
story.append(Paragraph('Réseaux bancaires ClicToPay', sH2))
story.append(bar_tbl(D['ctp_networks'], D['ctp_enrolled'] or 1, GOLD, NAVY))
story.append(Spacer(1,10))

# ── SECTION 4 : Analyse ───────────────────────────────────
story += section_hdr('ANALYSE QUALITATIVE ET RECOMMANDATIONS', NAVY)

taux_tbl = Table(
    [[Paragraph(h, sTH) for h in ['Indicateur', 'Valeur', 'Interprétation']]] +
    [[Paragraph(c, sTDc) for c in row] for row in [
        ['Taux brut',         fmtP(D['success_rate']),   'Approuvées / total tentatives'],
        ['Taux ajuste',       fmtP(D['adjusted_rate']),  f'Hors {fmt(D["timeout_count"])} sessions expirées'],
        ['Sessions expirees', fmt(D['fail_timeout']),    'Formulaire non finalisé dans le délai imparti'],
        ['Echecs 3D Secure',  fmt(D['fail_auth3ds']),    'OTP non reçu ou expiré (mesure de sécurité)'],
        ['Refus bancaires',   fmt(D['fail_banque']),     'Fonds insuffisants ou carte bloquée'],
    ]],
    colWidths=[5*cm, 3.2*cm, 9.2*cm],
    style=TableStyle([
        ('BACKGROUND',    (0,0),(-1,0), NAVY),
        ('ROWBACKGROUNDS',(0,1),(-1,-1), [WHITE, LGRAY]),
        ('GRID',          (0,0),(-1,-1), 0.3, MGRAY),
        ('TOPPADDING',    (0,0),(-1,-1), 6),
        ('BOTTOMPADDING', (0,0),(-1,-1), 6),
        ('LEFTPADDING',   (0,0),(-1,-1), 8),
    ]))
story.append(taux_tbl)
story.append(Spacer(1,8))

story.append(Paragraph(
    f'<b>Lecture du taux de réussite :</b> Le taux brut de {fmtP(D["success_rate"])} intègre '
    f'{fmt(D["timeout_count"])} sessions non finalisées dans le délai imparti — '
    f'comportement utilisateur ne constituant pas un incident technique. '
    f'Le taux ajusté de <b>{fmtP(D["adjusted_rate"])}</b> reflète la performance réelle du système.',
    sBody))

story.append(Paragraph(
    f'<b>Canaux :</b> Le canal WEB est dominant avec {fmt(D["web_count"])} transactions, '
    f'suivi du Mobile ({fmt(D["mob_count"])} transactions). '
    f'Le canal USSD ({fmt(D["ussd_count"])} transactions) reste stratégique '
    f'pour les zones à faible connectivité.',
    sBody))

story.append(Paragraph(
    'Recommandation : Il est conseillé d\'informer les parents du délai de complétion '
    'et de la nécessité de préparer leur code OTP avant de démarrer la saisie.',
    sNote))
story.append(Paragraph(
    f'Résultats : Le système SMT (ClicToPay + Paysmart) affiche un taux ajusté de '
    f'{fmtP(D["adjusted_rate"])}, confirmant la solidité de l\'infrastructure de paiement nationale.',
    sGood))
story.append(Paragraph(
    f'Vigilance : Les {fmt(D["fail_auth3ds"])} échecs 3D Secure nécessitent un suivi '
    f'auprès des banques émettrices afin de s\'assurer de la bonne délivrance des SMS d\'authentification.',
    sWarn))

story.append(Spacer(1,14))
story.append(HRFlowable(width=PW, thickness=0.5, color=MGRAY, spaceAfter=6))
story.append(Paragraph(f'Monétique Tunisie — Document confidentiel — {D["generated"]}', sMeta))

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f'OK : {OUT}')
