'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [secret, setSecret] = useState('')
  const [err, setErr] = useState('')
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    if (res.ok) router.push('/')
    else setErr('Invalid secret')
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Capture Gap Console</h1>
        <p className="text-sm opacity-60">
          Study instrument — single owner. Enter the console secret (AUTH_SECRET) to continue.
        </p>
        <input
          type="password"
          autoFocus
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Auth secret"
          className="w-full rounded border px-3 py-3 text-base"
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="w-full rounded bg-black px-3 py-3 text-white dark:bg-white dark:text-black">
          Enter
        </button>
      </form>
    </main>
  )
}
