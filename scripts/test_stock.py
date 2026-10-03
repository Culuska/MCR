"""Exercises the materials and purchasing rules by submitting the real forms over HTTP.
Needs tokens for store and finance in $TOKEN_DIR (see scripts/session-cookie.ts).
Creates test records, all marked "(sample)". To restore a clean state run scripts/reset-materials-sample.ts, then prisma/seed-materials.ts.

Some refusals cannot show their message: a role that is not allowed to do something never sees that form, so the
page that comes back has nowhere to print it. Those checks look at the effect instead: the data did not change.
"""
import datetime, os, re, sys
d = os.environ["TOKEN_DIR"]
sys.argv = [sys.argv[0], f"{d}/store.tok"]
from form_test import as_user, get, options, submit

STORE, FIN = f"{d}/store.tok", f"{d}/finance.tok"
today = datetime.date.today().isoformat()
failed = 0


def check(name, got, expect):
    global failed
    ok = expect in got
    failed += 0 if ok else 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       got: {got}"))


def rows(page):
    return re.findall(r"<tr.*?</tr>", page, flags=re.S)


def plain(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))


def stock_row(name):
    """The stock-table row for a material, as plain text."""
    r = next((r for r in rows(get("/materials?tab=stock")) if name in r and "Edit" in r), None)
    return plain(r) if r else "(no row)"


as_user(STORE)
stock = "/materials?tab=stock"
page = get(stock)
proj = {t.split(" ")[0]: v for v, t in options(page, "projectId") if v}
mat = {t.split(" (")[0]: v for v, t in options(page, "materialId") if v}
print("projects:", list(proj))
P1, P2 = proj["MCR-2026-01"], proj["MCR-2026-02"]

# ---------- using stock ----------
issue = lambda m, q, p=P1: submit(stock, "projectId", dict(materialId=mat[m], projectId=p, quantity=q, date=today, note="test"))
check("cannot use more than is in stock", issue("Portland cement 50kg", "91"), "in stock")
check("cannot use zero", issue("Portland cement 50kg", "0"), "more than zero")
check("using stock charges the project at average cost (10 bags x 8.3875)", issue("Portland cement 50kg", "10"), "cost $83.88")

# ---------- materials list ----------
add = lambda **v: submit(stock, "category", dict(reorderLevel="0", **v))
check("a material that already exists is refused", add(name="Sharp sand (sample)", category="Sand", unit="tonne"), "already in the list")
add(name="Test Mortar (sample)", category="Cement", unit="bag")
add(name="Test Bricks (sample)", category="Blocks", unit="piece")
mat = {t.split(" (")[0]: v for v, t in options(get(stock), "adj-materialId", by="id") if v}
check("two new materials are added", "yes" if "Test Mortar" in mat and "Test Bricks" in mat else "missing", "yes")

# ---------- corrections ----------
adj = lambda m, c: submit(stock, "change", dict(materialId=mat[m], change=c, date=today, reason="test count"))
check("a zero correction is refused", adj("Portland cement 50kg", "0"), "cannot be zero")
check("a write-off bigger than the stock is refused", adj("Portland cement 50kg", "-999"), "below zero")
check("a small write-off is accepted", adj("Portland cement 50kg", "-5"), "adjusted by -5")
check("a correction worth over $500 needs finance", adj("Rebar 12mm", "1"), "needs finance staff")

# ---------- role limit: opening stock is finance only (checked by effect) ----------
submit(stock, "unitCost", dict(materialId=mat["Test Mortar"], quantity="5", unitCost="6", date=today), page_as=FIN)
check("opening stock entered by the storekeeper is not applied", stock_row("Test Mortar"), " 0 bag")

# ---------- purchase orders ----------
orders = "/materials?tab=orders"
opage = get(orders)
supplier = next(v for v, t in options(opage, "supplierId") if "Cement" in t)
mtest = {t.split(" (")[0]: v for v, t in options(opage, "m_0") if v}
blank = {f"{k}_{i}": "" for i in range(6) for k in "mqp"}
po = lambda **v: submit(orders, "m_0", dict(supplierId=supplier, projectId="", orderDate=today, expectedDate="", notes="", **{**blank, **v}))
check("an order with no lines is refused", po(), "at least one material")
check("a line with no quantity is refused", po(m_0=mtest["Test Mortar"], p_0="6.5"), "quantity above zero")
check("the same material twice is refused", po(m_0=mtest["Test Mortar"], q_0="10", p_0="6", m_1=mtest["Test Mortar"], q_1="5", p_1="6"), "already on this order")
po(m_0=mtest["Test Mortar"], q_0="100", p_0="6.5", m_1=mtest["Test Bricks"], q_1="200", p_1="0.6")
opage = get(orders)
po_id = re.search(r'href="/materials/orders/([^"]*)"', next(r for r in rows(opage) if "Draft" in r)).group(1)
check("a valid order is saved as a draft", "yes" if po_id else "no", "yes")

detail = f"/materials/orders/{po_id}"
seeded = re.search(r'href="/materials/orders/([^"]*)"', next(r for r in rows(opage) if "PO-00003" in r)).group(1)
check("goods cannot be received on an order that was never sent",
      submit(f"/materials/orders/{seeded}", "invoiceNumber", dict(orderId=po_id, receivedDate=today, invoiceNumber="X-1")), "Mark it as ordered")
submit(detail, "to", dict(id=po_id, to="ORDER"), contains='value="ORDER"')
line_ids = re.findall(r'name="r_([a-z0-9]+)"', get(detail))
check("the order now accepts a delivery", "yes" if len(line_ids) == 2 else f"{len(line_ids)} receive fields", "yes")
bricks_line, mortar_line = line_ids  # the page lists lines by material name: Bricks, then Mortar
recv = lambda inv, **q: submit(detail, "invoiceNumber", dict(orderId=po_id, receivedDate=today, invoiceNumber=inv, **q))
check("receiving more than is due is refused", recv("TEST-INV-1", **{f"r_{mortar_line}": "101"}), "only 100")
check("a delivery with no quantities is refused", recv("TEST-INV-1"), "at least one line")
check("a partial delivery is received and a draft bill raised", recv("TEST-INV-1", **{f"r_{mortar_line}": "60"}), "Draft bill EXP-")
check("the same supplier invoice cannot be booked twice", recv("TEST-INV-1", **{f"r_{mortar_line}": "10"}), "already recorded on GRN-")
recv("TEST-INV-2", **{f"r_{mortar_line}": "40", f"r_{bricks_line}": "200"})  # completes the order, so the form disappears
check("the order is now fully received", "yes" if "Received" in plain(get(detail)) and "Record a delivery" not in plain(get(detail)) else "not received", "yes")
check("mortar on hand is 100 after both deliveries", stock_row("Test Mortar"), " 100 bag")
check("bricks on hand is 200", stock_row("Test Bricks"), " 200 piece")

# ---------- reversing a delivery ----------
issue("Test Mortar", "45")
check("using 45 bags leaves 55", stock_row("Test Mortar"), " 55 bag")
as_user(FIN)
grn = {}
for r in rows(get(detail)):
    inv = re.search(r"(TEST-INV-\d)", r)
    rid = re.search(r'name="id" value="([^"]*)"', r)
    if inv and rid:
        grn[inv.group(1)] = rid.group(1)
as_user(STORE)
check("both deliveries have a Reverse button for finance", "yes" if len(grn) == 2 else f"found {list(grn)}", "yes")
submit(detail, "to", dict(id=grn["TEST-INV-2"], to="REVERSE", reason="test"), contains='value="REVERSE"', page_as=FIN)
check("a storekeeper's attempt to reverse a delivery is not applied", stock_row("Test Bricks"), " 200 piece")
as_user(FIN)
check("a delivery whose stock was partly used cannot be reversed (60 received, 55 left)",
      submit(detail, "to", dict(id=grn["TEST-INV-1"], to="REVERSE", reason="test reversal"), contains='value="REVERSE"'), "already been used")
submit(detail, "to", dict(id=grn["TEST-INV-2"], to="REVERSE", reason="test reversal"), contains='value="REVERSE"')
check("a clean delivery is reversed: bricks go back to zero", stock_row("Test Bricks"), " 0 piece")
check("reversal takes back the mortar from that delivery (55 - 40 = 15)", stock_row("Test Mortar"), " 15 bag")
check("the order is part-received again", "yes" if "Part received" in plain(get(detail)) else plain(get(detail))[:200], "yes")

# ---------- supplier bills ----------
bill = next(re.search(r'href="/expenses/([^"]*)"', r).group(1) for r in rows(get(detail)) if "TEST-INV-1" in r)
check("a stock bill cannot be entered by hand",
      submit("/expenses/new", "description", dict(date=today, amount="10", category="STOCK_PURCHASE", projectId="", supplierId="", assetId="", payee="x", paymentMethod="", description="manual stock bill", notes="")), "raised by receiving goods")
as_user(STORE)
submit(f"/expenses/{bill}", "to", dict(id=bill, to="SUBMIT"), contains='value="SUBMIT"')
as_user(FIN)
submit(f"/expenses/{bill}", "to", dict(id=bill, to="APPROVE"), contains='value="APPROVE"')  # the button disappears once it works
check("finance approves the supplier bill", "yes" if "Approved" in plain(get(f"/expenses/{bill}")) else "not approved", "yes")
as_user(FIN)
check("an approved stock bill cannot be voided as an ordinary expense",
      submit(f"/expenses/{bill}", "to", dict(id=bill, to="VOID", reason="test"), contains='value="VOID"'), "Reverse the goods receipt")

# ---------- voiding an issue ----------
mv = get("/materials?tab=movements")
issue_row = next(r for r in rows(mv) if "Test Mortar" in r and "Issue" in r and 'value="VOID"' in r)
mid = re.search(r'name="id" value="([^"]*)"', issue_row).group(1)
as_user(STORE)
submit("/materials?tab=movements", "to", dict(id=mid, to="VOID", reason="test"), contains='value="VOID"', page_as=FIN)
check("a storekeeper's attempt to void an issue is not applied", stock_row("Test Mortar"), " 15 bag")
as_user(FIN)
submit("/materials?tab=movements", "to", dict(id=mid, to="VOID", reason="entered in error"), contains=mid)
voided = next(r for r in rows(get("/materials?tab=movements")) if mid in r or ("Test Mortar" in r and "Issue" in r and "-45" in plain(r)))
check("finance voids the issue: it now shows as void", "yes" if "Void" in plain(voided) else plain(voided)[:150], "yes")
check("mortar is back to 60", stock_row("Test Mortar"), " 60 bag")

print("\n" + ("%d FAILED" % failed if failed else "all passed"))
sys.exit(1 if failed else 0)
