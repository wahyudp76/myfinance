import { initAuthClient, createAuthLifecycle } from "../auth/index.js";
import { createBootstrapLoader } from "./loader.js";

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
  let activeGeneration = 0;

  const loader = createBootstrapLoader(loadData);

  return {
    async start() {
      if (started) return;
      started = true;

      try {
        initAuthClient(supabaseConfig);

        lifecycle = createAuthLifecycle({
          onAuthenticated: async ({ session, user }) => {
            const generation = loader.getGeneration() + 1;
            activeGeneration = generation;

            await loader.load({ session, user, generation });
            if (!started || generation !== activeGeneration) return;

            await initializeUi({ session, user, generation });
            if (!started || generation !== activeGeneration) return;

            showApp({ session, user });
          },
          onUnauthenticated: async () => {
            activeGeneration = loader.getGeneration() + 1;
            loader.invalidate();
            showLogin();
          },
          onError: (error) => {
            if (started) showError(error);
          },
        });

        await lifecycle.start();
      } catch (error) {
        if (started) showError(error);
      }
    },

    stop() {
      started = false;
      activeGeneration += 1;
      loader.invalidate();
      lifecycle?.stop();
      lifecycle = null;
    },
  };
}
