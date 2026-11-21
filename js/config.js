// Isi dua nilai ini dari Supabase: Project Settings > API
// Pakai anon / publishable key saja. JANGAN PERNAH pakai service_role key.
export const SUPABASE_URL = 'https://klwlsjgsurnxbylaityq.supabase.co/';
export const SUPABASE_ANON_KEY = 'sb_publishable_Py9PfmGpU8qQUU6I9A8slw_Rd1vK6nh';

export const isConfigured = () =>
  !SUPABASE_URL.startsWith('YOUR_') &&
  !SUPABASE_ANON_KEY.startsWith('YOUR_') &&
  /^https?:\/\//.test(SUPABASE_URL);
