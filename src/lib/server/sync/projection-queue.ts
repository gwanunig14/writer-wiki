export interface ProjectionJob {
  targetType: string;
  targetId: string;
  relativePath: string;
  content: string;
}

const jobs: ProjectionJob[] = [];

export function queueProjection(job: ProjectionJob) {
  jobs.push(job);
}

export function drainProjectionJobs() {
  return jobs.splice(0, jobs.length);
}
