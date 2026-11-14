# Renders excerpts of the real source files as editor-style images
# -> docs/screenshots/code-*.png  (headless Edge). Line numbers are the real ones.
# Run from the project root:  python docs/tools/code_shots.py
import html, os, re, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # project root
OUT = os.path.join(ROOT, 'docs', 'screenshots')
TMP = os.path.join(ROOT, 'docs', 'report-assets')
os.makedirs(TMP, exist_ok=True)
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

def find_range(path, start_pat, end_pat=None, length=None, before=0):
    lines = open(os.path.join(ROOT, path), encoding='utf-8').read().split('\n')
    s = next(i for i, l in enumerate(lines) if re.search(start_pat, l)) - before
    if end_pat:
        e = next(i for i in range(s + 1, len(lines)) if re.search(end_pat, lines[i]))
    else:
        e = s + length - 1
    return s + 1, e + 1

SHOTS = [
    ('code-proxy', 'src/proxy.js', (1, 26)),
    ('code-db-helpers', 'src/lib/db.js', (21, 63)),
    ('code-refund-transaction', 'src/app/admin/actions.js', find_range('src/app/admin/actions.js', r'A refund never deletes', r'^}$')),
    ('code-sp-book-class', 'db/mysql/03_routines.sql', find_range('db/mysql/03_routines.sql', r'CREATE PROCEDURE sp_book_class', r'^END\$\$')),
    ('code-trigger-attendance', 'db/mysql/04_triggers.sql', find_range('db/mysql/04_triggers.sql', r'CREATE TRIGGER trg_attendance_bi', r'^END\$\$')),
    ('code-mongo-validator', 'db/mongo/collections.mjs', find_range('db/mongo/collections.mjs', r"name: 'workout_logs'", r"name: 'body_metrics'", before=1)),
    ('code-mongo-aggregation', 'src/app/member/workouts/page.js', find_range('src/app/member/workouts/page.js', r'Aggregation: training volume', r'\]\)\.toArray\(\),')),
]

KW = {
    'sql': r'\b(CREATE|PROCEDURE|TRIGGER|BEFORE|INSERT|ON|FOR|EACH|ROW|BEGIN|END|DECLARE|DEFAULT|EXIT|HANDLER|SQLEXCEPTION|ROLLBACK|RESIGNAL|START|TRANSACTION|COMMIT|SELECT|INTO|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|IF|THEN|ELSE|ELSEIF|SET|SIGNAL|SQLSTATE|MESSAGE_TEXT|UPDATE|VALUES|JOIN|EXISTS|COUNT|NEW|OUT|INT|UNSIGNED|VARCHAR|SMALLINT|TINYINT|DATETIME|DATE|LIMIT|ORDER|BY|DESC|NOW|BETWEEN)\b',
    'js': r'\b(import|export|from|const|let|async|await|function|return|if|else|try|catch|finally|throw|new|of|in|for|default|null|true|false)\b',
}

def highlight(code, lang):
    out, pos = [], 0
    tok = re.compile(r"(?P<c>--[^\n]*|//[^\n]*)|(?P<s>'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`[^`]*`)|(?P<n>\b\d+(?:\.\d+)?\b)|(?P<k>" + KW[lang] + ")")
    for m in tok.finditer(code):
        out.append(html.escape(code[pos:m.start()]))
        cls = m.lastgroup
        out.append(f'<span class="{cls}">{html.escape(m.group())}</span>')
        pos = m.end()
    out.append(html.escape(code[pos:]))
    return ''.join(out)

for name, path, (a, b) in SHOTS:
    lines = open(os.path.join(ROOT, path), encoding='utf-8').read().split('\n')[a - 1:b]
    lang = 'sql' if path.endswith('.sql') else 'js'
    body = highlight('\n'.join(lines), lang).split('\n')
    rows = ''.join(f'<div class="l"><span class="no">{a + i}</span><span class="tx">{t or " "}</span></div>' for i, t in enumerate(body))
    W = 1180
    H = 58 + 20 * len(lines) + 16
    page = f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;background:#1e1e1e}}
.bar{{height:38px;background:#2d2d2d;color:#ccc;font:13px "Segoe UI",sans-serif;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #111}}
.dot{{width:11px;height:11px;border-radius:50%;display:inline-block}}
.code{{padding:10px 0;font:13.5px/20px Consolas,"Cascadia Mono",monospace;color:#d4d4d4;white-space:pre}}
.l{{display:flex}} .no{{width:52px;text-align:right;padding-right:16px;color:#6e7681;flex:none}}
.k{{color:#569cd6}} .s{{color:#ce9178}} .c{{color:#6a9955}} .n{{color:#b5cea8}}
</style></head><body><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span>
<span class="dot" style="background:#28c840"></span>&nbsp;&nbsp;{html.escape(path)} — lines {a}–{b}</div><div class="code">{rows}</div></body></html>'''
    src = os.path.join(TMP, name + '.html')
    open(src, 'w', encoding='utf-8').write(page)
    png = os.path.join(OUT, name + '.png')
    subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    f'--window-size={W},{H}', f'--screenshot={png}', 'file:///' + src.replace('\\', '/')], capture_output=True, timeout=60)
    os.remove(src)
    print(name, path, f'{a}-{b}', f'{W}x{H}')
