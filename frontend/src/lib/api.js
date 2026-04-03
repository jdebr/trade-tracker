import { supabase } from "@/lib/supabase"

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000"

async function request(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  // TODO: remove after confirming auth is working
  console.debug("[api] session present:", !!session, path)
  const headers = { ...(options.headers ?? {}) }
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  if (res.status === 401) {
    await supabase.auth.signOut()
    window.location.href = "/login"
    return
  }
  if (!res.ok) {
    const text = await res.text()
    console.error(`[api] ${options.method ?? "GET"} ${path} → ${res.status}`, text)
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

export const api = {
  get:    (path)         => request(path),
  post:   (path, body)   => request(path, { method: "POST",   headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  patch:  (path, body)   => request(path, { method: "PATCH",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
  delete: (path)         => request(path, { method: "DELETE" }),
}
