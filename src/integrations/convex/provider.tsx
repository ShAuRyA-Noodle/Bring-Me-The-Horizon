import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'

const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL
if (!CONVEX_URL) {
  throw new Error(
    'Missing VITE_CONVEX_URL — run `bunx convex dev` to provision a deployment and populate .env.local'
  )
}

export const convex = new ConvexReactClient(CONVEX_URL, {
  unsavedChangesWarning: false,
})

export default function AppConvexProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
}
