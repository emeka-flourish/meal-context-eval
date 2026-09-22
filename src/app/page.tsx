import { redirect } from 'next/navigation'

// The console opens on Intake (REBUILD-SPEC §3: calendar-scoped Intake is
// the first workflow). The old day list that lived here was replaced.
export default function Home() {
  redirect('/intake')
}
