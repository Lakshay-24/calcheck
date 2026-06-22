alter table public.meal_logs
  add column if not exists image_path text,
  add column if not exists image_url text,
  add column if not exists thumbnail_path text,
  add column if not exists thumbnail_url text,
  add column if not exists image_width integer,
  add column if not exists image_height integer,
  add column if not exists image_size_bytes integer,
  add column if not exists image_content_type text,
  add column if not exists image_uploaded_at timestamptz,
  add column if not exists source text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-images', 'meal-images', true, 5242880, array['image/jpeg'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Meal images are publicly readable'
  ) then
    create policy "Meal images are publicly readable"
      on storage.objects for select
      using (bucket_id = 'meal-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can upload their own meal images'
  ) then
    create policy "Users can upload their own meal images"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'meal-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can update their own meal images'
  ) then
    create policy "Users can update their own meal images"
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'meal-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'meal-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
