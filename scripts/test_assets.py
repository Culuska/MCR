import datetime, sys
import os
sys.argv = [sys.argv[0], os.environ['TOKEN_FILE']]
from form_test import get, options, submit

today = datetime.date.today().isoformat()
tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
failed = 0


def check(name, got, expect):
    global failed
    ok = expect in got
    failed += 0 if ok else 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       got: {got}"))


usage_page = get("/assets?tab=usage")
asset = {t.split(" (")[0]: v for v, t in options(usage_page, "assetId") if v}
project = {t: v for v, t in options(usage_page, "projectId") if v}
print("assets:", len(asset), "projects:", list(project))

base = dict(assetId=asset["Excavator 1"], date=today, trips="0", fuelLitres="50", operator="Test", purpose="Test")

# 1. A meter reading cannot go backwards.
check("reading lower than the last one is refused",
      submit("/assets?tab=usage", "startReading", {**base, "startReading": "10", "endReading": "20", "projectId": ""}),
      "last reading")
# 2. End below start.
check("end reading below start is refused",
      submit("/assets?tab=usage", "startReading", {**base, "startReading": "99990", "endReading": "99980", "projectId": ""}),
      "cannot be lower than the starting")
# 3. Wrong project for where the machine is assigned.
check("work on a project other than its assignment is refused",
      submit("/assets?tab=usage", "startReading", {**base, "startReading": "99990", "endReading": "99997", "projectId": project["MCR-2026-01"]}),
      "assigned to MCR-2026-02")
# 4. Future date.
check("future date is refused",
      submit("/assets?tab=usage", "startReading", {**base, "date": tomorrow, "startReading": "99990", "endReading": "99997", "projectId": ""}),
      "future date")
# 5. A valid entry works and takes the project from the assignment.
check("valid entry is saved using its assignment",
      submit("/assets?tab=usage", "startReading", {**base, "startReading": "99990", "endReading": "99997.5", "projectId": ""}),
      "7.5 hours logged")
# 6. Same entry twice.
dup = submit("/assets?tab=usage", "startReading", {**base, "startReading": "99990", "endReading": "99997.5", "projectId": ""})
check("entering the same day's work twice is refused", dup, "[ERROR]")

# 7. Assignment overlap.
detail = get("/assets/" + asset["Wheel Loader"])
check("assigning an asset that is already on another project is refused",
      submit("/assets/" + asset["Wheel Loader"], "startDate", {"assetId": asset["Wheel Loader"], "projectId": project["MCR-2026-02"], "startDate": today, "endDate": ""}),
      "already on MCR-2026-01")

# 8. Rentals.
rent = "/assets?tab=rentals"
rpage = get(rent)
supplier = next(v for v, t in options(rpage, "supplierId") if v)
common = dict(assetId=asset["Tipper Truck 2"], supplierId=supplier, projectId="", rateType="DAILY", rate="60", deposit="0", extraCharges="0")
check("hire ending before it starts is refused",
      submit(rent, "rateType", {**common, "startDate": tomorrow, "endDate": today}), "cannot end before it starts")
check("overlapping hire of the same asset is refused",
      submit(rent, "rateType", {**common, "startDate": tomorrow, "endDate": tomorrow}), "overlaps")
new_asset = {**common, "assetId": asset["Site Pickup"], "startDate": today, "endDate": tomorrow, "rate": "100", "extraCharges": "20", "deposit": "50"}
check("a valid hire is recorded with the right total (2 days x 100 + 20)",
      submit(rent, "rateType", new_asset), "total $220.00")

# 9. The hire cost becomes one draft expense, and only one.
import re
from form_test import forms
rpage = get(rent)
row = next(r for r in re.findall(r"<tr.*?</tr>", rpage, flags=re.S) if "Site Pickup" in r)
rid = re.search(r'name="id" value="([^"]*)"', row).group(1)
submit(rent, "to", {"id": rid, "to": "RAISE"}, contains=rid)
after = get(rent)
row_after = next(r for r in re.findall(r"<tr.*?</tr>", after, flags=re.S) if "Site Pickup" in r)
exp_link = re.search(r'href="/expenses/([^"]*)"', row_after)
check("raising the expense links a draft expense to the hire", "ok" if exp_link else "no expense link on the row", "ok")
exp_page = re.sub(r"<[^>]+>", " ", get("/expenses/" + exp_link.group(1))) if exp_link else ""
check("the expense is a draft for the hire total", "Draft" if "Draft" in exp_page and "$220.00" in exp_page else exp_page[:200], "Draft")
# The Raise button is gone for this hire now, so borrow another hire's form and aim it at this one.
rpage2 = get(rent)
other = re.search(r'name="id" value="([^"]*)"', next(r for r in re.findall(r"<tr.*?</tr>", rpage2, flags=re.S) if "Tipper Truck 2" in r and "Raise expense" in r)).group(1)
check("raising it a second time is refused",
      submit(rent, "to", {"id": rid, "to": "RAISE"}, contains=other), "already been raised")
check("cancelling a hire whose expense was raised is refused",
      submit(rent, "to", {"id": rid, "to": "CANCEL"}, contains='value="END"'), "Void that expense first")

# 10. Maintenance with a cost raises a draft expense, and an out-of-action asset cannot log work.
mp = "/assets?tab=maintenance"
check("service with a cost raises a draft expense",
      submit(mp, "description", {"assetId": asset["Generator 60 kVA"], "date": today, "kind": "REPAIR", "description": "Replaced fuel filter", "cost": "85", "projectId": "", "nextServiceDate": "", }),
      "draft expense was raised")
check("next service date must be after the work",
      submit(mp, "description", {"assetId": asset["Generator 60 kVA"], "date": today, "kind": "SERVICE", "description": "Routine", "cost": "0", "projectId": "", "nextServiceDate": "2020-01-01"}),
      "must be after")

print("\n" + ("%d FAILED" % failed if failed else "all passed"))
sys.exit(1 if failed else 0)
