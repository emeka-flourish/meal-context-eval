// Groups artifact ids by capture time: sorted ascending, an item joins the
// current group when it is within `windowMinutes` of the PREVIOUS item
// (rolling window — a chain A-B-C each 20min apart is one group).
// Items with no timestamp can't be placed; each becomes its own singleton
// group appended at the end. Pure function, no I/O.
export function clusterArtifacts(
  items: { id: string; takenAt: Date | null }[],
  windowMinutes = 30
): string[][] {
  const dated = items
    .filter((i): i is { id: string; takenAt: Date } => i.takenAt !== null)
    .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
  const undated = items.filter((i) => i.takenAt === null)

  const windowMs = windowMinutes * 60_000
  const groups: string[][] = []
  let current: string[] = []
  let prevTime = 0
  for (const item of dated) {
    const t = item.takenAt.getTime()
    if (current.length > 0 && t - prevTime > windowMs) {
      groups.push(current)
      current = []
    }
    current.push(item.id)
    prevTime = t
  }
  if (current.length > 0) groups.push(current)

  for (const item of undated) groups.push([item.id])
  return groups
}
