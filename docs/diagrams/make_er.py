"""Draws the IronPulse ER diagram (Elmasri/Navathe notation) as er-diagram.svg.

Run:  python docs/diagrams/make_er.py
Entities = grey rectangles, relationships = grey diamonds, attributes = ovals
(key underlined, derived dashed, partial key dashed-underlined), weak entity and
identifying relationship = double border, total participation = double line,
(min,max) written next to each entity on every relationship line.
"""
import math, os

W, H = 2600, 1960
out = []
FONT = "font-family='Arial, Helvetica, sans-serif'"


def text_w(s, size=13):
    return len(s) * size * 0.56


def ent(name, x, y, weak=False):
    w = max(150, text_w(name, 15) + 40); h = 38
    out.append(f"<rect x='{x-w/2}' y='{y-h/2}' width='{w}' height='{h}' fill='#d9d9d9' stroke='#000' stroke-width='1.4'/>")
    if weak:
        out.append(f"<rect x='{x-w/2+4}' y='{y-h/2+4}' width='{w-8}' height='{h-8}' fill='none' stroke='#000' stroke-width='1.2'/>")
    out.append(f"<text x='{x}' y='{y+5}' text-anchor='middle' font-size='15' {FONT}>{name}</text>")
    ENT[name] = (x, y, w, h)


def rel(name, x, y, ident=False):
    w = max(120, text_w(name, 14) + (80 if ident else 50)); h = 62 if not ident else 70
    pts = f"{x},{y-h/2} {x+w/2},{y} {x},{y+h/2} {x-w/2},{y}"
    out.append(f"<polygon points='{pts}' fill='#d9d9d9' stroke='#000' stroke-width='1.4'/>")
    if ident:
        k = 7
        pts2 = f"{x},{y-h/2+k} {x+w/2-k*1.6},{y} {x},{y+h/2-k} {x-w/2+k*1.6},{y}"
        out.append(f"<polygon points='{pts2}' fill='none' stroke='#000' stroke-width='1.2'/>")
    out.append(f"<text x='{x}' y='{y+5}' text-anchor='middle' font-size='14' {FONT}>{name}</text>")
    REL[name] = (x, y, w, h)


def line(pts, double=False):
    d = ' '.join(f"{x},{y}" for x, y in pts)
    if double:
        out.append(f"<polyline points='{d}' fill='none' stroke='#000' stroke-width='5'/>")
        out.append(f"<polyline points='{d}' fill='none' stroke='#fff' stroke-width='2.2'/>")
    else:
        out.append(f"<polyline points='{d}' fill='none' stroke='#000' stroke-width='1.3'/>")


def label(s, x, y, anchor='middle', size=13, italic=False):
    st = " font-style='italic'" if italic else ''
    out.append(f"<text x='{x}' y='{y}' text-anchor='{anchor}' font-size='{size}' {FONT}{st}>{s}</text>")


def attr(owner, name, x, y, key=False, derived=False, partial=False, multi=False, frm=None):
    """Oval at (x,y) joined to `owner` (entity/relationship name or a point)."""
    rx = text_w(name) / 2 + 14; ry = 16
    ox, oy = frm if frm else (ENT.get(owner) or REL.get(owner))[:2]
    # line from owner centre to oval edge (drawn first so the oval covers it)
    out.insert(0, f"<line x1='{ox}' y1='{oy}' x2='{x}' y2='{y}' stroke='#000' stroke-width='1.1'/>")
    dash = " stroke-dasharray='5,3'" if derived else ''
    out.append(f"<ellipse cx='{x}' cy='{y}' rx='{rx}' ry='{ry}' fill='#fff' stroke='#000' stroke-width='1.2'{dash}/>")
    if multi:
        out.append(f"<ellipse cx='{x}' cy='{y}' rx='{rx-4}' ry='{ry-4}' fill='none' stroke='#000' stroke-width='1'/>")
    out.append(f"<text x='{x}' y='{y+4.5}' text-anchor='middle' font-size='13' {FONT}>{name}</text>")
    if key or partial:
        tw = text_w(name)
        d = " stroke-dasharray='4,3'" if partial else ''
        out.append(f"<line x1='{x-tw/2}' y1='{y+7}' x2='{x+tw/2}' y2='{y+7}' stroke='#000' stroke-width='1'{d}/>")
    return (x, y)


def fan(owner, items, rx, ry, a0, a1):
    """Attributes on an elliptical arc around `owner` (angles in degrees, 0 = right, 90 = down)."""
    ox, oy = (ENT.get(owner) or REL.get(owner))[:2]
    n = len(items)
    for i, it in enumerate(items):
        name, flags = (it, {}) if isinstance(it, str) else it
        a = math.radians(a0 + (a1 - a0) * i / max(1, n - 1))
        attr(owner, name, ox + rx * math.cos(a), oy + ry * math.sin(a), **flags)

ENT, REL = {}, {}

# ----------------------------------------------------------------- relationship lines first (under the shapes)
# positions
U, M, T = (1400, 360), (520, 760), (2280, 760)
P, MS, PL = (1000, 360), (1000, 760), (1000, 1130)
PT, CS = (1750, 760), (1400, 1520)
CT, RM = (1000, 1770), (1800, 1770)
AT, AU = (200, 450), (2330, 1765)
ISA = (1400, 175)

# specialization: USER -> d -> MEMBER / TRAINER
line([ISA, (U[0], U[1] - 19)])  # partial: admins are neither
line([(ISA[0] - 18, ISA[1]), (M[0], ISA[1]), (M[0], M[1] - 19)])
line([(ISA[0] + 18, ISA[1]), (T[0], ISA[1]), (T[0], T[1] - 19)])

# PAYMENT -- RECORDS -- USER
line([P, U])
# MEMBER -- MAKES -- PAYMENT
line([M, (760, 560)]); line([(760, 560), P], double=True)
# MEMBER -- HOLDS -- MEMBERSHIP
line([M, (760, 760)]); line([(760, 760), MS], double=True)
# PAYMENT -- PAYS_FOR -- MEMBERSHIP
line([P, MS])
# MEMBERSHIP -- OF_PLAN -- PLAN
line([MS, (1000, 945)], double=True); line([(1000, 945), PL])
# PAYMENT -- COVERS -- PT_SESSION
line([P, PT])
# TRAINER -- CONDUCTS -- PT_SESSION
line([T, (2015, 760)]); line([(2015, 760), PT], double=True)
# MEMBER -- REQUESTS -- PT_SESSION (routed below)
line([(M[0] + 45, M[1] + 19), (M[0] + 45, 1320), (1300, 1320)]); line([(1300, 1320), (PT[0], 1320), (PT[0], PT[1] + 19)], double=True)
# MEMBER -- BOOKS -- CLASS_SESSION (M:N, routed left and below)
line([(M[0] - 80, M[1]), (300, M[1]), (300, 1520), (850, 1520), (CS[0] - 80, 1520)])
# TRAINER -- TEACHES -- CLASS_SESSION
line([(T[0], T[1] + 19), (T[0], 1520), (1900, 1520)]); line([(1900, 1520), (CS[0] + 80, 1520)], double=True)
# CLASS_SESSION -- OF_TYPE -- CLASS_TYPE ; -- HELD_IN -- ROOM
line([CS, (1200, 1645)], double=True); line([(1200, 1645), CT])
line([CS, (1600, 1645)], double=True); line([(1600, 1645), RM])
# MEMBER -- CHECKS_IN -- ATTENDANCE (identifying)
line([M, (360, 605)]); line([(360, 605), AT], double=True)

# ----------------------------------------------------------------- shapes
ent('USER', *U); ent('MEMBER', *M); ent('TRAINER', *T)
ent('PAYMENT', *P); ent('MEMBERSHIP', *MS); ent('MEMBERSHIP_PLAN', *PL)
ent('PT_SESSION', *PT); ent('CLASS_SESSION', *CS); ent('CLASS_TYPE', *CT); ent('ROOM', *RM)
ent('ATTENDANCE', *AT, weak=True); ent('AUDIT_LOG', *AU)

rel('RECORDS', 1200, 360); rel('MAKES', 760, 560); rel('HOLDS', 760, 760); rel('PAYS_FOR', 1000, 560)
rel('OF_PLAN', 1000, 945); rel('COVERS', 1375, 560); rel('CONDUCTS', 2015, 760); rel('REQUESTS', 1300, 1320)
rel('BOOKS', 850, 1520); rel('TEACHES', 1900, 1520); rel('OF_TYPE', 1200, 1645); rel('HELD_IN', 1600, 1645)
rel('CHECKS_IN', 360, 605, ident=True)

# specialization circle + subset marks
out.append(f"<circle cx='{ISA[0]}' cy='{ISA[1]}' r='18' fill='#fff' stroke='#000' stroke-width='1.4'/>")
label('d', ISA[0], ISA[1] + 5, size=15)
for x in (M[0], T[0]):
    out.append(f"<path d='M {x-9} 400 A 9 9 0 0 0 {x+9} 400' fill='none' stroke='#000' stroke-width='1.6'/>")

# ----------------------------------------------------------------- (min,max) + role names
label('(0,N)', 1290, 350); label('Recorder', 1290, 395, italic=True); label('(0,1)', 1105, 350)
label('(0,N)', 610, 650); label('(1,1)', 925, 470, 'start'); label('Payer', 600, 680, italic=True)
label('(0,N)', 625, 750); label('(1,1)', 905, 750)
label('(0,1)', 1030, 450, 'start'); label('(0,N)', 985, 680, 'end')
label('(1,1)', 985, 850, 'end'); label('(0,N)', 985, 1095, 'end')
label('(0,1)', 1130, 405, 'start'); label('(0,N)', 1620, 700)
label('(0,N)', 2160, 750); label('(1,1)', 1880, 750)
label('(0,N)', 555, 1250, 'end'); label('Client', 555, 1270, 'end', italic=True); label('(1,1)', 1765, 1250, 'start')
label('(0,N)', 315, 1180, 'start'); label('Member', 315, 1200, 'start', italic=True); label('(0,N)', 1240, 1508)
label('(0,N)', 2295, 1250, 'start'); label('Instructor', 2295, 1270, 'start', italic=True); label('(1,1)', 1560, 1508)
label('(1,1)', 1265, 1580, 'start'); label('(0,N)', 1085, 1725)
label('(1,1)', 1535, 1580, 'end'); label('(0,N)', 1715, 1725)
label('(0,N)', 470, 680); label('(1,1)', 270, 530, 'start')

# ----------------------------------------------------------------- attributes
# USER
fan('USER', [('User_id', {'key': True}), ('Email', {'key': True}), 'Full_name', 'Password_changed_at', 'Password_hash',
             'Phone', 'Role', 'Is_active'], 420, 210, -50, 60)
attr('USER', 'Created_at', 1230, 230); attr('USER', 'Last_login_at', 1270, 295)
# MEMBER
attr('MEMBER', 'Member_id', 420, 905, key=True); attr('MEMBER', 'Member_code', 420, 985, key=True)
attr('MEMBER', 'Gender', 420, 1065); attr('MEMBER', 'Joined_on', 420, 1145)
attr('MEMBER', 'Date_of_birth', 720, 880); attr('MEMBER', 'Age', 850, 935, derived=True)
attr('MEMBER', 'Height_cm', 780, 1005); attr('MEMBER', 'Fitness_goal', 700, 1085)
ec = attr('MEMBER', 'Emergency_contact', 680, 1180)
attr(None, 'Name', 630, 1262, frm=ec); attr(None, 'Phone', 770, 1262, frm=ec)
# TRAINER
attr('TRAINER', 'Trainer_id', 2470, 600, key=True); attr('TRAINER', 'Specialization', 2490, 660)
attr('TRAINER', 'Bio', 2510, 715); attr('TRAINER', 'Experience_years', 2470, 830)
attr('TRAINER', 'Session_rate', 2490, 885); attr('TRAINER', 'Hired_on', 2500, 940)
attr('TRAINER', 'Accepts_pt', 2470, 995)
# PAYMENT
attr('PAYMENT', 'Payment_id', 760, 255, key=True); attr('PAYMENT', 'Transaction_ref', 820, 195, key=True)
attr('PAYMENT', 'Amount', 640, 330); attr('PAYMENT', 'Method', 640, 395)
attr('PAYMENT', 'Status', 720, 450); attr('PAYMENT', 'Paid_at', 1000, 195)
# MEMBERSHIP
fan('MEMBERSHIP', [('Membership_id', {'key': True}), 'Start_date', 'End_date', 'Status', 'Freeze_days_used',
                   'Frozen_from', ('Days_left', {'derived': True})], 300, 125, -72, 72)
# MEMBERSHIP_PLAN
fan('MEMBERSHIP_PLAN', [('Plan_id', {'key': True}), ('Name', {'key': True}), 'Description', 'Price', 'Duration_days',
                        'Classes_per_week', 'Pt_sessions_included', 'Max_freeze_days', 'Is_active'], 320, 190, -62, 56)
# PT_SESSION
fan('PT_SESSION', [('Pt_session_id', {'key': True}), 'Starts_at', 'Ends_at', 'Status', 'Price', 'Member_note', 'Created_at'],
    380, 380, 6, 62)
# CLASS_SESSION
attr('CLASS_SESSION', 'Class_session_id', 1180, 1400, key=True); attr('CLASS_SESSION', 'Starts_at', 1330, 1390)
attr('CLASS_SESSION', 'Ends_at', 1470, 1390); attr('CLASS_SESSION', 'Capacity', 1600, 1400)
attr('CLASS_SESSION', 'Status', 1720, 1440); attr('CLASS_SESSION', 'Seats_left', 1080, 1455, derived=True)
# BOOKS (relationship attributes)
attr('BOOKS', 'Status', 790, 1610); attr('BOOKS', 'Booked_at', 930, 1615)
# CLASS_TYPE
attr('CLASS_TYPE', 'Class_type_id', 770, 1690, key=True); attr('CLASS_TYPE', 'Name', 760, 1760, key=True)
attr('CLASS_TYPE', 'Description', 800, 1835); attr('CLASS_TYPE', 'Intensity', 1000, 1860)
attr('CLASS_TYPE', 'Duration_min', 1180, 1840)
# ROOM
attr('ROOM', 'Room_id', 1700, 1860, key=True); attr('ROOM', 'Name', 1880, 1865, key=True)
attr('ROOM', 'Capacity', 2010, 1800)
# ATTENDANCE (weak)
attr('ATTENDANCE', 'Check_in', 90, 360, partial=True); attr('ATTENDANCE', 'Check_out', 200, 330)
attr('ATTENDANCE', 'Duration', 90, 540, derived=True)
# AUDIT_LOG (filled only by triggers)
for i, (n, k) in enumerate([('Audit_id', True), ('Table_name', False), ('Record_id', False), ('Action', False),
                            ('Old_value', False), ('New_value', False), ('Changed_by', False), ('Changed_at', False)]):
    a = -150 + i * 300 / 7
    attr('AUDIT_LOG', n, AU[0] + 150 * math.cos(math.radians(a)) * (1.1 if i in (3, 4) else 1), AU[1] + 125 * math.sin(math.radians(a)), key=k)
label('written only by triggers', AU[0], AU[1] + 160, size=12, italic=True)

# ----------------------------------------------------------------- title + legend
label('IronPulse Gym Management System — ER Diagram (Elmasri/Navathe notation)', W / 2, 60, size=22)
lx, ly = 60, 1640
out.append(f"<rect x='{lx-20}' y='{ly-35}' width='640' height='300' fill='#fff' stroke='#999'/>")
label('Legend', lx, ly - 10, 'start', size=14)
out.append(f"<rect x='{lx}' y='{ly+5}' width='60' height='24' fill='#d9d9d9' stroke='#000'/>"); label('Entity', lx + 80, ly + 22, 'start')
out.append(f"<rect x='{lx}' y='{ly+40}' width='60' height='24' fill='#d9d9d9' stroke='#000'/><rect x='{lx+3}' y='{ly+43}' width='54' height='18' fill='none' stroke='#000'/>"); label('Weak entity', lx + 80, ly + 57, 'start')
out.append(f"<polygon points='{lx+30},{ly+75} {lx+60},{ly+90} {lx+30},{ly+105} {lx},{ly+90}' fill='#d9d9d9' stroke='#000'/>"); label('Relationship (double = identifying)', lx + 80, ly + 95, 'start')
out.append(f"<ellipse cx='{lx+30}' cy='{ly+125}' rx='30' ry='12' fill='#fff' stroke='#000'/><line x1='{lx+12}' y1='{ly+130}' x2='{lx+48}' y2='{ly+130}' stroke='#000'/>"); label('Key attribute (underlined); dashed underline = partial key', lx + 80, ly + 130, 'start')
out.append(f"<ellipse cx='{lx+30}' cy='{ly+160}' rx='30' ry='12' fill='#fff' stroke='#000' stroke-dasharray='5,3'/>"); label('Derived attribute', lx + 80, ly + 165, 'start')
out.append(f"<line x1='{lx}' y1='{ly+195}' x2='{lx+60}' y2='{ly+195}' stroke='#000' stroke-width='5'/><line x1='{lx}' y1='{ly+195}' x2='{lx+60}' y2='{ly+195}' stroke='#fff' stroke-width='2.2'/>"); label('Total participation (min ≥ 1)', lx + 80, ly + 200, 'start')
label('(min,max) = how many times an entity takes part', lx, ly + 232, 'start')
out.append(f"<circle cx='{lx+30}' cy='{ly+252}' r='10' fill='#fff' stroke='#000'/>"); label('d', lx + 30, ly + 256, size=11); label('Disjoint, partial specialization (a USER is a MEMBER, a TRAINER, or neither = admin)', lx + 80, ly + 257, 'start')

svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='{W}' height='{H}' viewBox='0 0 {W} {H}'><rect width='100%' height='100%' fill='#fff'/>" + ''.join(out) + '</svg>'
here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, 'er-diagram.svg'), 'w', encoding='utf-8').write(svg)
print('written', os.path.join(here, 'er-diagram.svg'))
