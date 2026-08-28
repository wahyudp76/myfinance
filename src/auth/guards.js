import { getAuthClient } from "./client.js";

export function onAuthStateChange(callback) {
  const { data, error } = getAuthClient().auth.onAuthStateChange((event, session) => {
    callback({ event, session });
  });
  if (error) throw error;
  return () => data.subscription.unsubscribe();
}

export function requireUser(session) {
  if (!session?.user) throw new Error("Authentication required.");
  return session.user;
}
