/** Save editors one at a time: map and event saves may write the same RXDATA. */
export interface SaveJob {
  id: string;
  save: () => Promise<void>;
}

export async function saveSequentially(jobs: readonly SaveJob[]): Promise<void> {
  const failures: string[] = [];
  for (const job of jobs) {
    try {
      console.info("[save-all] editor started", job.id);
      await job.save();
      console.info("[save-all] editor completed", job.id);
    } catch (error) {
      console.warn("[save-all] editor failed", job.id, String(error));
      failures.push(`${job.id}: ${String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Failed to save ${failures.length} editor(s): ${failures.join('; ')}`);
  }
}
