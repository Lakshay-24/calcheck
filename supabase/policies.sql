-- Run in Supabase SQL Editor if user profile creation fails on first login
CREATE POLICY "Users can insert own profile"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);
