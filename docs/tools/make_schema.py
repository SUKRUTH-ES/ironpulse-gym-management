# Draws the relational schema (MySQL) and the MongoDB document model from docs/tools/schema.json.
# Run from the project root:  python docs/tools/make_schema.py
# Then render:  bash docs/diagrams/render.sh relational-schema W H   (sizes are printed)
import json, html, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, 'tools', 'schema.json'), encoding='utf-8'))
esc = html.escape

cols = {}
for c in d['columns']:
    cols.setdefault(c['tbl'], []).append(c)
fk_of = {(f['tbl'], f['col']): f for f in d['fks']}
uniq = {}
for i in d['indexes']:
    if not i['non_unique'] and i['name'] != 'PRIMARY' and ',' not in i['cols']:
        uniq[(i['tbl'], i['cols'])] = True

# ------------------------------------------------------------------ relational schema
W, ROW, HEAD, GAP = 330, 21, 30, 46
LAYOUT = [
    ['membership_plans', 'audit_log'],
    ['memberships', 'attendance'],
    ['members', 'payments', 'class_bookings'],
    ['users', 'pt_sessions', 'class_sessions'],
    ['trainers', 'class_types', 'rooms'],
]
COLX = [40 + i * (W + 120) for i in range(len(LAYOUT))]
TOP = 90

def short_type(t):
    t = t.replace(' unsigned', ' UNSIGNED')
    if t.startswith('enum('):
        n = t.count(',') + 1
        return f'ENUM({n})'
    return t.upper()

box = {}      # table -> (x, y, h)
rowy = {}     # (table, col) -> y centre
svg = []
maxy = 0
for ci, stack in enumerate(LAYOUT):
    y = TOP
    for t in stack:
        cs = cols[t]
        h = HEAD + ROW * len(cs) + 8
        x = COLX[ci]
        box[t] = (x, y, h)
        svg.append(f"<rect x='{x}' y='{y}' width='{W}' height='{h}' rx='4' fill='#fff' stroke='#334' stroke-width='1.3'/>")
        svg.append(f"<rect x='{x}' y='{y}' width='{W}' height='{HEAD}' rx='4' fill='#0f766e'/>")
        svg.append(f"<text x='{x + 12}' y='{y + 20}' fill='#fff' font-weight='bold' font-size='15'>{t}</text>")
        svg.append(f"<text x='{x + W - 10}' y='{y + 20}' fill='#cdeeea' font-size='11' text-anchor='end'>{d['rowCounts'][t]} rows</text>")
        for k, c in enumerate(cs):
            cy = y + HEAD + 4 + ROW * k + ROW / 2
            rowy[(t, c['col'])] = cy
            pk = c['ckey'] == 'PRI'
            fk = (t, c['col']) in fk_of
            if k % 2:
                svg.append(f"<rect x='{x + 1}' y='{cy - ROW / 2}' width='{W - 2}' height='{ROW}' fill='#f1f5f4'/>")
            tags = []
            if pk: tags.append('PK')
            if fk: tags.append('FK')
            if (t, c['col']) in uniq and not pk: tags.append('UQ')
            style = "font-weight='bold' text-decoration='underline'" if pk else ("font-style='italic'" if fk else '')
            nn = '' if c['nullable'] == 'YES' else ' *'
            svg.append(f"<text x='{x + 10}' y='{cy + 4}' font-size='12' fill='#0f766e' font-weight='bold'>{' '.join(tags)}</text>")
            svg.append(f"<text x='{x + 52}' y='{cy + 4}' font-size='12.5' {style}>{esc(c['col'])}{nn}</text>")
            svg.append(f"<text x='{x + W - 10}' y='{cy + 4}' font-size='11' fill='#555' text-anchor='end'>{esc(short_type(c['type']))}</text>")
        y += h + GAP
        maxy = max(maxy, y)

# FK arrows (drawn under the boxes)
arrows = []
for f in d['fks']:
    a, b = f['tbl'], f['ref_tbl']
    ax, _, _ = box[a]; bx, _, _ = box[b]
    y1, y2 = rowy[(a, f['col'])], rowy[(b, f['ref_col'])]
    if ax == bx:   # same column: loop out on the right
        x1 = x2 = ax + W
        c1 = c2 = x1 + 40 + abs(y1 - y2) * 0.12
    elif ax < bx:
        x1, x2 = ax + W, bx
        c1, c2 = x1 + 60, x2 - 60
    else:
        x1, x2 = ax, bx + W
        c1, c2 = x1 - 60, x2 + 60
    dash = " stroke-dasharray='6 4'" if f['on_delete'] == 'CASCADE' else ''
    arrows.append(f"<path d='M {x1} {y1} C {c1} {y1}, {c2} {y2}, {x2} {y2}' fill='none' stroke='#0f766e' stroke-width='1.5' opacity='0.85' marker-end='url(#arr)'{dash}/>")
    arrows.append(f"<circle cx='{x1}' cy='{y1}' r='3' fill='#0f766e'/>")

width = COLX[-1] + W + 60
lx, ly = 40, maxy + 10
legend = [
    f"<text x='{lx}' y='{ly}' font-size='13' font-weight='bold'>Legend</text>",
    f"<text x='{lx}' y='{ly + 22}' font-size='12.5' xml:space='preserve'><tspan font-weight='bold' text-decoration='underline'>column</tspan> = primary key (PK)   "
    f"<tspan font-style='italic'>column</tspan> = foreign key (FK)   UQ = unique   * = NOT NULL   ENUM(n) = enum with n values</text>",
    f"<path d='M {lx} {ly + 44} L {lx + 60} {ly + 44}' stroke='#0f766e' stroke-width='1.5' marker-end='url(#arr)'/>"
    f"<text x='{lx + 75}' y='{ly + 48}' font-size='12.5'>FK → referenced PK (ON DELETE NO ACTION)</text>",
    f"<path d='M {lx + 420} {ly + 44} L {lx + 480} {ly + 44}' stroke='#0f766e' stroke-width='1.5' stroke-dasharray='6 4' marker-end='url(#arr)'/>"
    f"<text x='{lx + 495}' y='{ly + 48}' font-size='12.5'>ON DELETE CASCADE</text>",
]
height = ly + 75
head = (f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}' "
        f"font-family='Segoe UI, Arial, sans-serif'>"
        "<defs><marker id='arr' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='8' markerHeight='8' orient='auto-start-reverse'>"
        "<path d='M0,0 L10,5 L0,10 z' fill='#0f766e'/></marker></defs>"
        f"<rect width='100%' height='100%' fill='#fff'/>"
        f"<text x='{width / 2}' y='45' font-size='24' text-anchor='middle'>IronPulse — Relational Schema (MySQL <tspan font-style='italic'>gym_db</tspan>, "
        f"{len(d['tables'])} tables, {len(d['fks'])} foreign keys)</text>")
open(os.path.join(ROOT, 'diagrams', 'relational-schema.svg'), 'w', encoding='utf-8').write(
    head + ''.join(arrows) + ''.join(svg) + ''.join(legend) + '</svg>')
print('relational-schema', width, height)

# ------------------------------------------------------------------ MongoDB document model
MODEL = {
    'exercises': [
        ('_id', 'ObjectId', 'PK'), ('name', 'string', ''), ('slug', 'string  ^[a-z0-9-]+$', 'UQ'),
        ('category', 'strength|cardio|mobility|plyometric', ''), ('primaryMuscle', 'string', ''),
        ('secondaryMuscles', '[string]', ''), ('equipment', '[string]', ''),
        ('level', 'beginner|intermediate|advanced', ''), ('instructions', '[string]', ''), ('tags', '[string]', ''),
        ('createdBy', 'int | null → members.member_id', 'REF'),
    ],
    'workout_plans': [
        ('_id', 'ObjectId', 'PK'), ('memberId', 'int → members.member_id', 'REF'),
        ('trainerId', 'int | null → trainers.trainer_id', 'REF'), ('title', 'string 3–100', ''),
        ('goal', 'enum', ''), ('durationWeeks', 'int 1–52', ''), ('status', 'active|archived', ''),
        ('days[1..7]', '{ day, title, exercises[] }', 'EMB'),
        ('  exercises[]', '{ exerciseId, name, sets, reps, restSec, notes }', 'EMB'),
        ('createdAt / updatedAt', 'date', ''),
    ],
    'workout_logs': [
        ('_id', 'ObjectId', 'PK'), ('memberId', 'int → members.member_id', 'REF'),
        ('planId', 'ObjectId → workout_plans._id', 'REF'), ('performedAt', 'date', ''),
        ('durationMin', 'int 5–300', ''), ('rpe', 'int 1–10', ''), ('notes', 'string ≤500', ''),
        ('exercises[]', '{ exerciseId, name, sets[] }', 'EMB'),
        ('  sets[]', '{ reps, weightKg, durationSec }', 'EMB'),
        ('cardio[]', '{ activity, minutes, distanceKm }', 'EMB'),
    ],
    'body_metrics  (time-series)': [
        ('recordedAt', 'date  (timeField)', ''), ('memberId', 'int  (metaField) → members', 'REF'),
        ('weightKg', 'double', ''), ('bodyFatPct', 'double?', ''), ('waistCm', 'double?', ''),
    ],
    'notifications': [
        ('_id', 'ObjectId', 'PK'), ('userId', 'int → users.user_id', 'REF'),
        ('type', 'renewal_reminder|waitlist_promoted|…', ''), ('title', 'string', ''),
        ('message', 'string', ''), ('readAt', 'date | null', ''), ('createdAt', 'date  (TTL 60 days)', ''),
        ('meta', 'object', 'EMB'),
    ],
}
coll_key = {k: k.split()[0] for k in MODEL}
idx = {m['name']: [i for i in m['indexes'] if i['name'] != '_id_'] for m in d['mongo']}
count = {m['name']: m['count'] for m in d['mongo']}

MW = 470
POS = {'exercises': (40, 100), 'workout_plans': (560, 100), 'workout_logs': (1080, 100),
       'body_metrics  (time-series)': (40, 500), 'notifications': (560, 450)}
msvg, mrow = [], {}
mh = 0
for name, fields in MODEL.items():
    x, y = POS[name]
    key = coll_key[name]
    ix = idx.get(key, [])
    h = HEAD + ROW * len(fields) + 14 + 18 * (len(ix) + 1)
    mh = max(mh, y + h)
    msvg.append(f"<rect x='{x}' y='{y}' width='{MW}' height='{h}' rx='6' fill='#fff' stroke='#334' stroke-width='1.3'/>")
    msvg.append(f"<rect x='{x}' y='{y}' width='{MW}' height='{HEAD}' rx='6' fill='#3f6212'/>")
    msvg.append(f"<text x='{x + 12}' y='{y + 20}' fill='#fff' font-weight='bold' font-size='15'>{esc(name)}</text>")
    msvg.append(f"<text x='{x + MW - 10}' y='{y + 20}' fill='#e2f0c9' font-size='11' text-anchor='end'>{count.get(key, 0)} docs</text>")
    for k, (fname, ftype, tag) in enumerate(fields):
        cy = y + HEAD + 4 + ROW * k + ROW / 2
        mrow[(key, fname.strip())] = cy
        if k % 2:
            msvg.append(f"<rect x='{x + 1}' y='{cy - ROW / 2}' width='{MW - 2}' height='{ROW}' fill='#f4f7ef'/>")
        style = "font-weight='bold' text-decoration='underline'" if tag == 'PK' else ("font-style='italic'" if tag == 'REF' else '')
        msvg.append(f"<text x='{x + 10}' y='{cy + 4}' font-size='11.5' fill='#3f6212' font-weight='bold'>{tag}</text>")
        msvg.append(f"<text x='{x + 50}' y='{cy + 4}' font-size='12.5' {style} xml:space='preserve'>{esc(fname)}</text>")
        msvg.append(f"<text x='{x + MW - 10}' y='{cy + 4}' font-size='11' fill='#555' text-anchor='end'>{esc(ftype)}</text>")
    iy = y + HEAD + ROW * len(fields) + 22
    msvg.append(f"<line x1='{x}' x2='{x + MW}' y1='{iy - 12}' y2='{iy - 12}' stroke='#bbb'/>")
    msvg.append(f"<text x='{x + 10}' y='{iy + 4}' font-size='11.5' font-weight='bold'>Indexes</text>")
    for j, i in enumerate(ix):
        keys = ', '.join(f"{k}:{v}" for k, v in i['key'].items())
        extra = ' unique' if i.get('unique') else ''
        if 'expireAfterSeconds' in i: extra += f" TTL {i['expireAfterSeconds'] // 86400}d"
        if 'weights' in i: extra += ' weights ' + ', '.join(f"{k} {v}" for k, v in i['weights'].items())
        msvg.append(f"<text x='{x + 10}' y='{iy + 22 + 18 * j}' font-size='11'>{esc(i['name'])}: {{{esc(keys)}}}{esc(extra)}</text>")

marrows = []
def link(a, af, b, bf):
    ax, ay = POS[[k for k in MODEL if coll_key[k] == a][0]]
    bx, by = POS[[k for k in MODEL if coll_key[k] == b][0]]
    y1, y2 = mrow[(a, af)], mrow[(b, bf)]
    if ax > bx:
        x1, x2, c1, c2 = ax, bx + MW, ax - 50, bx + MW + 50
    else:
        x1, x2, c1, c2 = ax + MW, bx, ax + MW + 50, bx - 50
    marrows.append(f"<path d='M {x1} {y1} C {c1} {y1}, {c2} {y2}, {x2} {y2}' fill='none' stroke='#3f6212' stroke-width='1.5' marker-end='url(#arm)'/>")
link('workout_plans', 'exercises[]', 'exercises', '_id')
link('workout_logs', 'planId', 'workout_plans', '_id')

ny = mh + 40
notes = [
    "REF = reference by value (no join): memberId / trainerId / userId / createdBy hold MySQL primary keys; the app checks them in MySQL before writing to MongoDB.",
    "EMB = embedded sub-document / array: a plan's days and exercises, and a log's sets, are always read together, so they are stored inside the parent document.",
    "Arrows show ObjectId references inside MongoDB (exerciseId → exercises._id, planId → workout_plans._id).",
    "exercises, workout_plans, workout_logs and notifications have a $jsonSchema validator (strict, action error). body_metrics is a time-series collection (range 25–300 kg checked by the app); notifications expire after 60 days (TTL index).",
]
for k, n in enumerate(notes):
    msvg.append(f"<text x='40' y='{ny + 20 * k}' font-size='12.5'>{esc(n)}</text>")
mwidth, mheight = 1600, ny + 20 * len(notes) + 20
mhead = (f"<svg xmlns='http://www.w3.org/2000/svg' width='{mwidth}' height='{mheight}' viewBox='0 0 {mwidth} {mheight}' "
         f"font-family='Segoe UI, Arial, sans-serif'>"
         "<defs><marker id='arm' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='8' markerHeight='8' orient='auto'>"
         "<path d='M0,0 L10,5 L0,10 z' fill='#3f6212'/></marker></defs>"
         "<rect width='100%' height='100%' fill='#fff'/>"
         f"<text x='{mwidth / 2}' y='50' font-size='24' text-anchor='middle'>IronPulse — MongoDB Document Model (<tspan font-style='italic'>gym_mongo</tspan>, 5 collections)</text>")
open(os.path.join(ROOT, 'diagrams', 'mongodb-model.svg'), 'w', encoding='utf-8').write(
    mhead + ''.join(marrows) + ''.join(msvg) + '</svg>')
print('mongodb-model', mwidth, mheight)
