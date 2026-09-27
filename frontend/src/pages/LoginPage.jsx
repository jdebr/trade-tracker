import { useEffect, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import { Button } from "@/components/ui/button"
import { Field, TextInput } from "@/components/ui/form"

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname ?? "/"
  const { session } = useAuth()

  // Navigate once the session is confirmed in context (avoids race with onAuthStateChange)
  useEffect(() => {
    if (session) navigate(from, { replace: true })
  }, [session])

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
    // navigation handled by the useEffect above once session updates
  }

  async function handleGoogleLogin() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + from },
    })
    if (error) setError(error.message)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Swing Trader</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email" labelClassName="text-sm text-foreground">
            <TextInput
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="py-2"
            />
          </Field>

          <Field label="Password" labelClassName="text-sm text-foreground">
            <TextInput
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="py-2"
            />
          </Field>

          {error && (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleLogin}
        >
          Sign in with Google
        </Button>
      </div>
    </div>
  )
}
