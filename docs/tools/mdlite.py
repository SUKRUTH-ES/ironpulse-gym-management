# Tiny markdown -> HTML converter for the generated .md files (no external package needed).
import html, re
esc = html.escape

# ------------------------------------------------------------------ tiny markdown → HTML (enough for our generated .md files)
def inline(s):
    s = esc(s, quote=False)
    codes = []   # keep code spans away from the emphasis rules (underscores in names)
    s = re.sub(r'`([^`]+)`', lambda m: codes.append(m.group(1)) or f'\x00{len(codes) - 1}\x00', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'(?<![\w/])_([^_]+)_(?![\w/])', r'<em>\1</em>', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', s)
    return re.sub(r'\x00(\d+)\x00', lambda m: '<code>' + codes[int(m.group(1))] + '</code>', s)

def split_row(line):
    cells = re.split(r'(?<!\\)\|', line.strip().strip('|'))
    return [c.strip().replace('\\|', '|') for c in cells]

def md_to_html(text, shift=1, skip_title=True):
    lines = text.split('\n')
    out, i = [], 0
    if skip_title and lines and lines[0].startswith('# '):
        i = 1
    para = []
    def flush():
        if para:
            out.append('<p>' + inline(' '.join(para)) + '</p>')
            para.clear()
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('```'):
            flush()
            lang = ln[3:].strip()
            buf = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                buf.append(lines[i]); i += 1
            out.append(f'<pre class="code {lang}"><code>{esc(chr(10).join(buf))}</code></pre>')
        elif re.match(r'^#{1,6} ', ln):
            flush()
            lvl = len(ln) - len(ln.lstrip('#'))
            out.append(f'<h{min(lvl + shift, 6)}>{inline(ln[lvl + 1:])}</h{min(lvl + shift, 6)}>')
        elif ln.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s\-:|]+\|$', lines[i + 1].strip()):
            flush()
            head = split_row(ln)
            i += 2
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(split_row(lines[i])); i += 1
            t = ['<table><thead><tr>' + ''.join(f'<th>{inline(h)}</th>' for h in head) + '</tr></thead><tbody>']
            for r in rows:
                t.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>')
            out.append(''.join(t) + '</tbody></table>')
            continue
        elif ln.startswith('- '):
            flush()
            items = []
            while i < len(lines) and lines[i].startswith('- '):
                items.append(lines[i][2:]); i += 1
            out.append('<ul>' + ''.join(f'<li>{inline(x)}</li>' for x in items) + '</ul>')
            continue
        elif not ln.strip():
            flush()
        else:
            para.append(ln.strip())
        i += 1
    flush()
    return '\n'.join(out)

