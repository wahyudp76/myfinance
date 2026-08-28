import { getAuthClient } from "./client.js";

export async function getSession() {
  const { data, error } = await getAuthClient().auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

export async function getCurrentUser() {
  const { data, error } = await getAuthClient().auth.getUser();
  if (error) throw error;
  return data.user ?? null;
}

export async function signIn(email, password) {
  const { data, error } = await getAuthClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  const { data, error } = await getAuthClient().auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await getAuthClient().auth.signOut();
  if (error) throw error;
}
