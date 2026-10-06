"""Submits the app's real forms over HTTP, like a browser with JavaScript off.
Local testing only. Usage: python scripts/form_test.py <session-token-file>

A value in the data can be a (filename, bytes, content_type) tuple, which is sent as an uploaded file.
"""
import html, os, re, sys, urllib.error, urllib.request, uuid

BASE = "http://localhost:3000"
TOKEN = open(sys.argv[1]).read().strip() if len(sys.argv) > 1 and os.path.exists(sys.argv[1]) else ""


def as_user(token_file):
    """Switch which signed-in test user the following requests act as."""
    global TOKEN
    TOKEN = open(token_file).read().strip()


def get(path):
    req = urllib.request.Request(BASE + path, headers={"Cookie": f"mcr_session={TOKEN}"})
    return urllib.request.urlopen(req, timeout=120).read().decode()


def forms(page):
    return re.findall(r"<form\b.*?</form>", page, flags=re.S)


def fields(form):
    out = []
    for m in re.finditer(r"<input\b[^>]*>", form):
        tag = m.group(0)
        name = re.search(r'name="([^"]*)"', tag)
        if not name:
            continue
        val = re.search(r'value="([^"]*)"', tag)
        typ = re.search(r'type="([^"]*)"', tag)
        out.append((name.group(1), html.unescape(val.group(1)) if val else "", typ.group(1) if typ else "text"))
    for m in re.finditer(r"<select\b[^>]*name=\"([^\"]*)\"[^>]*>(.*?)</select>", form, flags=re.S):
        sel = re.search(r'<option[^>]*selected[^>]*value="([^"]*)"|<option[^>]*value="([^"]*)"[^>]*selected', m.group(2))
        out.append((m.group(1), (sel.group(1) or sel.group(2)) if sel else "", "select"))
    return out


def options(page, select_name, by="name"):
    m = re.search(r'<select\b[^>]*%s="%s"[^>]*>(.*?)</select>' % (by, select_name), page, flags=re.S)
    return [(html.unescape(v), html.unescape(re.sub(r"<[^>]+>", "", t)).strip()) for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(1), flags=re.S)] if m else []


def _body(data, boundary):
    CRLF = b"\r\n"
    out = b""
    for n, v in data.items():
        if isinstance(v, tuple):
            fname, content, ctype = v
            out += (f"--{boundary}").encode() + CRLF
            out += f'Content-Disposition: form-data; name="{n}"; filename="{fname}"'.encode() + CRLF
            out += f"Content-Type: {ctype}".encode() + CRLF + CRLF + content + CRLF
        else:
            out += (f"--{boundary}").encode() + CRLF
            out += f'Content-Disposition: form-data; name="{n}"'.encode() + CRLF + CRLF
            out += str(v).encode() + CRLF
    return out + (f"--{boundary}--").encode() + CRLF


def submit(path, marker, values, contains=None, page_as=None, post_path=None):
    """Finds the form on `path` that has a field called `marker`, fills it, posts it, returns the message shown.
    `page_as` reads the page as another user, to borrow a form the current user cannot see.
    `post_path` posts the form to a different page than the one it was read from (what a forged request would do)."""
    global TOKEN
    me = TOKEN
    if page_as:
        TOKEN = open(page_as).read().strip()
    page = get(path)
    TOKEN = me
    form = next(f for f in forms(page) if re.search(r'name="%s"' % marker, f) and (contains is None or contains in f))
    data = dict((n, v) for n, v, _ in fields(form) if n.startswith("$ACTION"))
    for n, v, t in fields(form):
        if not n.startswith("$ACTION") and t not in ("checkbox", "file"):
            data[n] = v
    data.update(values)
    boundary = "----" + uuid.uuid4().hex
    req = urllib.request.Request(BASE + (post_path or path), data=_body(data, boundary), headers={
        "Cookie": f"mcr_session={TOKEN}", "Content-Type": f"multipart/form-data; boundary={boundary}", "Origin": BASE})
    try:
        res = urllib.request.urlopen(req, timeout=180).read().decode()
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}"
    # the form that was submitted now carries the result
    for f in forms(res):
        if re.search(r'name="%s"' % marker, f) and (contains is None or contains in f):
            m = re.search(r'class="notice (error|ok)"[^>]*>(.*?)</div>', f, flags=re.S)
            if m:
                return f"[{m.group(1).upper()}] " + html.unescape(re.sub(r"<[^>]+>", "", m.group(2)))
            m = re.search(r'role="(alert|status)"[^>]*>(.*?)</span>', f, flags=re.S)  # the small action buttons
            if m:
                return ("[ERROR] " if m.group(1) == "alert" else "[OK] ") + html.unescape(re.sub(r"<[^>]+>", "", m.group(2)))
    return "(no message shown)"
