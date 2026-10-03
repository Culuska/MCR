"""Exercises the site operations rules by submitting the real forms over HTTP.
Needs tokens for site, pm, admin and finance in $TOKEN_DIR (see scripts/session-cookie.ts).
Creates test records. To restore clean sample data run scripts/reset-operations-sample.ts then prisma/seed-operations.ts.

Where a role cannot see a form, or a successful change removes it, the message has nowhere to print.
Those checks look at the effect instead.
"""
import datetime, os, re, sys
d = os.environ["TOKEN_DIR"]
sys.argv = [sys.argv[0], f"{d}/site.tok"]
from form_test import as_user, get, options, submit

SITE, PM, ADMIN, FIN = (f"{d}/{n}.tok" for n in ("site", "pm", "admin", "finance"))
today = datetime.date.today().isoformat()
tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
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


TASKS = "/operations?tab=tasks"


def task_row(title):
    return next((r for r in rows(get(TASKS)) if title in r), "")


def task_id(title):
    return re.search(r'name="id" value="([^"]*)"', task_row(title)).group(1)


as_user(SITE)
page = get(TASKS)
proj = {t.split(" ")[0]: v for v, t in options(page, "projectId") if v}
P1, P2, P3 = proj["MCR-2026-01"], proj["MCR-2026-02"], proj["MCR-2026-03"]

# ---------- tasks ----------
def new(**v):
    data = dict(projectId=P1, assigneeId="", priority="MEDIUM", startDate="", description="", notes="", estimatedCost="")
    data.update(v)
    return submit(TASKS, "estimatedCost", data)
check("a due date before the start is refused", new(title="Test task", startDate="2026-10-10", dueDate="2026-10-01"), "cannot be before the start")
new(title="Test task alpha", dueDate="2026-12-01")
check("a valid task is added", "yes" if "Test task alpha" in plain(get(TASKS)) else "missing", "yes")
alpha = task_id("Test task alpha")

prog = lambda tid, pct: submit(TASKS, "completion", dict(id=tid, completion=pct, note=""), contains=f'value="{tid}"')
roof = task_id("Roof structure and sheeting")
check("progress cannot go down (30% -> 20%)", prog(roof, "20"), "can only go up")
check("progress above 100 is refused", prog(roof, "101"), "0 to 100")
check("progress must be a whole number", prog(roof, "40.5"), "whole number")
prog(alpha, "40")
check("first progress starts the task", "In progress" if "In progress" in plain(task_row("Test task alpha")) else plain(task_row("Test task alpha"))[:150], "In progress")
prog(alpha, "100")
check("100% marks the task done", "Done" if "Done" in plain(task_row("Test task alpha")) else "not done", "Done")
check("a finished task has no progress box", "yes" if 'name="completion"' not in task_row("Test task alpha") else "still editable", "yes")

state = lambda tid, to, reason="": submit(TASKS, "to", dict(id=tid, to=to, reason=reason), contains=f'value="{tid}"')
beta_new = new(title="Test task beta", dueDate="2026-12-05")
beta = task_id("Test task beta")
check("blocking a task needs a reason", state(beta, "BLOCK", ""), "what is blocking")
state(beta, "BLOCK", "Waiting for approval of the drawings")
check("a blocked task shows as blocked", "Blocked" if "Blocked" in plain(task_row("Test task beta")) else "no", "Blocked")
state(beta, "UNBLOCK")
check("unblocking puts it back to waiting", "To do" if "To do" in plain(task_row("Test task beta")) else plain(task_row("Test task beta"))[:150], "To do")
check("cancelling needs a reason", state(beta, "CANCEL", ""), "why it is being cancelled")
state(beta, "CANCEL", "Scope removed")
state(task_id("Test task beta"), "REOPEN")
check("reopening a cancelled task puts it back to waiting", "To do" if "To do" in plain(task_row("Test task beta")) else plain(task_row("Test task beta"))[:150], "To do")
state(alpha, "REOPEN", "Defect found")
after = plain(task_row("Test task alpha"))
check("reopening a finished task puts it back in progress", "yes" if "In progress" in after and "Done" not in after else after[:150], "yes")

# ---------- site reports ----------
def rep(p, path_project=None, **v):
    data = dict(projectId=p, date=today, weather="", planNext="", notes="")
    data.update({f"{k}_{i}": "" for i in range(3) for k in ("ik", "id", "dl")})
    data.update(v)
    return submit(f"/operations/reports/new?project={path_project or p}", "workDone", data)
check("a report for a future date is refused", rep(P1, date=tomorrow, workDone="Worked on the building today"), "future date")
check("a report with too little detail is refused", rep(P1, workDone="Work"), "sentence or two")
check("a report for a project that is not active is refused", rep(P3, path_project=P1, workDone="Nothing happened on the building today"), "planning")
check("progress that goes backwards stops the whole report", rep(P1, workDone="Worked on the roof structure today", **{f"t_{roof}": "20"}), "can only go up")
reports = lambda: plain(get("/operations?tab=reports"))
check("so no report was saved", "yes" if "Worked on the roof structure today" not in reports() else "saved anyway", "yes")
# the form hides itself when a report exists, so borrow the form for a project/day that is free and aim it at an existing day
free = f"/operations/reports/new?project={P1}"
existing_day = next(re.search(r"(\d{1,2} \w{3} 2026)", plain(r)).group(1) for r in rows(get("/operations?tab=reports")) if "MCR-2026-01" in r)
iso_existing = datetime.datetime.strptime(existing_day.replace("Sept", "Sep"), "%d %b %Y").date().isoformat()
check("a second report for the same project and day is refused",
      submit(free, "workDone", dict(projectId=P1, date=iso_existing, workDone="A second report for the same day", **{f"{k}_{i}": "" for i in range(3) for k in ("ik", "id", "dl")})), "already a report")

rep(P1, workDone="Roof trusses lifted, bays 4 to 6 complete", weather="Clear and hot", **{f"t_{roof}": "45", "ik_0": "DELAY", "id_0": "Crane arrived two hours late", "dl_0": "0.5"})
roof_row = task_row("Roof structure and sheeting")
check("the task moved to 45%", "yes" if re.search(r'name="completion"[^>]*value="45"|value="45"[^>]*name="completion"', roof_row) or 'aria-label="45 percent"' in roof_row else plain(roof_row)[:150], "yes")
check("the report is listed", "yes" if "Roof trusses lifted, bays 4 to 6" in reports() else "missing", "yes")
check("the issue raised in the report is listed", "yes" if "Crane arrived two hours late" in plain(get("/operations?tab=issues")) else "missing", "yes")

# ---------- review ----------
rid = re.search(r'href="/operations/reports/([a-z0-9]+)"', next(r for r in rows(get("/operations?tab=reports")) if "Roof trusses lifted" in r)).group(1)
as_user(SITE)
submit(f"/operations/reports/{rid}", "to", dict(id=rid, to="REVIEW"), contains='value="REVIEW"', page_as=PM)
check("the site supervisor's attempt to review is not applied", "yes" if "Reviewed by" not in plain(get(f"/operations/reports/{rid}")) else "reviewed", "yes")
as_user(PM)
submit(f"/operations/reports/{rid}", "to", dict(id=rid, to="REVIEW"), contains='value="REVIEW"')
check("a project manager reviews it", "yes" if "Reviewed by" in plain(get(f"/operations/reports/{rid}")) else "not reviewed", "yes")

# the project manager files one and then cannot review it
as_user(PM)
rep(P2, workDone="Culvert pipes laid between chainage 160 and 200")
rid2 = re.search(r'href="/operations/reports/([a-z0-9]+)"', next(r for r in rows(get("/operations?tab=reports")) if "Culvert pipes laid between chainage 160" in r)).group(1)
check("a manager cannot review a report they wrote", submit(f"/operations/reports/{rid2}", "to", dict(id=rid2, to="REVIEW"), contains='value="REVIEW"'), "someone else has to review")

# ---------- issues ----------
as_user(SITE)
def iss(**v):
    data = dict(projectId=P1, taskId="", date=today, kind="DELAY")
    data.update(v)
    return submit("/operations?tab=issues", "daysLost", data)
check("more than 60 days lost is refused", iss(description="A very long delay indeed", daysLost="61"), "more than 60")
check("an issue dated in the future is refused", iss(description="Something that has not happened", daysLost="1", date=tomorrow), "future")
check("a task from another project is refused", iss(description="Wrong project task", daysLost="1", taskId=task_id("Culverts and pipe laying")), "not on this project")
iss(description="Generator failed, test issue", daysLost="1")
irow = next(r for r in rows(get("/operations?tab=issues")) if "Generator failed, test issue" in r)
iid = re.search(r'name="id" value="([^"]*)"', irow).group(1)
check("resolving needs an explanation", submit("/operations?tab=issues", "to", dict(id=iid, to="RESOLVE", reason="ok"), contains=f'value="{iid}"'), "how it was resolved")
submit("/operations?tab=issues", "to", dict(id=iid, to="RESOLVE", reason="Generator repaired on site"), contains=f'value="{iid}"')
check("a resolved issue shows its resolution", "yes" if "Generator repaired on site" in plain(get("/operations?tab=issues")) else "missing", "yes")

# ---------- costs tagged to tasks ----------
as_user(PM)
culvert = task_id("Culverts and pipe laying")
check("a cost cannot be tagged to a task on another project",
      submit("/expenses/new", "description", dict(date=today, amount="25", projectId=P1, category="MATERIALS", supplierId="", assetId="", taskId=culvert, payee="x", paymentMethod="", description="Test cost on the wrong task", notes="")), "same project as the task")

# ---------- alerts on the Overview ----------
as_user(FIN)
text = plain(get("/"))
check("the Overview warns about overdue tasks", "overdue" if re.search(r"task\w* (is|are) overdue", text) else "missing", "overdue")
check("the Overview warns about blocked tasks", "yes" if re.search(r"MCR-2026-0\d: \d task\w* (is|are) blocked", text) else "missing", "yes")
check("the Overview warns about open delays", "yes" if re.search(r"open site issue", text) else "missing", "yes")

print("\n" + ("%d FAILED" % failed if failed else "all passed"))
sys.exit(1 if failed else 0)
