#!/usr/bin/env python3
# gen_psm_facture.py — Facture Paysmart (Facturier/FSP/SMT/We-Settle/Acquéreur)
import sys, json
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, HRFlowable)

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
GRAY   = colors.HexColor('#374151')
GRAY2  = colors.HexColor('#6B7280')
LGRAY  = colors.HexColor('#F8FAFC')
LGRAY2 = colors.HexColor('#E2E8F0')
WHITE  = colors.white

W, H = landscape(A4)
M    = 1.6*cm
PW   = W - 2*M

def S(n, **kw): return ParagraphStyle(n, **kw)

sTH  = S('TH', fontSize=9,   textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_CENTER, leading=12)
sTHl = S('THl',fontSize=9,   textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_LEFT,   leading=12)
sTD  = S('TD', fontSize=9,   textColor=GRAY,  fontName='Helvetica',      alignment=TA_LEFT,   leading=13)
sTDc = S('TDc',fontSize=9,   textColor=NAVY,  fontName='Helvetica',      alignment=TA_CENTER, leading=13)
sTDr = S('TDr',fontSize=9,   textColor=NAVY,  fontName='Helvetica-Bold', alignment=TA_RIGHT,  leading=13)
sTot = S('Tot',fontSize=9.5, textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_CENTER, leading=14)
sTotL= S('TotL',fontSize=9.5,textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_LEFT,   leading=14)
sTotR= S('TotR',fontSize=9.5,textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_RIGHT,  leading=14)
sLabel=S('L',  fontSize=8,   textColor=GRAY2, fontName='Helvetica', leading=12)
sValue=S('V',  fontSize=11,  textColor=NAVY,  fontName='Helvetica-Bold', leading=15)
sInfo =S('I',  fontSize=8.5, textColor=GRAY,  fontName='Helvetica', leading=13)

def fmt(n):
    v = float(n or 0)
    return f"{v:,.3f}".replace(',','\u2009').replace('.',',')

def fmtN(n):
    return f"{int(n or 0):,}".replace(',','\u2009')

def padTS(lst):
    lst += [('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
            ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
            ('VALIGN',(0,0),(-1,-1),'MIDDLE')]
    return TableStyle(lst)

MOIS_FR=['','Janvier','Février','Mars','Avril','Mai','Juin',
         'Juillet','Août','Septembre','Octobre','Novembre','Décembre']
mois_nom = MOIS_FR[int(facture['mois'])]
annee    = facture['annee']
periode  = f"{mois_nom} {annee}"
numero   = facture['numero']

TYPE_LABELS = {
    'facturier':'Facturier','fsp':'Fournisseur de Services de Paiement (FSP)',
    'smt':'SMT','wesettle':'We-Settle','acquereur':'Acquéreur',
}
type_label = TYPE_LABELS.get(facture['type_dest'], facture['type_dest'])
dest       = facture.get('destinataire') or ''

# Mapping acquéreur
def get_acquereur(dest):
    d = (dest or '').upper()
    if d in ('STEG','SONEDE'): return 'STB'
    if d == 'TOPNET': return 'BT'
    return 'BNA'

if facture['type_dest'] == 'acquereur':
    dest_display = get_acquereur(dest) if not dest or dest == 'Acquéreur' else get_acquereur(dest)
elif facture['type_dest'] == 'fsp' and dest == 'CNTE':
    dest_display = 'Paysmart_SDK'
else:
    dest_display = dest or type_label

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0,0,W,1.5*cm,fill=1,stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0,1.5*cm,W,0.1*cm,fill=1,stroke=0)
    canvas.setFont('Helvetica',7)
    canvas.setFillColor(colors.HexColor('#94A3B8'))
    canvas.drawString(M,0.65*cm,'Monétique Tunisie — Document confidentiel')
    canvas.setFillColor(colors.HexColor('#93C5FD'))
    canvas.setFont('Helvetica-Bold',7)
    canvas.drawCentredString(W/2,0.65*cm,numero)
    canvas.setFillColor(colors.HexColor('#94A3B8'))
    canvas.setFont('Helvetica',7)
    canvas.drawRightString(W-M,0.65*cm,f'Page {doc.page}')
    canvas.restoreState()

doc = SimpleDocTemplate(out_path, pagesize=landscape(A4),
      leftMargin=M, rightMargin=M, topMargin=1.4*cm, bottomMargin=2*cm)
story = []

# ── Header ───────────────────────────────────────────────
hdr = [
    Spacer(1,6),
    Paragraph('FACTURE PAYSMART', S('T',fontSize=22,textColor=WHITE,fontName='Helvetica-Bold',
              alignment=TA_CENTER,leading=28)),
    Paragraph(f'Facturation {type_label}',
              S('S',fontSize=10,textColor=colors.HexColor('#93C5FD'),
                fontName='Helvetica',alignment=TA_CENTER,leading=14)),
    Spacer(1,4),
    Paragraph(f'Période : {periode}   ·   N° {numero}',
              S('M',fontSize=9,textColor=GOLD,fontName='Helvetica-Bold',
                alignment=TA_CENTER,leading=13)),
    Spacer(1,8),
]
story.append(Table([[i] for i in hdr], colWidths=[PW],
    style=TableStyle([('BACKGROUND',(0,0),(-1,-1),NAVY),
                      ('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),
                      ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])))
story.append(HRFlowable(width=PW,thickness=4,color=GOLD,spaceAfter=10))

# ── Parties ───────────────────────────────────────────────
story.append(Table([[Paragraph('PARTIES CONTRACTANTES',
    S('hx',fontSize=11,textColor=WHITE,fontName='Helvetica-Bold',leading=15))]],
    colWidths=[PW],
    style=padTS([('BACKGROUND',(0,0),(-1,-1),NAVY),('LINEBELOW',(0,0),(-1,-1),3,GOLD)])))
story.append(Spacer(1,6))

story.append(Table([[
    Table([[Paragraph('ÉMETTEUR',sLabel)],[Paragraph('Monétique Tunisie (SMT)',sValue)],
           [Paragraph('Centre Urbain Nord — Tunis',sInfo)],
           [Paragraph('Matricule fiscal : 0000000A/A/M/000',sInfo)]],
        colWidths=[PW/2-0.4*cm],
        style=TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),
                          ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])),
    Table([[Paragraph('DESTINATAIRE',sLabel)],[Paragraph(dest_display,sValue)],
           [Paragraph(f'Type : {type_label}',sInfo)],
           [Paragraph(f'Période de facturation : {periode}',sInfo)]],
        colWidths=[PW/2-0.4*cm],
        style=TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),
                          ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])),
]], colWidths=[PW/2,PW/2],
style=padTS([('BACKGROUND',(0,0),(0,-1),LGRAY),('BACKGROUND',(1,0),(1,-1),colors.HexColor('#EFF6FF')),
             ('LINEAFTER',(0,0),(0,-1),1,LGRAY2)])))
story.append(Spacer(1,12))

# ── Tableau des prestations ───────────────────────────────
story.append(Table([[Paragraph('DÉTAIL DES PRESTATIONS',
    S('hx',fontSize=11,textColor=WHITE,fontName='Helvetica-Bold',leading=15))]],
    colWidths=[PW],
    style=padTS([('BACKGROUND',(0,0),(-1,-1),NAVY2),('LINEBELOW',(0,0),(-1,-1),3,GOLD)])))
story.append(Spacer(1,6))

# Colonnes selon type
has_facturier_col = facture['type_dest'] in ('fsp','smt','wesettle','acquereur')
has_canal_col     = facture['type_dest'] in ('facturier','fsp')

hdrs = []
cw_r = []
if has_facturier_col:
    hdrs.append('Facturier'); cw_r.append(3.5)
if has_canal_col:
    hdrs.append('Canal'); cw_r.append(2.0)
hdrs += ['Mode de paiement','Nb transactions','Prix unit. HT (TND)','Montant HT (TND)','TVA (%)','Montant TVA','Montant TTC (TND)']
cw_r += [3.5, 2.5, 2.5, 3.0, 1.8, 2.5, 3.0]

tot = sum(cw_r)
cw  = [v*cm * PW/(tot*cm) for v in cw_r]

hdr_row = [Paragraph(h, sTH if i>0 else sTHl) for i,h in enumerate(hdrs)]
rows = [hdr_row]
total_nb = total_ht = total_tva = total_ttc = 0

for l in lignes:
    nb  = int(l.get('nb_transactions',0) or 0)
    ht  = float(l.get('montant_ht',0) or 0)
    tva = float(l.get('montant_tva',0) or 0)
    ttc = float(l.get('montant_ttc',0) or 0)
    total_nb += nb; total_ht += ht; total_tva += tva; total_ttc += ttc

    row = []
    if has_facturier_col:
        row.append(Paragraph(str(l.get('facturier') or '—'), sTD))
    if has_canal_col:
        row.append(Paragraph(str(l.get('canal') or '—'), sTDc))
    row += [
        Paragraph(str(l.get('mode_paiement','—')), sTD),
        Paragraph(fmtN(nb), sTDc),
        Paragraph(fmt(l.get('prix_unitaire_ht',0)), sTDc),
        Paragraph(fmt(ht), sTDr),
        Paragraph(fmt(l.get('tva_rate',0)) + ' %', sTDc),
        Paragraph(fmt(tva), sTDr),
        Paragraph(fmt(ttc), sTDr),
    ]
    rows.append(row)

# Ligne total
tot_row = []
if has_facturier_col: tot_row.append(Paragraph('TOTAL', sTotL))
if has_canal_col:     tot_row.append(Paragraph('', sTot))
tot_row += [Paragraph('', sTot), Paragraph(fmtN(total_nb), sTot),
            Paragraph('', sTot), Paragraph(fmt(total_ht) + ' TND', sTotR),
            Paragraph('', sTot), Paragraph(fmt(total_tva) + ' TND', sTotR),
            Paragraph(fmt(total_ttc) + ' TND', sTotR)]
rows.append(tot_row)

if not has_facturier_col and not has_canal_col:
    tot_row[0] = Paragraph('TOTAL', sTotL)

n = len(rows)
story.append(Table(rows, colWidths=cw,
    style=padTS([
        ('BACKGROUND',    (0,0),(-1,0),   NAVY2),
        ('BACKGROUND',    (0,n-1),(-1,n-1), NAVY),
        ('ROWBACKGROUNDS',(0,1),(-1,-2),  [WHITE, LGRAY]),
        ('LINEBELOW',     (0,0),(-1,-1),  0.4, LGRAY2),
        ('LINEAFTER',     (0,0),(-1,-1),  0.4, LGRAY2),
    ]), repeatRows=1))

story.append(Spacer(1,14))

# ── Arrêté ────────────────────────────────────────────────
story.append(Table([[Paragraph(
    f'Arrêtée la présente facture à la somme de '
    f'<b>{fmt(total_ht)} Dinars Tunisiens (TND) HT</b> '
    f'au titre des prestations de services de paiement Paysmart — '
    f'Période : {periode}.',
    S('note',fontSize=9.5,textColor=NAVY,fontName='Helvetica',leading=15)
)]],colWidths=[PW],
style=padTS([('BACKGROUND',(0,0),(-1,-1),GREEN_L),('LINEBELOW',(0,0),(-1,-1),2,GREEN),
             ('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),12)])))

story.append(Spacer(1,20))

# ── Signatures ────────────────────────────────────────────
ss = S('sig',fontSize=9,textColor=NAVY,fontName='Helvetica-Bold',alignment=TA_CENTER,leading=13)
sb = S('sub',fontSize=8,textColor=GRAY2,fontName='Helvetica',alignment=TA_CENTER,leading=12)
story.append(Table([[
    Table([[Paragraph('Pour Monétique Tunisie',ss)],[Spacer(1,35)],[Paragraph('Signature et cachet',sb)]],
        colWidths=[PW/2-1*cm],
        style=TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),
                          ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)])),
    Table([[Paragraph(f'Pour {dest_display}',ss)],[Spacer(1,35)],[Paragraph('Signature et cachet',sb)]],
        colWidths=[PW/2-1*cm],
        style=TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),
                          ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)])),
]], colWidths=[PW/2,PW/2],
style=TableStyle([('LINEAFTER',(0,0),(0,-1),1,LGRAY2),
                  ('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)])))

doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(f'OK : {out_path}')
