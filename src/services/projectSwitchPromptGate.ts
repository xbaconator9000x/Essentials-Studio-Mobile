/** Reject overlapping project-switch prompts without cancelling the first request.
 * The lease covers the confirmation/Save All phase only; the project loader
 * already has its own generation-based cancellation coordinator. */
export class ProjectSwitchPromptGate {
  private pending = false;

  async confirm(callback: () => Promise<boolean>): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    try {
      return await callback();
    } finally {
      this.pending = false;
    }
  }
}
