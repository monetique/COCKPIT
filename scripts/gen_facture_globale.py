#!/usr/bin/env python3
# gen_facture_globale.py — Facture globale SMT (sans détail FSP)
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

NAVY   = colors.HexColor('#0F2444')
NAVY2  = colors.HexColor('#1E3A5F')
GOLD   = colors.HexColor('#F59E0B')
GREEN  = colors.HexColor('#059669')
GREEN_L= colors.HexColor('#D1FAE5')
TEAL   = colors.HexColor('#0891B2')
TEAL_L = colors.HexColor('#E0F2FE')
AMBER  = colors.HexColor('#D97706')
AMBER_L= colors.HexColor('#FEF3C7')
PURPLE = colors.HexColor('#7C3AED')
PURPLE_L=colors.HexColor('#EDE9FE')
GRAY   = colors.HexColor('#374151')
GRAY2  = colors.HexColor('#6B7280')
LGRAY  = colors.HexColor('#F8FAFC')
LGRAY2 = colors.HexColor('#E2E8F0')
WHITE  = colors.white

W, H = landscape(A4)
M  = 1.6*cm
PW = W - 2*M

def S(n, **kw): return ParagraphStyle(n, **kw)

sTH  = S('TH', fontSize=9,  textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_CENTER, leading=13)
sTHl = S('THl',fontSize=9,  textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_LEFT,   leading=13)
sTD  = S('TD', fontSize=9,  textColor=GRAY,  fontName='Helvetica',      alignment=TA_LEFT,   leading=13)
sTDc = S('TDc',fontSize=9,  textColor=NAVY,  fontName='Helvetica',      alignment=TA_CENTER, leading=13)
sTDr = S('TDr',fontSize=9,  textColor=NAVY,  fontName='Helvetica-Bold', alignment=TA_RIGHT,  leading=13)
sTot = S('Tot',fontSize=9.5,textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_CENTER, leading=14)
sTotL= S('TotL',fontSize=9.5,textColor=WHITE,fontName='Helvetica-Bold', alignment=TA_LEFT,   leading=14)
sTotR= S('TotR',fontSize=9.5,textColor=WHITE,fontName='Helvetica-Bold', alignment=TA_RIGHT,  leading=14)
sLabel= S('L', fontSize=8,  textColor=GRAY2, fontName='Helvetica', leading=12)
sValue= S('V', fontSize=10, textColor=NAVY,  fontName='Helvetica-Bold', leading=14)
sInfo = S('I', fontSize=8.5,textColor=GRAY,  fontName='Helvetica', leading=13)

MOIS_FR = ['','Janvier','Février','Mars','Avril','Mai','Juin',
           'Juillet','Août','Septembre','Octobre','Novembre','Décembre']
mois_nom = MOIS_FR[int(facture['mois'])]
annee    = facture['annee']
periode  = f"{mois_nom} {annee}"
numero   = facture['numero']

def fmt(n):
    v = float(n or 0)
    s = f"{v:,.3f}".replace(',', '\u2009').replace('.', ',')
    return s

def fmtN(n):
    return f"{int(n or 0):,}".replace(',', '\u2009')

def padTS(lst):
    lst += [
        ('TOPPADDING',    (0,0),(-1,-1), 7),
        ('BOTTOMPADDING', (0,0),(-1,-1), 7),
        ('LEFTPADDING',   (0,0),(-1,-1), 10),
        ('RIGHTPADDING',  (0,0),(-1,-1), 10),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ]
    return TableStyle(lst)

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

doc = SimpleDocTemplate(out_path, pagesize=landscape(A4),
      leftMargin=M, rightMargin=M, topMargin=1.4*cm, bottomMargin=2*cm)
story = []

# ── Header ───────────────────────────────────────────────
hdr = [
    Spacer(1,6),
    Paragraph('FACTURE GLOBALE', S('T', fontSize=22, textColor=WHITE,
              fontName='Helvetica-Bold', alignment=TA_CENTER, leading=28)),
    Paragraph('Services de paiement électronique — Inscriptions scolaires en ligne',
              S('S', fontSize=10, textColor=colors.HexColor('#93C5FD'),
                fontName='Helvetica', alignment=TA_CENTER, leading=14)),
    Spacer(1,4),
    Paragraph(f'Période : {periode}   ·   N° {numero}',
              S('M', fontSize=9, textColor=GOLD, fontName='Helvetica-Bold',
                alignment=TA_CENTER, leading=13)),
    Spacer(1,8),
]
story.append(Table([[i] for i in hdr], colWidths=[PW],
    style=TableStyle([('BACKGROUND',(0,0),(-1,-1),NAVY),
                      ('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),
                      ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])))
story.append(HRFlowable(width=PW, thickness=4, color=GOLD, spaceAfter=10))

# ── Parties ───────────────────────────────────────────────
story.append(Table([[Paragraph('PARTIES CONTRACTANTES',
    S('hx', fontSize=11, textColor=WHITE, fontName='Helvetica-Bold', leading=15))]],
    colWidths=[PW],
    style=padTS([('BACKGROUND',(0,0),(-1,-1),NAVY),('LINEBELOW',(0,0),(-1,-1),3,GOLD)])))
story.append(Spacer(1,6))

story.append(Table([[
    Table([[Paragraph('ÉMETTEUR', sLabel)],[Paragraph('Monétique Tunisie (SMT)', sValue)],
           [Paragraph('Centre Urbain Nord — Tunis', sInfo)],
           [Paragraph('Matricule fiscal : 0000000A/A/M/000', sInfo)]],
        colWidths=[PW/2-0.4*cm],
        style=TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),
                          ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])),
    Table([[Paragraph('DESTINATAIRE', sLabel)],[Paragraph('Ministère des Finances', sValue)],
           [Paragraph('Place du Gouvernement, La Kasbah — Tunis', sInfo)],
           [Paragraph('République Tunisienne', sInfo)]],
        colWidths=[PW/2-0.4*cm],
        style=TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),
                          ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])),
]], colWidths=[PW/2, PW/2],
style=padTS([('BACKGROUND',(0,0),(0,-1),LGRAY),('BACKGROUND',(1,0),(1,-1),colors.HexColor('#EFF6FF')),
             ('LINEAFTER',(0,0),(0,-1),1,LGRAY2)])))
story.append(Spacer(1,12))

# ── Colonnes tableau principal ─────────────────────────────
# Libellé | Nb | Comm unit | Mnt commission | Émet unit | Mnt émetteur | Acq unit | Mnt acq | SMT unit | Mnt SMT | [Op unit | Mnt Op] | Total
def build_table(rows_data, color, has_op=False):
    if has_op:
        hdrs  = ['Libellé / Prestation','Nb\ntransactions','Commission\nunit. (TND)',
                 'Montant\ncommission','Émetteur\nunit.','Montant\németteur',
                 'Acquéreur\nunit.','Montant\nacquéreur','SMT\nunit.','Montant\nSMT',
                 'Opérateur\nunit.','Montant\nopérateur','Total (TND)']
        cw_r  = [3.5,2.0,1.8,2.4,1.6,2.2,1.6,2.2,1.4,2.0,1.6,2.2,2.5]
    else:
        hdrs  = ['Libellé / Prestation','Nb\ntransactions','Commission\nunit. (TND)',
                 'Montant\ncommission','Émetteur\nunit.','Montant\németteur',
                 'Acquéreur\nunit.','Montant\nacquéreur','SMT\nunit.','Montant\nSMT','Total (TND)']
        cw_r  = [5.0,2.2,2.0,2.7,1.8,2.5,1.8,2.5,1.6,2.4,2.7]

    tot_w = sum(cw_r)
    cw    = [v*cm * PW/(tot_w*cm) for v in cw_r]

    hdr_row = [Paragraph(h, sTH if i>0 else sTHl) for i,h in enumerate(hdrs)]
    rows    = [hdr_row]
    tot_nb = tot_mt = tot_com = tot_smt = tot_op = 0

    for l in rows_data:
        nb = int(l.get('nb_transactions',0) or 0)
        mt = float(l.get('montant_total',0) or 0)
        tot_nb  += nb; tot_mt  += mt
        tot_com += float(l.get('montant_commission',0) or 0)
        tot_smt += float(l.get('montant_smt',0) or 0)
        tot_op  += float(l.get('montant_operateur',0) or 0)
        row = [
            Paragraph(str(l.get('label','')), sTD),
            Paragraph(fmtN(nb), sTDc),
            Paragraph(fmt(l.get('commission',0)), sTDc),
            Paragraph(fmt(l.get('montant_commission',0)), sTDr),
            Paragraph(fmt(l.get('emetteur',0)), sTDc),
            Paragraph(fmt(l.get('montant_emetteur',0)), sTDr),
            Paragraph(fmt(l.get('acquereur',0)), sTDc),
            Paragraph(fmt(l.get('montant_acquereur',0)), sTDr),
            Paragraph(fmt(l.get('smt',0)), sTDc),
            Paragraph(fmt(l.get('montant_smt',0)), sTDr),
        ]
        if has_op:
            row += [Paragraph(fmt(l.get('operateur',0)), sTDc),
                    Paragraph(fmt(l.get('montant_operateur',0)), sTDr)]
        row.append(Paragraph(fmt(mt), sTDr))
        rows.append(row)

    # Sous-total
    nc = len(hdrs)
    st = [Paragraph('SOUS-TOTAL', sTotL), Paragraph(fmtN(tot_nb), sTot),
          Paragraph('', sTot), Paragraph(fmt(tot_com), sTotR),
          Paragraph('', sTot), Paragraph('', sTot),
          Paragraph('', sTot), Paragraph('', sTot),
          Paragraph('', sTot), Paragraph(fmt(tot_smt), sTotR)]
    if has_op:
        st += [Paragraph('', sTot), Paragraph(fmt(tot_op), sTotR)]
    st.append(Paragraph(fmt(tot_mt), sTotR))
    rows.append(st)

    n = len(rows)
    ts = padTS([
        ('BACKGROUND',    (0,0),(-1,0),   color),
        ('BACKGROUND',    (0,n-1),(-1,n-1), NAVY),
        ('ROWBACKGROUNDS',(0,1),(-1,-2),  [WHITE, LGRAY]),
        ('LINEBELOW',     (0,0),(-1,-1),  0.4, LGRAY2),
        ('LINEAFTER',     (0,0),(-1,-1),  0.4, LGRAY2),
    ])
    return Table(rows, colWidths=cw, style=ts, repeatRows=1), tot_mt

def section_hdr(text, color):
    t = Table([[Paragraph(text,
        S('hx', fontSize=11, textColor=WHITE, fontName='Helvetica-Bold', leading=15))]],
        colWidths=[PW],
        style=padTS([('BACKGROUND',(0,0),(-1,-1),color),('LINEBELOW',(0,0),(-1,-1),3,GOLD)]))
    return [Spacer(1,12), t, Spacer(1,6)]

# ── Rubrique 1 : CTP Direct ───────────────────────────────
ctp_lignes = [l for l in lignes if l.get('rubrique') == 'ctp']
story += section_hdr('RUBRIQUE 1 — ClicToPay Direct (Paiements par cartes hors Paysmart)', GREEN)
tbl1, mt1 = build_table(ctp_lignes, GREEN)
story.append(tbl1)
story.append(Spacer(1,12))

# ── Rubrique 2 : Paysmart ─────────────────────────────────
psm_lignes = [l for l in lignes if l.get('rubrique') == 'psm']
psm_ussd   = [l for l in psm_lignes if (l.get('canal','') or '').upper() == 'USSD']
psm_other  = [l for l in psm_lignes if (l.get('canal','') or '').upper() != 'USSD']

story += section_hdr('RUBRIQUE 2 — Paysmart (répartition par canal et moyen de paiement)', TEAL)

if psm_other:
    story.append(Paragraph('Canaux WEB et MOBILE',
        S('sh', fontSize=9, textColor=TEAL, fontName='Helvetica-Bold',
          leading=13, spaceBefore=4, spaceAfter=4)))
    tbl2a, _ = build_table(psm_other, TEAL, has_op=False)
    story.append(tbl2a)
    story.append(Spacer(1,8))

if psm_ussd:
    story.append(Paragraph('Canal USSD / App Opérateurs',
        S('sh2', fontSize=9, textColor=AMBER, fontName='Helvetica-Bold',
          leading=13, spaceBefore=4, spaceAfter=4)))
    tbl2b, _ = build_table(psm_ussd, AMBER, has_op=True)
    story.append(tbl2b)
    story.append(Spacer(1,12))

# ── Récapitulatif ─────────────────────────────────────────
story += section_hdr('RÉCAPITULATIF', NAVY)

ctp_nb  = sum(int(l.get('nb_transactions',0) or 0) for l in ctp_lignes)
ctp_mt  = sum(float(l.get('montant_total',0) or 0) for l in ctp_lignes)
psm_nb  = sum(int(l.get('nb_transactions',0) or 0) for l in psm_lignes)
psm_mt  = sum(float(l.get('montant_total',0) or 0) for l in psm_lignes)
tot_nb  = ctp_nb + psm_nb
tot_mt  = ctp_mt + psm_mt

recap = [
    [Paragraph(h, sTH) for h in
     ['Rubrique','Description','Nb transactions','Montant total (TND)']],
    [Paragraph('Rubrique 1', sTD),
     Paragraph('ClicToPay Direct — Cartes bancaires hors Paysmart', sTD),
     Paragraph(fmtN(ctp_nb), sTDc),
     Paragraph(fmt(ctp_mt) + ' TND', sTDr)],
    [Paragraph('Rubrique 2', sTD),
     Paragraph('Paysmart — Cartes, Portefeuilles mobiles et Virements', sTD),
     Paragraph(fmtN(psm_nb), sTDc),
     Paragraph(fmt(psm_mt) + ' TND', sTDr)],
    [Paragraph('TOTAL GÉNÉRAL', sTotL),
     Paragraph('', sTot),
     Paragraph(fmtN(tot_nb), sTot),
     Paragraph(fmt(tot_mt) + ' TND', sTotR)],
]
n = len(recap)
story.append(Table(recap, colWidths=[PW*0.12, PW*0.45, PW*0.18, PW*0.25],
    style=padTS([
        ('BACKGROUND',    (0,0),(-1,0),   NAVY2),
        ('BACKGROUND',    (0,n-1),(-1,n-1), NAVY),
        ('ROWBACKGROUNDS',(0,1),(-1,-2),  [WHITE, LGRAY]),
        ('LINEBELOW',     (0,0),(-1,-1),  0.4, LGRAY2),
    ])))

story.append(Spacer(1,14))

# ── Arrêté ────────────────────────────────────────────────
story.append(Table([[Paragraph(
    f'Arrêtée la présente facture à la somme de <b>{fmt(tot_mt)} Dinars Tunisiens (TND)</b> '
    f'au titre des prestations de services de paiement électronique pour les '
    f'inscriptions scolaires en ligne — Période : {periode}.',
    S('note', fontSize=9.5, textColor=NAVY, fontName='Helvetica', leading=15)
)]],colWidths=[PW],
style=padTS([('BACKGROUND',(0,0),(-1,-1),GREEN_L),('LINEBELOW',(0,0),(-1,-1),2,GREEN),
             ('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),12)])))

story.append(Spacer(1,20))

# ── Signatures ────────────────────────────────────────────
ss = S('sig', fontSize=9, textColor=NAVY, fontName='Helvetica-Bold',
       alignment=TA_CENTER, leading=13)
sb = S('sub', fontSize=8, textColor=GRAY2, fontName='Helvetica',
       alignment=TA_CENTER, leading=12)

story.append(Table([[
    Table([[Paragraph('Pour Monétique Tunisie', ss)],[Spacer(1,35)],
           [Paragraph('Signature et cachet', sb)]],
        colWidths=[PW/2-1*cm],
        style=TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),
                          ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)])),
    Table([[Paragraph('Pour le Ministère des Finances', ss)],[Spacer(1,35)],
           [Paragraph('Signature et cachet', sb)]],
        colWidths=[PW/2-1*cm],
        style=TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),
                          ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)])),
]], colWidths=[PW/2, PW/2],
style=TableStyle([('LINEAFTER',(0,0),(0,-1),1,LGRAY2),
                  ('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)])))

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f'OK : {out_path}')
