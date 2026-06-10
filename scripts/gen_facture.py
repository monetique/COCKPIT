#!/usr/bin/env python3
# gen_facture.py — Facture mensuelle SMT — Format paysage A4
import sys, json
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, HRFlowable, KeepTogether)

out_path = sys.argv[1]
data     = json.loads(sys.argv[2])
facture  = data['facture']
lignes   = data['lignes']

# ── Palette ──────────────────────────────────────────────
NAVY   = colors.HexColor('#0F2444')
NAVY2  = colors.HexColor('#1E3A5F')
GOLD   = colors.HexColor('#F59E0B')
TEAL   = colors.HexColor('#0891B2')
TEAL_L = colors.HexColor('#E0F2FE')
GREEN  = colors.HexColor('#059669')
GREEN_L= colors.HexColor('#D1FAE5')
AMBER  = colors.HexColor('#D97706')
AMBER_L= colors.HexColor('#FEF3C7')
PURPLE = colors.HexColor('#7C3AED')
PURPLE_L=colors.HexColor('#EDE9FE')
GRAY   = colors.HexColor('#374151')
GRAY2  = colors.HexColor('#6B7280')
LGRAY  = colors.HexColor('#F8FAFC')
LGRAY2 = colors.HexColor('#E2E8F0')
WHITE  = colors.white

# ── Format paysage ───────────────────────────────────────
W, H = landscape(A4)
M  = 1.6*cm
PW = W - 2*M

def S(name, **kw): return ParagraphStyle(name, **kw)

# Styles
sTH  = S('TH', fontSize=8,   textColor=WHITE, fontName='Helvetica-Bold',
         alignment=TA_CENTER, leading=11, wordWrap='LTR')
sTHl = S('THl',fontSize=8,   textColor=WHITE, fontName='Helvetica-Bold',
         alignment=TA_LEFT,   leading=11)
sTD  = S('TD', fontSize=8.5, textColor=GRAY,  fontName='Helvetica',
         alignment=TA_LEFT,   leading=12)
sTDc = S('TDc',fontSize=8.5, textColor=NAVY,  fontName='Helvetica',
         alignment=TA_CENTER, leading=12)
sTDr = S('TDr',fontSize=8.5, textColor=NAVY,  fontName='Helvetica-Bold',
         alignment=TA_RIGHT,  leading=12)
sTot = S('Tot',fontSize=9,   textColor=WHITE, fontName='Helvetica-Bold',
         alignment=TA_CENTER, leading=13)
sTotl= S('Totl',fontSize=9,  textColor=WHITE, fontName='Helvetica-Bold',
         alignment=TA_LEFT,   leading=13)
sTotR= S('TotR',fontSize=9,  textColor=WHITE, fontName='Helvetica-Bold',
         alignment=TA_RIGHT,  leading=13)
sLabel= S('L', fontSize=8,   textColor=GRAY2, fontName='Helvetica', leading=12)
sValue= S('V', fontSize=10,  textColor=NAVY,  fontName='Helvetica-Bold', leading=14)
sInfo = S('I', fontSize=8.5, textColor=GRAY,  fontName='Helvetica', leading=13)

PAD = dict(TOPPADDING=6, BOTTOMPADDING=6, LEFTPADDING=8, RIGHTPADDING=8)

def pad_ts(ts_list):
    ts_list += [
        ('TOPPADDING',    (0,0),(-1,-1), 6),
        ('BOTTOMPADDING', (0,0),(-1,-1), 6),
        ('LEFTPADDING',   (0,0),(-1,-1), 8),
        ('RIGHTPADDING',  (0,0),(-1,-1), 8),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ]
    return TableStyle(ts_list)

def fmt(n):
    v = float(n or 0)
    s = f"{v:,.3f}"
    return s.replace(',', '\u2009').replace('.', ',')

def fmtN(n):
    return f"{int(n or 0):,}".replace(',', '\u2009')

MOIS_FR = ['','Janvier','Février','Mars','Avril','Mai','Juin',
           'Juillet','Août','Septembre','Octobre','Novembre','Décembre']
mois_nom = MOIS_FR[int(facture['mois'])]
annee    = facture['annee']
periode  = f"{mois_nom} {annee}"
numero   = facture['numero']

CANAL_CFG = {
    'wallet': {'label':'Canal Wallet Mobile',           'color':TEAL,   'light':TEAL_L},
    'ussd'  : {'label':'Canal USSD / App Opérateurs',   'color':AMBER,  'light':AMBER_L},
    'ctp'   : {'label':'Canal Web — Cartes bancaires',  'color':GREEN,  'light':GREEN_L},
}

def section_hdr(text, color=NAVY2):
    sH = S('hx', fontSize=11, textColor=WHITE, fontName='Helvetica-Bold', leading=15)
    t = Table([[Paragraph(text, sH)]], colWidths=[PW],
        style=pad_ts([
            ('BACKGROUND', (0,0),(-1,-1), color),
            ('LINEBELOW',  (0,0),(-1,-1), 3, GOLD),
        ]))
    return [Spacer(1,12), t, Spacer(1,6)]

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, W, 1.5*cm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, 1.5*cm, W, 0.1*cm, fill=1, stroke=0)
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(colors.HexColor('#94A3B8'))
    canvas.drawString(M, 0.65*cm, 'Monétique Tunisie — Document confidentiel')
    canvas.setFillColor(colors.HexColor('#93C5FD'))
    canvas.setFont('Helvetica-Bold', 7)
    canvas.drawCentredString(W/2, 0.65*cm, numero)
    canvas.setFillColor(colors.HexColor('#94A3B8'))
    canvas.setFont('Helvetica', 7)
    canvas.drawRightString(W-M, 0.65*cm, f'Page {doc.page}')
    canvas.restoreState()

# ── Document ─────────────────────────────────────────────
doc = SimpleDocTemplate(out_path, pagesize=landscape(A4),
      leftMargin=M, rightMargin=M, topMargin=1.4*cm, bottomMargin=2*cm)
story = []

# ── Header ───────────────────────────────────────────────
hdr_items = [
    Spacer(1,6),
    Paragraph('FACTURE', S('T', fontSize=22, textColor=WHITE, fontName='Helvetica-Bold',
              alignment=TA_CENTER, leading=28)),
    Paragraph('Services de paiement électronique — Inscriptions scolaires en ligne',
              S('S', fontSize=10, textColor=colors.HexColor('#93C5FD'), fontName='Helvetica',
                alignment=TA_CENTER, leading=14)),
    Spacer(1,4),
    Paragraph(f'Période : {periode}   ·   N° {numero}',
              S('M', fontSize=9, textColor=GOLD, fontName='Helvetica-Bold',
                alignment=TA_CENTER, leading=13)),
    Spacer(1,8),
]
story.append(Table([[i] for i in hdr_items], colWidths=[PW],
    style=TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), NAVY),
        ('TOPPADDING',    (0,0),(-1,-1), 0),
        ('BOTTOMPADDING', (0,0),(-1,-1), 0),
        ('LEFTPADDING',   (0,0),(-1,-1), 0),
        ('RIGHTPADDING',  (0,0),(-1,-1), 0),
    ])))
story.append(HRFlowable(width=PW, thickness=4, color=GOLD, spaceAfter=10))

# ── Parties ───────────────────────────────────────────────
story += section_hdr('PARTIES CONTRACTANTES', NAVY)
story.append(Table([[
    Table([
        [Paragraph('ÉMETTEUR', sLabel)],
        [Paragraph('Monétique Tunisie (SMT)', sValue)],
        [Paragraph('Centre Urbain Nord — Tunis', sInfo)],
        [Paragraph('Matricule fiscal : 0000000A/A/M/000', sInfo)],
    ], colWidths=[PW/2-0.4*cm],
    style=TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),
                      ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])),
    Table([
        [Paragraph('DESTINATAIRE', sLabel)],
        [Paragraph('Ministère des Finances', sValue)],
        [Paragraph('Place du Gouvernement, La Kasbah — Tunis', sInfo)],
        [Paragraph('République Tunisienne', sInfo)],
    ], colWidths=[PW/2-0.4*cm],
    style=TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),
                      ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])),
]], colWidths=[PW/2, PW/2],
style=pad_ts([
    ('BACKGROUND',(0,0),(0,-1), LGRAY),
    ('BACKGROUND',(1,0),(1,-1), colors.HexColor('#EFF6FF')),
    ('LINEAFTER', (0,0),(0,-1), 1, LGRAY2),
])))
story.append(Spacer(1,10))

# ── Tableaux par canal ────────────────────────────────────
from itertools import groupby
CANAL_ORDER = {'wallet':1,'ussd':2,'ctp':3}
lignes_sorted = sorted(lignes, key=lambda x: (CANAL_ORDER.get(x['canal'],9), x['fsp'] or ''))

for canal, grp in groupby(lignes_sorted, key=lambda x: x['canal']):
    grp   = list(grp)
    cfg   = CANAL_CFG.get(canal, {'label':canal,'color':NAVY2,'light':LGRAY})
    color = cfg['color']
    light = cfg['light']
    has_op = (canal == 'ussd')

    story += section_hdr(cfg['label'], color)

    # ── Colonnes : FSP | Nb | Commission | Émetteur | Acquéreur | SMT | [Opérateur] | Total ──
    if has_op:
        headers = [
            ('Partenaire / FSP',    3.5*cm, TA_LEFT),
            ('Nb\ntransactions',    2.2*cm, TA_CENTER),
            ('Commission\nunit. (TND)', 2*cm, TA_CENTER),
            ('Montant\ncommission', 2.5*cm, TA_RIGHT),
            ('Émetteur\nunit.',     1.8*cm, TA_CENTER),
            ('Montant\németteur',   2.3*cm, TA_RIGHT),
            ('Acquéreur\nunit.',    1.8*cm, TA_CENTER),
            ('Montant\nacquéreur',  2.3*cm, TA_RIGHT),
            ('SMT\nunit.',          1.6*cm, TA_CENTER),
            ('Montant\nSMT',        2.2*cm, TA_RIGHT),
            ('Opérateur\nunit.',    1.8*cm, TA_CENTER),
            ('Montant\nopérateur',  2.3*cm, TA_RIGHT),
            ('Total\n(TND)',        2.5*cm, TA_RIGHT),
        ]
    else:
        headers = [
            ('Partenaire / FSP',    4.5*cm, TA_LEFT),
            ('Nb\ntransactions',    2.5*cm, TA_CENTER),
            ('Commission\nunit. (TND)', 2.2*cm, TA_CENTER),
            ('Montant\ncommission', 2.8*cm, TA_RIGHT),
            ('Émetteur\nunit.',     2*cm,   TA_CENTER),
            ('Montant\németteur',   2.6*cm, TA_RIGHT),
            ('Acquéreur\nunit.',    2*cm,   TA_CENTER),
            ('Montant\nacquéreur',  2.6*cm, TA_RIGHT),
            ('SMT\nunit.',          1.8*cm, TA_CENTER),
            ('Montant\nSMT',        2.6*cm, TA_RIGHT),
            ('Total\n(TND)',        2.8*cm, TA_RIGHT),
        ]

    # Ajuster à PW
    total_w = sum(h[1] for h in headers)
    cw = [h[1] * PW / total_w for h in headers]

    hdr_row = []
    for h, w, align in headers:
        st = S(f'th_{h}', fontSize=8, textColor=WHITE, fontName='Helvetica-Bold',
               alignment=align, leading=11, wordWrap='LTR')
        hdr_row.append(Paragraph(h, st))

    rows = [hdr_row]
    total_nb = total_mt = total_com = total_smt = 0

    for l in grp:
        nb = int(l['nb_transactions'] or 0)
        mt = float(l['montant_total'] or 0)
        total_nb  += nb
        total_mt  += mt
        total_com += float(l['montant_commission'] or 0)
        total_smt += float(l['montant_smt'] or 0)

        row = [
            Paragraph(str(l['fsp'] or ''), sTD),
            Paragraph(fmtN(nb), sTDc),
            Paragraph(fmt(l['commission']), sTDc),
            Paragraph(fmt(l['montant_commission']), sTDr),
            Paragraph(fmt(l['emetteur']), sTDc),
            Paragraph(fmt(l['montant_emetteur']), sTDr),
            Paragraph(fmt(l['acquereur']), sTDc),
            Paragraph(fmt(l['montant_acquereur']), sTDr),
            Paragraph(fmt(l['smt']), sTDc),
            Paragraph(fmt(l['montant_smt']), sTDr),
        ]
        if has_op:
            row += [
                Paragraph(fmt(l['operateur']), sTDc),
                Paragraph(fmt(l['montant_operateur']), sTDr),
            ]
        row.append(Paragraph(fmt(mt), sTDr))
        rows.append(row)

    # Ligne sous-total
    n_cols = len(headers)
    sous_tot = [Paragraph('SOUS-TOTAL', sTotl), Paragraph(fmtN(total_nb), sTot),
                Paragraph('', sTot), Paragraph(fmt(total_com), sTotR)]
    for _ in range(n_cols - 6):
        sous_tot.append(Paragraph('', sTot))
    sous_tot.append(Paragraph(fmt(total_smt), sTotR))
    sous_tot.append(Paragraph(fmt(total_mt), sTotR))
    rows.append(sous_tot)

    n = len(rows)
    ts = pad_ts([
        ('BACKGROUND',    (0,0),(-1,0),   color),
        ('BACKGROUND',    (0,n-1),(-1,n-1), NAVY),
        ('ROWBACKGROUNDS',(0,1),(-1,-2),  [WHITE, LGRAY]),
        ('LINEBELOW',     (0,0),(-1,-1),  0.4, LGRAY2),
        ('LINEAFTER',     (0,0),(-1,-1),  0.4, LGRAY2),
        ('ALIGN',         (1,0),(-1,-1),  'CENTER'),
    ])

    story.append(KeepTogether([
        Table(rows, colWidths=cw, style=ts, repeatRows=1)
    ]))
    story.append(Spacer(1,10))

# ── Récapitulatif ─────────────────────────────────────────
story += section_hdr('RÉCAPITULATIF', NAVY)

recap_rows = [[Paragraph(h, sTH) for h in
    ['Canal', 'Nb transactions', 'Commission totale (TND)',
     'Montant SMT (TND)', 'Montant total (TND)']]]

grand_nb = grand_mt = grand_com = grand_smt = 0
for canal, grp in groupby(lignes_sorted, key=lambda x: x['canal']):
    grp  = list(grp)
    cfg  = CANAL_CFG.get(canal, {'label':canal,'light':LGRAY})
    nb   = sum(int(l['nb_transactions'] or 0) for l in grp)
    mt   = sum(float(l['montant_total'] or 0) for l in grp)
    com  = sum(float(l['montant_commission'] or 0) for l in grp)
    smt  = sum(float(l['montant_smt'] or 0) for l in grp)
    grand_nb  += nb; grand_mt += mt; grand_com += com; grand_smt += smt
    recap_rows.append([
        Paragraph(cfg['label'], sTD),
        Paragraph(fmtN(nb), sTDc),
        Paragraph(fmt(com) + ' TND', sTDr),
        Paragraph(fmt(smt) + ' TND', sTDr),
        Paragraph(fmt(mt)  + ' TND', sTDr),
    ])

recap_rows.append([
    Paragraph('TOTAL GÉNÉRAL', sTotl),
    Paragraph(fmtN(grand_nb), sTot),
    Paragraph(fmt(grand_com) + ' TND', sTotR),
    Paragraph(fmt(grand_smt) + ' TND', sTotR),
    Paragraph(fmt(grand_mt)  + ' TND', sTotR),
])

n = len(recap_rows)
story.append(Table(recap_rows,
    colWidths=[PW*0.35, PW*0.15, PW*0.17, PW*0.16, PW*0.17],
    style=pad_ts([
        ('BACKGROUND',    (0,0),(-1,0),   NAVY2),
        ('BACKGROUND',    (0,n-1),(-1,n-1), NAVY),
        ('ROWBACKGROUNDS',(0,1),(-1,-2),  [WHITE, LGRAY]),
        ('LINEBELOW',     (0,0),(-1,-1),  0.4, LGRAY2),
    ])))

story.append(Spacer(1,14))

# ── Arrêté ────────────────────────────────────────────────
story.append(Table([[
    Paragraph(
        f'Arrêtée la présente facture à la somme de '
        f'<b>{fmt(grand_mt)} Dinars Tunisiens (TND)</b> '
        f'au titre des prestations de services de paiement électronique '
        f'pour les inscriptions scolaires en ligne — Période : {periode}.',
        S('note', fontSize=9.5, textColor=NAVY, fontName='Helvetica', leading=15))
]], colWidths=[PW],
style=pad_ts([
    ('BACKGROUND',  (0,0),(-1,-1), GREEN_L),
    ('LINEBELOW',   (0,0),(-1,-1), 2, GREEN),
    ('TOPPADDING',  (0,0),(-1,-1), 12),
    ('BOTTOMPADDING',(0,0),(-1,-1), 12),
])))

story.append(Spacer(1,20))

# ── Signatures ────────────────────────────────────────────
sig_style = S('sig', fontSize=9, textColor=NAVY, fontName='Helvetica-Bold',
              alignment=TA_CENTER, leading=13)
sig_sub   = S('sub', fontSize=8, textColor=GRAY2, fontName='Helvetica',
              alignment=TA_CENTER, leading=12)

story.append(Table([[
    Table([
        [Paragraph('Pour Monétique Tunisie', sig_style)],
        [Spacer(1, 35)],
        [Paragraph('Signature et cachet', sig_sub)],
    ], colWidths=[PW/2-1*cm],
    style=TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),
                      ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)])),
    Table([
        [Paragraph('Pour le Ministère des Finances', sig_style)],
        [Spacer(1, 35)],
        [Paragraph('Signature et cachet', sig_sub)],
    ], colWidths=[PW/2-1*cm],
    style=TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),
                      ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)])),
]], colWidths=[PW/2, PW/2],
style=TableStyle([
    ('LINEAFTER',(0,0),(0,-1), 1, LGRAY2),
    ('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),
])))

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f'OK : {out_path}')
