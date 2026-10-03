import "dotenv/config";
import { db } from "../src/lib/db";

// Removes the sample tasks, reports and issues (and the ones the tests create) so they can be reseeded.
// Only projects marked "(sample)" are touched. Anything on a real project is left alone.
// Nothing here is financial: the only link to money is an optional task tag on an expense, which is cleared.
async function main() {
  const sample = { project: { name: { contains: "(sample)" } } };
  const real = {
    tasks: await db.task.count({ where: { NOT: sample } }),
    reports: await db.siteReport.count({ where: { NOT: sample } }),
    issues: await db.siteIssue.count({ where: { NOT: sample } }),
  };
  const taskIds = (await db.task.findMany({ where: sample, select: { id: true } })).map((t) => t.id);
  const reportIds = (await db.siteReport.findMany({ where: sample, select: { id: true } })).map((r) => r.id);
  const issueIds = (await db.siteIssue.findMany({ where: sample, select: { id: true } })).map((i) => i.id);

  await db.$transaction(async (tx) => {
    await tx.expense.updateMany({ where: { taskId: { in: taskIds } }, data: { taskId: null } });
    await tx.reportTaskUpdate.deleteMany({ where: { reportId: { in: reportIds } } });
    await tx.siteIssue.deleteMany({ where: { id: { in: issueIds } } });
    await tx.siteReport.deleteMany({ where: { id: { in: reportIds } } });
    await tx.task.deleteMany({ where: { id: { in: taskIds } } });
    await tx.auditLog.deleteMany({ where: { entityId: { in: [...taskIds, ...reportIds, ...issueIds] } } });
    // Numbering restarts only if nothing real is left to collide with.
    if (!real.tasks && !real.issues) await tx.sequence.deleteMany({ where: { key: { in: ["TSK", "ISS"] } } });
  });
  console.log("removed sample", { tasks: taskIds.length, reports: reportIds.length, issues: issueIds.length }, "| left alone on real projects", real);
}
main().finally(() => db.$disconnect());
