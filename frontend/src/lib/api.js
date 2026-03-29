const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000"

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

export const api = {
  get:    (path)         => request(path),
  post:   (path, body)   => request(path, { method: "POST",   headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  delete: (path)         => request(path, { method: "DELETE" }),
}
