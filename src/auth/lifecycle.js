import { getSession, getCurrentUser, onAuthStateChange } from "./index.js";

export function createAuthLifecycle({
  onAuthenticated = () => {},
  onUnauthenticated = () => {},
  onError = () => {},
} = {}) {
  let disposed = false;
  let unsubscribe = null;

  const handleSession = async (session) => {
    if (disposed) return;
    try {
      if (!session?.user) {
        await onUnauthenticated();
        return;
      }
      const user = await getCurrentUser();
      if (!disposed) await onAuthenticated({ session, user });
    } catch (error) {
      if (!disposed) onError(error);
    }
  };

  return {
    async start() {
      try {
        const session = await getSession();
        await handleSession(session);
        if (disposed) return;
        unsubscribe = onAuthStateChange(({ session }) => {
          void handleSession(session);
        });
      } catch (error) {
        if (!disposed) onError(error);
      }
    },
    stop() {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
