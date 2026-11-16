export type LaunchRehearsalJob = {
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type LaunchRehearsalAction = {
  status: string;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
};

export const launchRehearsalSource = "ops_launch_rehearsal";

export function isLaunchRehearsalJob(job: LaunchRehearsalJob) {
  return (
    job.payload.source === launchRehearsalSource ||
    job.payload.trigger === launchRehearsalSource ||
    job.result.ops_launch_rehearsal === true
  );
}

export function hasSucceededLaunchRehearsalJob(jobs: LaunchRehearsalJob[]) {
  return jobs.some(
    (job) => isLaunchRehearsalJob(job) && job.status === "succeeded",
  );
}

export function isClosedLaunchRehearsalAction(action: LaunchRehearsalAction) {
  return (
    action.status === "done" &&
    (action.source === launchRehearsalSource ||
      action.metadata?.created_from === launchRehearsalSource ||
      action.metadata?.closed_from === launchRehearsalSource ||
      action.metadata?.rehearsal === true)
  );
}

export function hasClosedLaunchRehearsalAction(
  actions: LaunchRehearsalAction[],
) {
  return actions.some(isClosedLaunchRehearsalAction);
}
