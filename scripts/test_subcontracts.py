"""Exercises the subcontract rules by submitting the real forms over HTTP.
Needs tokens for pm and finance in $TOKEN_DIR (see scripts/session-cookie.ts). Run scripts/check-subcontract-ledger.ts afterwards.
Creates a test subcontract. To restore clean sample data, delete it with scripts/reset-subcontracts-sample.ts and reseed.

A role that may not do something never sees that form, so the page that comes back has nowhere to print a refusal.
Those checks look at the effect instead: the record did not change.
"""
import datetime, os, re, sys
d = os.environ["TOKEN_DIR"]
sys.argv = [sys.argv[0], f"{d}/pm.tok"]
from form_test import as_user, get, options, submit

PM, FIN = f"{d}/pm.tok", f"{d}/finance.tok"
today = datetime.date.today().isoformat()
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


as_user(PM)
lst = "/subcontracts"
page = get(lst)
supplier = next(v for v, t in options(page, "supplierId") if "Painting" in t)
project = next(v for v, t in options(page, "projectId") if "MCR-2026-02" in t)


def sub_links(p):
    return dict((m.group(2), m.group(1)) for m in re.finditer(r'href="/subcontracts/([a-z0-9]+)"[^>]*>(?:<b>)?(SUB-\d+)', p))


existing = sub_links(get(lst))
print("existing subcontracts:", sorted(existing))
by_num = lambda n: existing[n]
sample_active = by_num("SUB-00002")     # drainage, active, has posted certificates
sample_done = by_num("SUB-00003")       # plastering, completed, retention held
sample_draft = by_num("SUB-00004")      # painting, draft

new = lambda **v: submit(lst, "retentionPct", dict(supplierId=supplier, projectId=project, scope="Test: finishes to the site offices", startDate="", endDate="", notes="", **v))
check("retention above 20% is refused", new(contractValue="50000", retentionPct="25"), "unusual")
new(contractValue="50000", retentionPct="5")
after = sub_links(get(lst))
fresh = [n for n in after if n not in existing]
check("a new subcontract is saved as a draft", "yes" if len(fresh) == 1 else f"found {fresh}", "yes")
SUB = after[fresh[0]]
page_of = f"/subcontracts/{SUB}"
print("test subcontract:", fresh[0])

# ---------- signing off ----------
submit(page_of, "to", dict(id=SUB, to="ACTIVATE"), contains='value="ACTIVATE"', page_as=FIN)
check("a project manager cannot sign off a subcontract", "Draft" if "Draft" in plain(get(page_of)) else "changed", "Draft")
as_user(FIN)
submit(page_of, "to", dict(id=SUB, to="ACTIVATE"), contains='value="ACTIVATE"')
check("finance signs it off", "Active" if "Active" in plain(get(page_of)) and "Sign off subcontract" not in plain(get(page_of)) else "not active", "Active")
as_user(PM)

# ---------- certificates ----------
cert = lambda to_date, on=None: submit(on or page_of, "workToDate", dict(subcontractId=on_id(on), workToDate=to_date, date=today, notes=""))
on_id = lambda on: SUB if on is None else on.rsplit("/", 1)[1]
check("a certificate for more than the contract is refused", cert("50000.01"), "cannot be more than the contract value")
check("a certificate on a draft subcontract is refused", submit(page_of, "workToDate", dict(subcontractId=sample_draft, workToDate="1000", date=today, notes="")), "Certificates are raised on active")
cert("20000")  # the form disappears once a draft exists, so the result is read from the page
text = plain(get(page_of))
check("a valid certificate is drafted with its gross, retention and net", "yes" if "CRT-" in text and "$19,000.00" in text and "$1,000.00" in text else text[:200], "yes")
check("a second certificate while one is in draft is refused",
      submit(f"/subcontracts/{by_num('SUB-00001')}", "workToDate", dict(subcontractId=SUB, workToDate="25000", date=today, notes="")), "already a draft")

# ---------- approval and the ledger ----------
as_user(FIN)
cert_row = next(r for r in rows(get(page_of)) if "CRT-" in r)
cert_id = re.search(r'name="id" value="([^"]*)"', cert_row).group(1)
as_user(PM)
submit(page_of, "to", dict(id=cert_id, to="APPROVE"), contains='value="APPROVE"', page_as=FIN)
check("a project manager's attempt to approve a certificate is not applied", "Draft" if "Draft" in plain(get(page_of)) else "approved", "Draft")
as_user(FIN)
submit(page_of, "to", dict(id=cert_id, to="APPROVE"), contains='value="APPROVE"')
text = plain(get(page_of))
check("finance approves the certificate", "yes" if "Approved" in text else text[:200], "yes")
check("the ledger took the full cost, the net payable and the retention", "yes" if all(s in text for s in ["5080", "2000", "2320"]) and "20,000.00" in text and "19,000.00" in text and "1,000.00" in text else "missing", "yes")
check("the held retention is shown", "yes" if re.search(r"Retention held \$1,000\.00", text) else "no", "yes")

# ---------- paying ----------
fpage = get("/finance?tab=ledger")
expense_acct = next(v for v, t in options(fpage, "account") if t.startswith("5080"))
check("paying from a non-cash account is refused",
      submit(page_of, "reference", dict(id=cert_id, date=today, accountId=expense_acct, method="BANK_TRANSFER", reference="x"), contains=cert_id), "cash or bank account")
bank = next(v for v, t in options(get(page_of), "accountId") if "Bank" in t)
submit(page_of, "reference", dict(id=cert_id, date=today, accountId=bank, method="BANK_TRANSFER", reference="TEST-PAY-1"), contains=cert_id)
check("paying an approved certificate marks it paid", "yes" if "Paid" in plain(get(page_of)) else "not paid", "yes")

# ---------- running total ----------
as_user(PM)
check("certifying the same total again is refused", cert("20000"), "already certified")
check("certifying less than before is refused", cert("15000"), "already certified")
cert("35000")
as_user(FIN)
c2_row = next(r for r in rows(get(page_of)) if "CRT-" in r and "Draft" in r)
c2 = re.search(r'name="id" value="([^"]*)"', c2_row).group(1)
submit(page_of, "to", dict(id=c2, to="APPROVE"), contains='value="APPROVE"')
check("the second certificate is approved", "yes" if plain(get(page_of)).count("Approved") >= 1 else "no", "yes")
check("an earlier certificate cannot be voided while a later one stands",
      submit(page_of, "to", dict(id=cert_id, to="VOID", reason="test"), contains='value="VOID"'), "Void the latest certificate first")
submit(page_of, "to", dict(id=c2, to="VOID", reason="test void"), contains='value="VOID"')
check("the latest certificate can be voided", "yes" if "Void" in plain(get(page_of)) else "no", "yes")
check("after the void the running total is back to 20,000", "yes" if re.search(r"Certified to date \$20,000\.00", plain(get(page_of))) else plain(get(page_of))[:200], "yes")

# ---------- variations ----------
as_user(PM)
check("a variation proposed by the project manager waits for finance",
      submit(page_of, "amount", dict(subcontractId=SUB, description="Extra works test", amount="10000")), "counts once finance approves")
as_user(FIN)
vrow = next(r for r in rows(get(page_of)) if "Extra works test" in r)
vid = re.search(r'name="id" value="([^"]*)"', vrow).group(1)
check("the contract value is unchanged until the variation is approved", "yes" if "$50,000.00" in plain(get(page_of)) else "changed", "yes")
submit(page_of, "to", dict(id=vid, to="APPROVE"), contains=vid)
check("approving it raises the contract value to 60,000", "yes" if re.search(r"Contract value \$60,000\.00", plain(get(page_of))) else "no", "yes")
as_user(PM)
submit(page_of, "amount", dict(subcontractId=SUB, description="Big omission test", amount="-45000"))
as_user(FIN)
orow = next(r for r in rows(get(page_of)) if "Big omission test" in r)
oid = re.search(r'name="id" value="([^"]*)"', orow).group(1)
check("a variation that takes the value below what is certified is refused",
      submit(page_of, "to", dict(id=oid, to="APPROVE"), contains=oid), "less than the 20000.00 already certified")
submit(page_of, "to", dict(id=oid, to="REJECT"), contains=oid)
check("a rejected variation leaves the variations table (it stays in the history)", "yes" if not any("Big omission test" in r for r in rows(get(page_of))) and "Big omission test" in plain(get(page_of)) else "wrong", "yes")
# finance proposes and then tries to approve its own
submit(page_of, "amount", dict(subcontractId=SUB, description="Own variation test", amount="100"))
srow = next(r for r in rows(get(page_of)) if "Own variation test" in r)
sid = re.search(r'name="id" value="([^"]*)"', srow).group(1)
check("whoever proposed a variation cannot approve it", submit(page_of, "to", dict(id=sid, to="APPROVE"), contains=sid), "someone else has to approve")

# ---------- programme ----------
ms = lambda desc, amt: submit(page_of, "dueDate", dict(subcontractId=SUB, description=desc, amount=amt, dueDate="2027-01-15"))
ms("Test milestone one", "40000")
check("a milestone is added", "yes" if "Test milestone one" in plain(get(page_of)) else "missing", "yes")
check("a programme larger than the contract is refused", ms("Test milestone two", "25000"), "more than the contract value")

# ---------- retention ----------
check("retention cannot be released before completion",
      submit(f"/subcontracts/{sample_done}", "reference", dict(subcontractId=SUB, amount="100", date=today, accountId=bank, method="BANK_TRANSFER", reference="x"), contains='name="subcontractId"'), "once the subcontract is complete")
submit(page_of, "to", dict(id=SUB, to="COMPLETE"), contains='value="COMPLETE"')
check("the subcontract is marked complete", "yes" if "Completed" in plain(get(page_of)) else "no", "yes")
rel = lambda amt, ref: submit(page_of, "reference", dict(subcontractId=SUB, amount=amt, date=today, accountId=bank, method="BANK_TRANSFER", reference=ref), contains='name="subcontractId"')
check("releasing more than is held is refused", rel("1000.01", "x"), "Only $1,000.00 of retention is held")
rel("400", "TEST-REL-1")
t = plain(get(page_of))
check("a release is recorded and the balance falls to 600", "yes" if "RET-" in t and re.search(r"Retention held \$600\.00", t) else t[:200], "yes")
rrow = next(r for r in rows(get(page_of)) if "RET-" in r and "TEST-REL-1" in r)
rid = re.search(r'name="id" value="([^"]*)"', rrow).group(1)
submit(page_of, "to", dict(id=rid, to="VOID", reason="test"), contains=rid)
check("voiding the release puts the retention back to 1,000", "yes" if re.search(r"Retention held \$1,000\.00", plain(get(page_of))) else "no", "yes")

# ---------- cancelling ----------
check("a subcontract with approved certificates cannot be cancelled",
      submit(f"/subcontracts/{sample_active}", "to", dict(id=sample_active, to="CANCEL", reason="test"), contains='value="CANCEL"'), "has approved payment certificates")

print("\n" + ("%d FAILED" % failed if failed else "all passed"))
sys.exit(1 if failed else 0)
