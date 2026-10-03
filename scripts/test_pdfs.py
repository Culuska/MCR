"""Fetches the real PDF documents over HTTP and checks what is inside them and who may open them.
Needs tokens for finance, viewer, hr, site in $TOKEN_DIR.
"""
import os, re, sys, urllib.error, urllib.request, zlib
d = os.environ["TOKEN_DIR"]
tok = lambda n: open(f"{d}/{n}.tok").read().strip()
failed = 0


def check(name, got, expect):
    global failed
    ok = expect in got
    failed += 0 if ok else 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       got: {got[:200]}"))


def fetch(path, who=None):
    req = urllib.request.Request("http://localhost:3000" + path, headers={"Cookie": f"mcr_session={tok(who)}"} if who else {})
    try:
        r = urllib.request.urlopen(req, timeout=180)
        return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def text_of(pdf: bytes) -> str:
    """The words drawn on the pages. Content streams are compressed; strings are literal or hex."""
    out = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf, flags=re.S):
        try:
            data = zlib.decompress(m.group(1))
        except Exception:
            continue
        for h in re.findall(rb"<([0-9A-Fa-f]{2,})>", data):
            out.append(bytes.fromhex(h.decode()).decode("latin-1"))
        for lit in re.findall(rb"\(((?:[^()\\]|\\.)*)\)", data):
            out.append(lit.decode("latin-1"))
    return "".join(out)  # words arrive in pieces, so compare with spaces removed


has = lambda pdf, s: s.replace(" ", "") in text_of(pdf).replace(" ", "")
pages = lambda pdf: len(re.findall(rb"/Type /Page(?!s)", pdf))


def ids(path, pattern, who="finance"):
    code, _, body = fetch(path, who)
    return re.findall(pattern, body.decode("utf-8", "ignore"))


inv_id = ids("/invoices", r'href="/invoices/(?!new")([a-z0-9]+)"')[0]  # skip the New invoice button
projects = re.findall(r'href="/projects/([a-z0-9]+)"><b>(MCR-[\d-]+)</b>', fetch("/projects", "finance")[2].decode("utf-8", "ignore"))
p1 = next(i for i, c in projects if c == "MCR-2026-01")
runs = re.findall(r'href="/payroll/([a-z0-9]+)"><b>(PRN-\d+)</b>', fetch("/payroll", "finance")[2].decode("utf-8", "ignore"))
runs_by_no = {n: i for i, n in runs}
sub1 = re.search(r'href="/subcontracts/([a-z0-9]+)"><b>SUB-00001', fetch("/subcontracts", "finance")[2].decode("utf-8", "ignore")).group(1)
cert_ids = re.findall(r'href="/api/pdf/certificate/([a-z0-9]+)"', fetch(f"/subcontracts/{sub1}", "finance")[2].decode("utf-8", "ignore"))

# ---------- invoice ----------
code, h, pdf = fetch(f"/api/pdf/invoice/{inv_id}", "finance")
check("an invoice PDF is returned", f"{code} {h.get('content-type')}", "200 application/pdf")
check("it is a real PDF", pdf[:5].decode("latin-1") + "|" + pdf[-10:].decode("latin-1").strip()[-5:], "%PDF-|%%EOF")
check("it is named after the invoice", h.get("content-disposition", ""), 'filename="INV-')
check("it is not cached and cannot be sniffed", h.get("cache-control", "") + h.get("x-content-type-options", ""), "no-storenosniff")
check("it shows the company", "yes" if has(pdf, "MOGADISHU CONSTRUCTION AND REHABILITATION") else "missing", "yes")
check("it says INVOICE and has an invoice number", "yes" if has(pdf, "INVOICE") and re.search(r"INV-\d{5}", text_of(pdf).replace(" ", "")) else "missing", "yes")
check("it shows who is billed and for which project", "yes" if has(pdf, "BILL TO") and has(pdf, "MCR-2026-0") else "missing", "yes")
check("it shows a balance due", "yes" if has(pdf, "Balance due") else "missing", "yes")
check("it has a page footer", "yes" if has(pdf, "Page 1 of 1") else "missing", "yes")
check("it is a single page", str(pages(pdf)), "1")

# ---------- project statement ----------
code, h, pdf = fetch(f"/api/pdf/project/{p1}", "finance")
check("a project statement PDF is returned", f"{code} {h.get('content-type')}", "200 application/pdf")
check("it names the project and shows the budget table", "yes" if has(pdf, "MCR-2026-01") and has(pdf, "BUDGET AGAINST ACTUAL") and has(pdf, "Contract value") else "missing", "yes")
check("it lists budget categories", "yes" if has(pdf, "Materials") and has(pdf, "Wages") else "missing", "yes")
check("it shows the expected profit", "yes" if has(pdf, "Expected profit at completion") else "missing", "yes")

# ---------- payslips ----------
paid_run = runs_by_no["PRN-00001"]
code, h, pdf = fetch(f"/api/pdf/payroll/{paid_run}", "finance")
check("payslips for a paid run are returned", f"{code} {h.get('content-type')}", "200 application/pdf")
check("there is one page per employee (13)", str(pages(pdf)), "13")
check("each page is a payslip with a net pay", "yes" if text_of(pdf).replace(" ", "").count("NETPAY") == 13 else str(text_of(pdf).replace(" ", "").count("NETPAY")), "yes")
check("the payslips name the employees", "yes" if has(pdf, "Mason 1") and has(pdf, "Labourer 4") else "missing", "yes")
check("an adjusted payslip shows its figures (Mason 1: bonus 20, deduction 5, net 402)", "yes" if has(pdf, "$402.00") and has(pdf, "$5.00") and has(pdf, "$20.00") else "missing", "yes")
check("a payslip has signature lines", "yes" if has(pdf, "Employee signature") else "missing", "yes")
voided = runs_by_no["PRN-00002"] if "PRN-00002" in runs_by_no else None
if voided:
    code, h, body = fetch(f"/api/pdf/payroll/{voided}", "finance")
    check("a voided run has no payslips", f"{code} {body.decode()}", "409 PRN-00002 was voided")

# ---------- subcontract certificate ----------
code, h, pdf = fetch(f"/api/pdf/certificate/{cert_ids[0]}", "finance")
check("a payment certificate PDF is returned", f"{code} {h.get('content-type')}", "200 application/pdf")
check("it shows the working: work to date, previous, this certificate, retention, net", "yes" if all(has(pdf, s) for s in ["Value of work done to date", "previously certified", "Value of work in this certificate", "retention withheld", "NET PAYABLE NOW"]) else "missing", "yes")
check("it shows the contract value including variations", "yes" if has(pdf, "Revised contract value") and has(pdf, "Variation") else "missing", "yes")
check("it has three signature lines", "yes" if has(pdf, "Prepared by") and has(pdf, "Approved by") and has(pdf, "Subcontractor") else "missing", "yes")

# ---------- who may open what ----------
f = lambda kind, i, who=None: fetch(f"/api/pdf/{kind}/{i}", who)[0]
check("someone not signed in gets 401", str(f("invoice", inv_id)), "401")
check("a viewer can open an invoice", str(f("invoice", inv_id, "viewer")), "200")
check("a viewer can open a project statement", str(f("project", p1, "viewer")), "200")
check("a viewer cannot open payslips", str(f("payroll", paid_run, "viewer")), "403")
check("HR can open payslips", str(f("payroll", paid_run, "hr")), "200")
check("HR cannot open an invoice", str(f("invoice", inv_id, "hr")), "403")
check("a site supervisor cannot open an invoice", str(f("invoice", inv_id, "site")), "403")
check("a site supervisor cannot open a certificate", str(f("certificate", cert_ids[0], "site")), "403")
check("an unknown kind of document is 404", str(f("secret", inv_id, "finance")), "404")
check("a prototype-pollution style kind is 404", str(f("__proto__", inv_id, "finance")), "404")
check("an unknown id is 404", str(f("invoice", "doesnotexist123", "finance")), "404")
check("the download link sets an attachment", fetch(f"/api/pdf/invoice/{inv_id}?download=1", "finance")[1].get("content-disposition", ""), "attachment")

print("\n" + ("%d FAILED" % failed if failed else "all passed"))
sys.exit(1 if failed else 0)
