"""Checks project-level access over HTTP. A Project Manager and a Site Supervisor assigned to project ZZ-A, and a Viewer
limited to ZZ-B, try to reach project ZZ-B (or ZZ-A) by every route: lists, direct URLs, downloads, reports and forged forms.
Needs $TOKEN_DIR with admin.tok. Local use only: it makes and removes ZZ test data (scripts/test-scope-data.ts).
"""
import json, os, re, subprocess, sys, urllib.error, urllib.request
d = os.environ["TOKEN_DIR"]
sys.argv = [sys.argv[0], f"{d}/admin.tok"]
import form_test as ft
from form_test import submit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
failed = 0


def check(name, got, expect):
    global failed
    ok = expect in got
    failed += 0 if ok else 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       got: {got[:300]}"))


def check_not(name, got, bad):
    global failed
    ok = bad not in got
    failed += 0 if ok else 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       found: {bad}"))


def sh(cmd):
    out = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True)
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else out.stderr[-300:]


def mint(email):
    return sh(f"npx tsx scripts/session-cookie.ts {email}")


def fetch(token, path):
    """Status, final address and body. Redirects are followed, so a refusal shows up as where you ended up."""
    req = urllib.request.Request(ft.BASE + path, headers={"Cookie": f"mcr_session={token}"})
    try:
        r = urllib.request.urlopen(req, timeout=120)
        return r.status, r.geturl().replace(ft.BASE, ""), r.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, path, e.read().decode("utf-8", "ignore")


ids = json.loads(sh("npx tsx scripts/test-scope-data.ts setup"))
ADMIN = open(f"{d}/admin.tok").read().strip()
PM, SITE, VIEW = mint("zz-pm@mcr.example"), mint("zz-site@mcr.example"), mint("zz-view@mcr.example")
page_as_admin = f"{d}/admin.tok"
open(f"{d}/pm.tok", "w").write(PM)
open(f"{d}/view.tok", "w").write(VIEW)


def as_(token):
    ft.TOKEN = token


try:
    # ---------- lists show only my projects ----------
    for who, token, mine, other in (("project manager", PM, "ZZ-A", "ZZ-B"), ("site supervisor", SITE, "ZZ-A", "ZZ-B"), ("limited viewer", VIEW, "ZZ-B", "ZZ-A")):
        m, o = mine[-1], other[-1]
        _, _, body = fetch(token, "/projects")
        check(f"{who}: the projects list has their project", body, f"ZZ-{m}")
        check_not(f"{who}: and not the other one", body, f"ZZ-{o}")
        _, _, body = fetch(token, "/expenses")
        check(f"{who}: expenses list has their expense", body, f"EXP-ZZ{m}1")
        check_not(f"{who}: and not the other project's", body, f"EXP-ZZ{o}1")
    _, _, body = fetch(ADMIN, "/projects")
    check("an administrator sees both projects", body, "ZZ-A")
    check("an administrator sees both projects (B)", body, "ZZ-B")

    # ---------- direct URLs (IDOR) ----------
    for what, path_a, path_b in (
        ("project page", f"/projects/{ids['pA']}", f"/projects/{ids['pB']}"),
        ("project edit page", f"/projects/{ids['pA']}/edit", f"/projects/{ids['pB']}/edit"),
        ("expense page", f"/expenses/{ids['expA']}", f"/expenses/{ids['expB']}"),
        ("subcontract page", f"/subcontracts/{ids['subA']}", f"/subcontracts/{ids['subB']}"),
        ("purchase order page", f"/materials/orders/{ids['poA']}", f"/materials/orders/{ids['poB']}"),
        ("site report page", f"/operations/reports/{ids['repA']}", f"/operations/reports/{ids['repB']}"),
    ):
        status, _, body = fetch(PM, path_a)
        check(f"project manager can open their {what}", str(status), "200")
        status, _, body = fetch(PM, path_b)
        check(f"project manager gets 404 for the other project's {what}", f"{status} {'could not be found' in body}", "404 True")
        status, url, body = fetch(SITE, path_b)
        check_not(f"site supervisor cannot see the other project's {what}", body, "ZZ-B")
        check_not(f"site supervisor sees no record of the other project in {what}", body, "ZZB")
    status, _, body = fetch(VIEW, f"/invoices/{ids['invA']}")
    check("limited viewer gets 404 for an invoice on another project", f"{status} {'could not be found' in body}", "404 True")
    status, _, body = fetch(VIEW, f"/invoices/{ids['invB']}")
    check("limited viewer can open an invoice on their project", str(status), "200")
    _, _, body = fetch(VIEW, "/invoices")
    check_not("limited viewer's invoice list has no other project's invoice", body, "INV-ZZA")
    check("limited viewer's invoice list has their own", body, "INV-ZZB")

    # ---------- operations, subcontracts, stock lists ----------
    _, _, body = fetch(PM, "/operations?tab=tasks")
    check("tasks: their own", body, "TSK-ZZA")
    check_not("tasks: not the other project's", body, "TSK-ZZB")
    _, _, body = fetch(PM, "/operations?tab=reports")
    check_not("site reports: not the other project's", body, "ZZ-B")
    _, _, body = fetch(PM, "/subcontracts")
    check("subcontracts: their own", body, "SUB-ZZA")
    check_not("subcontracts: not the other project's", body, "SUB-ZZB")
    _, _, body = fetch(PM, "/materials?tab=orders")
    check("purchase orders: their own", body, "PO-ZZA")
    check_not("purchase orders: not the other project's", body, "PO-ZZB")
    _, _, body = fetch(PM, "/customers")
    check_not("customer list totals leave out the other project", body, "ZZ-B")

    # ---------- dashboard and company-wide screens ----------
    _, _, body = fetch(PM, "/")
    check("the dashboard shows project figures", body, "Your projects")
    check_not("the dashboard hides company cash", body, "Cash and bank")
    check_not("the dashboard hides what we owe suppliers", body, "We owe suppliers")
    _, _, body = fetch(ADMIN, "/")
    check("an administrator still sees company cash", body, "Cash and bank")
    for page in ("/finance", "/finance?tab=balance", "/payroll", "/employees"):
        status, url, _ = fetch(PM, page)
        check(f"project manager is sent away from {page}", url, "/?denied=")
    status, url, _ = fetch(VIEW, "/finance")
    check("a limited viewer is sent away from the ledger", url, "/?denied=finance")
    status, url, _ = fetch(SITE, "/settings")
    check("a site supervisor cannot open settings", url, "/?denied=settings")

    # ---------- reports ----------
    _, _, body = fetch(PM, "/reports")
    check("the project manager's reports page offers project reports", body, "Expense report")
    check_not("it does not offer the trial balance", body, "Trial balance")
    check_not("or the balance sheet", body, "Balance sheet")
    for rep in ("trial-balance", "general-ledger", "balance-sheet", "profit-loss", "cash-flow", "receivables", "payments", "stock-valuation"):
        status, _, _ = fetch(PM, f"/api/reports/{rep}")
        check(f"company-wide report {rep} is refused", str(status), "403")
    status, _, csv = fetch(PM, "/api/reports/expenses")
    check("the expense report works", str(status), "200")
    check("it has their expense", csv, "EXP-ZZA1")
    check_not("it leaves out the other project's expense", csv, "EXP-ZZB1")
    status, _, _ = fetch(PM, f"/api/reports/expenses?project={ids['pB']}")
    check("asking the report for the other project is refused", str(status), "404")
    status, _, tasks = fetch(PM, "/api/reports/tasks")
    check_not("the task report leaves out the other project", tasks, "TSK-ZZB")
    status, _, prof = fetch(PM, "/api/reports/project-profitability")
    check_not("project profitability leaves out the other project", prof, "ZZ-B")
    check("the administrator's task report has both", fetch(ADMIN, "/api/reports/tasks")[2], "TSK-ZZB")

    # ---------- downloads ----------
    status, _, _ = fetch(PM, f"/api/pdf/project/{ids['pA']}")
    check("a statement for their project downloads", str(status), "200")
    status, _, _ = fetch(PM, f"/api/pdf/project/{ids['pB']}")
    check("a statement for the other project is 404", str(status), "404")
    status, _, _ = fetch(VIEW, f"/api/pdf/invoice/{ids['invA']}")
    check("another project's invoice PDF is 404", str(status), "404")
    status, _, _ = fetch(VIEW, f"/api/pdf/invoice/{ids['invB']}")
    check("their own invoice PDF downloads", str(status), "200")
    status, _, _ = fetch(PM, f"/api/files/{ids['attA']}")
    check("a file on their project's expense downloads", str(status), "200")
    status, _, _ = fetch(PM, f"/api/files/{ids['attB']}")
    check("a file on the other project's expense is 404", str(status), "404")
    status, _, _ = fetch(ADMIN, f"/api/files/{ids['attB']}")
    check("an administrator can open it", str(status), "200")

    # ---------- forged forms (what a browser would never send) ----------
    as_(PM)
    form_values = {"date": "2026-10-01", "amount": "5", "category": "OTHER", "description": "ZZ scope forged", "supplierId": "", "payee": "", "paymentMethod": "", "notes": ""}
    check("a forged expense on the other project is refused", submit("/expenses/new", "description", {**form_values, "projectId": ids["pB"]}), "do not have access to that project")
    check("an expense with no project is refused for them", submit("/expenses/new", "description", {**form_values, "projectId": ""}), "Choose the project")
    check_not("an expense on their own project is accepted", submit("/expenses/new", "description", {**form_values, "description": "ZZ scope own", "projectId": ids["pA"]}), "[ERROR]")
    # borrow a form from the administrator's page, post it as the project manager
    # the form is read from the administrator's page for expense B and posted to a page the project manager can open
    submit(f"/expenses/{ids['expB']}", "id", {"id": ids["expB"], "to": "SUBMIT"}, contains="Submit for approval", page_as=page_as_admin, post_path=f"/expenses/{ids['expA']}")
    state = json.loads(sh("npx tsx scripts/test-scope-data.ts state"))
    check("a forged submit of the other project's draft changed nothing", state["expB"], "DRAFT")
    as_(SITE)
    submit("/operations?tab=tasks", "id", {"id": ids["taskB"], "to": "BLOCK", "reason": "ZZ forged"}, contains="Block", page_as=page_as_admin)
    state = json.loads(sh("npx tsx scripts/test-scope-data.ts state"))
    check("a forged block of the other project's task changed nothing", state["taskB"], "TODO")
    as_(ADMIN)
    submit(f"/expenses/{ids['expB']}", "id", {"id": ids["expB"], "to": "SUBMIT"}, contains="Submit for approval")
    state = json.loads(sh("npx tsx scripts/test-scope-data.ts state"))
    check("the same request from an administrator works", state["expB"], "SUBMITTED")

    # ---------- giving access from Settings ----------
    as_(ADMIN)
    reply = submit("/settings?tab=people", "scope", {"id": ids["pm"], "scope": "ASSIGNED", "project": ids["pB"]}, contains=f'value="{ids["pm"]}"')
    check("an administrator can change who sees which project", reply, "Project access saved")
    _, _, body = fetch(PM, "/projects")
    check("the project manager now sees project B", body, "ZZ-B")
    check_not("and no longer project A", body, "ZZ-A")
    reply = submit("/settings?tab=people", "scope", {"id": ids["pm"], "scope": "ALL"}, contains=f'value="{ids["pm"]}"')
    _, _, body = fetch(PM, "/projects")
    check("giving all projects shows both", f"{'ZZ-A' in body} {'ZZ-B' in body}", "True True")
finally:
    print(sh("npx tsx scripts/test-scope-data.ts cleanup"))

print("\n" + ("%d FAILED" % failed if failed else "all passed"))
sys.exit(1 if failed else 0)
