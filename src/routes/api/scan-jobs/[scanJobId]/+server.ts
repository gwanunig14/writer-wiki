import { error, json } from "@sveltejs/kit";
import { getScanJob } from "$lib/server/db/repositories/scan-repository";

export async function GET({ params }) {
  const scanJob = getScanJob(params.scanJobId);
  if (!scanJob) {
    throw error(404, "Scan job not found.");
  }

  return json({
    ...scanJob,
    summary: scanJob.summaryJson ? JSON.parse(scanJob.summaryJson) : null,
  });
}
