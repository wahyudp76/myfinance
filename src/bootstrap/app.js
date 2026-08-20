import { initAuthClient, createAuthLifecycle } from "../auth/index.js";

export function createAppBootstrap({
  supabaseConfig,
  loadData = async () => {},
  initializeUi = async () => {},
  showLogin = () => {},
  showApp = () => {},
  showError = () => {},
} = {}) {
  let lifecycle;
  let started = false;

  return {
    async start() {
      if (started) return;
      started = true;

      try {
        initAuthClient(supabaseConfig);

        lifecycle = createAuthLifecycle({
          onAuthenticated: async ({ session, user }) => {
            await loadData({ session, user });
            await initializeUi({ session, user });
            showApp({ session, user });
          },
          onUnauthenticated: async () => {
            showLogin();
          },
          onError: (error) => {
            showError(error);
          },
        });

        await lifecycle.start();
      } catch (error) {
        showError(error);
      }
    },

    stop() {
      lifecycle?.stop();
      lifecycle = null;
      started = false;
    },
  };
}
