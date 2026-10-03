import "dotenv/config";
import { db } from "../src/lib/db";
import { nextNumber } from "../src/lib/sequence";
import { previousWorkingDay } from "../src/lib/operations";
import type { Priority, TaskStatus } from "../src/generated/prisma/client";

// Phase 6 seed. Only runs when there are no tasks yet. Nothing here touches the ledger.

const day = (offset: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d; };

type T = { title: string; status: TaskStatus; done: number; start: number; due: number; est: number; pri?: Priority; who?: "foreman" | "engineer"; notes?: string };

const CLINIC: T[] = [
  { title: "Excavation and foundations", status: "DONE", done: 100, start: -100, due: -60, est: 18000, who: "foreman" },
  { title: "Ground floor slab", status: "DONE", done: 100, start: -62, due: -35, est: 22000, who: "foreman" },
  { title: "Block work to roof level", status: "IN_PROGRESS", done: 70, start: -40, due: -5, est: 30000, pri: "HIGH", who: "foreman" },
  { title: "Roof structure and sheeting", status: "IN_PROGRESS", done: 30, start: -6, due: 15, est: 28000, pri: "HIGH", who: "foreman" },
  { title: "Electrical first and second fix", status: "IN_PROGRESS", done: 80, start: -55, due: 5, est: 14000, who: "engineer", notes: "Carried out by the electrical subcontractor" },
  { title: "Internal plumbing and drainage", status: "BLOCKED", done: 10, start: -10, due: 10, est: 9000, pri: "URGENT", who: "engineer", notes: "2026-09-29: Blocked: waiting for the PVC pipe delivery" },
  { title: "Painting and finishes", status: "TODO", done: 0, start: 20, due: 45, est: 12000, pri: "LOW" },
];
const ROAD: T[] = [
  { title: "Site clearing and survey", status: "DONE", done: 100, start: -75, due: -50, est: 8000, who: "engineer" },
  { title: "Trenching for drainage", status: "DONE", done: 100, start: -50, due: -25, est: 35000, who: "foreman" },
  { title: "Culverts and pipe laying", status: "IN_PROGRESS", done: 55, start: -28, due: 12, est: 60000, pri: "URGENT", who: "foreman" },
  { title: "Base course placement", status: "IN_PROGRESS", done: 20, start: -12, due: -2, est: 90000, pri: "HIGH", who: "engineer" },
  { title: "Kerbs and channels", status: "TODO", done: 0, start: 15, due: 40, est: 40000 },
  { title: "Asphalt surfacing", status: "TODO", done: 0, start: 45, due: 75, est: 120000, pri: "LOW" },
];

async function main() {
  if ((await db.task.count()) > 0) { console.log("Tasks already exist. Sample site operations skipped."); return; }
  const site = await db.user.findFirstOrThrow({ where: { role: "SITE_SUPERVISOR" } });
  const pm = await db.user.findFirstOrThrow({ where: { role: "PROJECT_MANAGER" } });
  const p1 = await db.project.findUniqueOrThrow({ where: { code: "MCR-2026-01" } });
  const p2 = await db.project.findUniqueOrThrow({ where: { code: "MCR-2026-02" } });
  const foreman = await db.employee.findFirst({ where: { position: "Site foreman" } });
  const engineer = await db.employee.findFirst({ where: { position: "Site engineer" } });
  const assignee = (w?: "foreman" | "engineer") => (w === "foreman" ? foreman?.id : w === "engineer" ? engineer?.id : undefined) ?? null;

  async function tasks(projectId: string, list: T[]) {
    const made: Record<string, string> = {};
    for (const t of list) {
      const number = await db.$transaction((tx) => nextNumber(tx, "TSK"));
      const row = await db.task.create({ data: {
        number, projectId, title: t.title, status: t.status, completion: t.done, startDate: day(t.start), dueDate: day(t.due), estimatedCost: t.est,
        priority: t.pri ?? "MEDIUM", assigneeId: assignee(t.who), notes: t.notes ?? null, completedAt: t.status === "DONE" ? day(t.due - 2) : null, createdById: pm.id,
      } });
      made[t.title] = row.id;
    }
    return made;
  }
  const c = await tasks(p1.id, CLINIC);
  const r = await tasks(p2.id, ROAD);

  // Daily reports for the last working days. Roads is missing the most recent working day, so the alert has something to show.
  const lastWorking = previousWorkingDay(day(0)).getTime();
  const clinicText = ["Block work continued on the east and north walls. Two masons and four labourers on site.", "Roof timber delivered. Wall plate fixed on the north side.", "Electrical second fix started on the ground floor. Plastering inspection passed.", "Block work to window height on the west wall. Scaffold checked.", "Rain in the morning, work started at 10:00. East wall lintels cast.", "Roof trusses lifted into position, bays 1 to 3."];
  const roadText = ["Culvert pipes laid between chainage 120 and 160. Excavator on site all day.", "Bedding and backfill on the culvert run. Truck delivered 6 loads of aggregate.", "Base course levelled and compacted for the first 80 metres.", "Pipe joints tested and passed. Manhole 3 base cast.", "Excavator stopped at noon with a hydraulic leak. Trenching paused.", "Base course delivery delayed, crew moved to manhole work."];
  const weather = ["Clear and hot", "Clear and hot", "Cloudy", "Clear and hot", "Rain", "Dust"];
  const progress: Record<string, [number, number][]> = {
    [c["Block work to roof level"]]: [[-8, 55], [-6, 62], [-3, 70]], [c["Roof structure and sheeting"]]: [[-2, 15], [-1, 30]], [c["Electrical first and second fix"]]: [[-9, 70], [-4, 80]],
    [r["Culverts and pipe laying"]]: [[-9, 35], [-6, 45], [-2, 55]], [r["Base course placement"]]: [[-5, 10], [-3, 20]],
  };
  let reports = 0;
  for (let back = 8, i = 0; back >= 1; back--) {
    const d = day(-back);
    if (d.getUTCDay() === 5) continue;
    for (const [p, texts, taskIds] of [[p1, clinicText, Object.values(c)], [p2, roadText, Object.values(r)]] as const) {
      if (p.id === p2.id && d.getTime() === lastWorking) continue;
      const rep = await db.siteReport.create({ data: {
        projectId: p.id, date: d, weather: weather[i % weather.length], workDone: texts[i % texts.length], planNext: "Continue as programmed.", createdById: site.id,
        status: back > 3 ? "REVIEWED" : "SUBMITTED", reviewedById: back > 3 ? pm.id : null,
      } });
      for (const tid of taskIds) {
        const hit = progress[tid]?.find(([off]) => off === -back);
        if (hit) await db.reportTaskUpdate.create({ data: { reportId: rep.id, taskId: tid, completion: hit[1], note: null } });
      }
      reports++;
    }
    i++;
  }

  const issue = async (o: { project: string; task?: string; back: number; kind: "DELAY" | "SAFETY" | "MATERIAL_SHORTAGE" | "EQUIPMENT_BREAKDOWN" | "WEATHER"; text: string; days: number; resolved?: string }) => {
    const number = await db.$transaction((tx) => nextNumber(tx, "ISS"));
    await db.siteIssue.create({ data: { number, projectId: o.project, taskId: o.task ?? null, date: day(-o.back), kind: o.kind, description: o.text, daysLost: o.days, createdById: site.id,
      resolved: !!o.resolved, resolvedAt: o.resolved ? day(-o.back + 2) : null, resolution: o.resolved ?? null } });
  };
  await issue({ project: p1.id, task: c["Block work to roof level"], back: 22, kind: "MATERIAL_SHORTAGE", text: "Cement ran out, block work paused", days: 2, resolved: "Delivery of 500 bags received" });
  await issue({ project: p1.id, task: c["Internal plumbing and drainage"], back: 4, kind: "MATERIAL_SHORTAGE", text: "PVC pipes not delivered, plumbing cannot start", days: 3 });
  await issue({ project: p1.id, back: 15, kind: "SAFETY", text: "Near miss: a scaffold board slipped. Boards re-fixed and all scaffolds rechecked", days: 0, resolved: "Scaffold inspection done and recorded" });
  await issue({ project: p2.id, back: 30, kind: "WEATHER", text: "Heavy rain stopped trenching for a day and a half", days: 1.5, resolved: "Work resumed when the trench drained" });
  await issue({ project: p2.id, task: r["Culverts and pipe laying"], back: 3, kind: "EQUIPMENT_BREAKDOWN", text: "Excavator hydraulic leak, trenching paused", days: 2 });

  // Costs already in the books, now tied to the task they were for. This changes no amounts.
  const tag = (projectId: string, contains: string, taskId: string) => db.expense.updateMany({ where: { projectId, description: { contains }, status: { in: ["APPROVED", "PAID"] } }, data: { taskId } });
  await tag(p1.id, "Cement", c["Ground floor slab"]);
  await tag(p1.id, "Blocks", c["Block work to roof level"]);
  await tag(p2.id, "pipes", r["Culverts and pipe laying"]);
  await tag(p2.id, "Culverts", r["Culverts and pipe laying"]);
  await tag(p2.id, "Aggregates", r["Base course placement"]);

  console.log(`Added ${CLINIC.length + ROAD.length} sample tasks, ${reports} daily site reports and 5 site issues.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
