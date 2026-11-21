import { sb } from './supabase.js';

export async function getSession() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

export async function checkBendahara(session) {
  if (!sb || !session) return false;
  const { data, error } = await sb
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .maybeSingle();
  return !error && data?.role === 'bendahara';
}

export async function login(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function logout() {
  if (sb) await sb.auth.signOut();
}
