/**
 * Configured ticket progression — a team's canonical ordered workflow, e.g.
 *   ["Ready for Developer", "In Development", "In Review", "Ready for Test"]
 *
 * "Manual advance" steps a ticket one stage forward along this list. The logic
 * is tracker-agnostic: it works on status *names*, and the adapter's
 * updateStatus() is responsible for translating a target name into whatever
 * mechanism the tracker uses (a Jira transition, a Linear state id, etc.).
 */

/** Case-insensitive, whitespace-tolerant status name comparison. */
function statusEquals(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Given the current status name and the configured progression, return the next
 * stage's name, or null when there is no next stage to advance to:
 * - empty progression
 * - current status is not in the progression (position unknown)
 * - current status is already the last stage
 */
export function nextStatusInProgression(
  current: string | undefined,
  progression: string[] | undefined,
): string | null {
  if (!progression || progression.length === 0) return null;
  if (!current) return null;
  const idx = progression.findIndex((s) => statusEquals(s, current));
  if (idx < 0) return null;
  if (idx >= progression.length - 1) return null;
  return progression[idx + 1];
}
