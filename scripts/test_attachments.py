"""Exercises attachments by uploading real files over HTTP, including hostile ones.
Needs tokens for pm, site, finance, viewer and hr in $TOKEN_DIR. Run scripts/cleanup-test-attachments.ts afterwards.
"""
import hashlib, os, re, struct, sys, urllib.error, urllib.request, zlib
d = os.environ["TOKEN_DIR"]
sys.argv = [sys.argv[0], f"{d}/pm.tok"]
import form_test as ft
from form_test import as_user, get, submit

PM, SITE, FIN, VIEWER, HR = (f"{d}/{n}.tok" for n in ("pm", "site", "finance", "viewer", "hr"))
tok = lambda path: open(path).read().strip()
failed = 0


def check(name, got, expect):
    global failed
    ok = expect in got
    failed += 0 if ok else 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       got: {got}"))


def plain(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))


def rows(page):
    return re.findall(r"<tr.*?</tr>", page, flags=re.S)


def png(w=2, h=2, shade=200):
    """A real, tiny PNG so it is a genuine image, with a shade so each call can make a different file."""
    raw = b"".join(b"\x00" + bytes([shade, shade, shade]) * w for _ in range(h))
    chunk = lambda t, b: struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
EXE = b"MZ\x90\x00" + b"\x00" * 200
HTML = b"<html><body><script>alert(document.cookie)</script></body></html>"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def get_raw(path, token=None):
    req = urllib.request.Request("http://localhost:3000" + path, headers={"Cookie": f"mcr_session={token}"} if token else {})
    try:
        r = urllib.request.urlopen(req, timeout=120)
        return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


# a seeded expense to hang files on
as_user(PM)
lst = get("/expenses")
exp_id = re.search(r'href="/expenses/(?!new")([a-z0-9]+)"', lst).group(1)  # skip the New expense button
page_of = f"/expenses/{exp_id}"


def upload(name, content, ctype="image/png", entity="Expense", eid=None, note="", as_page=None):
    return submit(page_of, "entityId", dict(entity=entity, entityId=eid or exp_id, file=(name, content, ctype), note=note), page_as=as_page)


def cards():
    """The files actually attached right now (the history list also mentions removed files, correctly)."""
    return re.findall(r'aria-label="Open ([^"]+)"', get(page_of))


def listed(name):
    return name in cards()


good = png(shade=200)
check("a real PNG is attached", "yes" if (upload("receipt.png", good) is not None and listed("receipt.png")) else "missing", "yes")
check("the same file again is refused", upload("copy-of-receipt.png", good), "already attached as receipt.png")
check("a different photo is accepted", "yes" if (upload("second.png", png(shade=90)) is not None and listed("second.png")) else "missing", "yes")
check("a PDF is accepted", "yes" if (upload("invoice.pdf", PDF, "application/pdf") is not None and listed("invoice.pdf")) else "missing", "yes")

# ---------- hostile and broken files ----------
check("a Windows program renamed receipt.jpg is refused", upload("receipt.jpg", EXE, "image/jpeg"), "Only photos")
check("an HTML page named page.png is refused", upload("page.png", HTML, "image/png"), "Only photos")
check("an SVG with a script in it is refused", upload("logo.png", SVG, "image/png"), "Only photos")
check("an empty file is refused", upload("empty.png", b"", "image/png"), "Choose a photo")
big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (8 * 1024 * 1024)
check("a file just over 8 MB is refused with the limit stated", upload("big.png", big), "limit is 8.0 MB")
check("none of the refused files were attached", "yes" if not any(listed(n) for n in ("page.png", "logo.png", "big.png", "empty.png", "receipt.jpg")) else "one got in", "yes")
hostile = r"..\..\windows\evil.png"
upload(hostile, png(shade=50))
check("a path in the filename is cleaned", "yes" if listed("evil.png") and not any(("windows" in c) or (chr(92) in c) for c in cards()) else "kept the path: " + str(cards()), "yes")
check("an unknown kind of record is refused", upload("x.png", png(shade=51), entity="User"), "cannot have attachments")
check("a record that does not exist is refused", upload("y.png", png(shade=52), eid="doesnotexist123"), "does not exist")

# ---------- who can see and add ----------
att = {m.group(2): m.group(1) for m in re.finditer(r'href="/api/files/([a-z0-9]+)"[^>]*aria-label="Open ([^"]+)"', get(page_of))}
print("attachments on the page:", sorted(att))
aid = att["receipt.png"]

code, hdr, body = get_raw(f"/api/files/{aid}", tok(PM))
check("the uploader can open the file and gets exactly the bytes uploaded", "yes" if code == 200 and hashlib.sha256(body).hexdigest() == hashlib.sha256(good).hexdigest() else f"{code}", "yes")
check("it is served as the type found in its bytes", hdr.get("content-type", ""), "image/png")
check("the browser is told not to guess the type", hdr.get("x-content-type-options", ""), "nosniff")
check("a content policy stops any script in a file", hdr.get("content-security-policy", ""), "sandbox")
check("it opens inline by default", hdr.get("content-disposition", ""), "inline")
check("?download=1 makes it a download", get_raw(f"/api/files/{aid}?download=1", tok(PM))[1].get("content-disposition", ""), "attachment")
check("it is never cached", hdr.get("cache-control", ""), "no-store")
check("a viewer, who can read expenses, can open it", "yes" if get_raw(f"/api/files/{aid}", tok(VIEWER))[0] == 200 else "no", "yes")
check("someone not signed in gets 401", str(get_raw(f"/api/files/{aid}")[0]), "401")
check("a role that cannot read expenses gets 404, so the file's existence is not revealed", str(get_raw(f"/api/files/{aid}", tok(HR))[0]), "404")
check("an invented id gets 404", str(get_raw("/api/files/doesnotexist123", tok(PM))[0]), "404")
check("a path-traversal id gets 404", str(get_raw("/api/files/..%2F..%2F.env", tok(PM))[0]), "404")

# a viewer cannot add files: borrow the PM's form and post as the viewer
as_user(VIEWER)
upload("viewer.png", png(shade=77), as_page=PM)
as_user(PM)
check("a viewer's upload is not applied", "yes" if not listed("viewer.png") else "applied", "yes")

# ---------- removing ----------
as_user(PM)
rm = lambda who_token, i, reason, page_as=None: (as_user(who_token), submit(page_of, "to", dict(id=i, to="REMOVE", reason=reason), contains=f'value="{i}"', page_as=page_as))[1]
check("removing needs a reason", rm(PM, aid, "x"), "why it is being removed")
as_user(SITE)
submit(page_of, "to", dict(id=aid, to="REMOVE", reason="Not mine to remove"), contains=f'value="{aid}"', page_as=PM)
as_user(PM)
check("someone else on site cannot remove it", "yes" if listed("receipt.png") else "removed", "yes")
second = att["second.png"]
as_user(FIN)
submit(page_of, "to", dict(id=second, to="REMOVE", reason="Duplicate of the receipt"), contains=f'value="{second}"')
as_user(PM)
check("finance staff can remove another person's file", "yes" if not listed("second.png") else "still there", "yes")
check("a removed file can no longer be opened", str(get_raw(f"/api/files/{second}", tok(PM))[0]), "404")
check("the removal and its reason are in the history", "yes" if "Duplicate of the receipt" in plain(get(page_of)) else "missing", "yes")
check("the uploader can remove their own", "yes" if (rm(PM, aid, "Wrong receipt") is not None and not listed("receipt.png")) else "still there", "yes")

# ---------- the files are still on disk ----------
store = os.environ.get("STORAGE_DIR") or os.path.join(os.getcwd(), "..", "storage")
on_disk = sum(len(fs) for _, _, fs in os.walk(store)) if os.path.isdir(store) else 0
check("removed files are kept on disk, not deleted", "yes" if on_disk >= 4 else f"only {on_disk} files", "yes")
check("the history records who attached what", "yes" if "attached receipt.png" in plain(get(page_of)) or "attached" in plain(get(page_of)) else "missing", "yes")

print("\n" + ("%d FAILED" % failed if failed else "all passed"))
sys.exit(1 if failed else 0)
