// Supabase client initialization
import { createClient } from '@supabase/supabase-js'
import { trackApiRequest } from './diagnostics'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage
  }
})

// Auth helper functions
export const signInWithGoogle = async () => {
  const { data, error } = await trackApiRequest('google sign in', () => supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  }))
  if (error) throw error
  return data
}

export const signOut = async () => {
  const { error } = await trackApiRequest('sign out', () => supabase.auth.signOut())
  if (error) throw error
}

export const getCurrentUser = async () => {
  const { data: { session } } = await trackApiRequest('auth session load', () => supabase.auth.getSession())
  return session?.user || null
}
