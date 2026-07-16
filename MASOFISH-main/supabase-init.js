/**
 * MASOFISH — Shared Supabase client & auth helpers
 * ---------------------------------------------------------------
 * Loaded on every page (after the Supabase JS CDN script) so there is
 * a single source of truth for the project credentials and for the
 * "is someone logged in?" logic used to gate the rest of the site.
 * ---------------------------------------------------------------
 */

// Project credentials (safe to expose client-side — the publishable/anon
// key only grants what your Row Level Security policies allow).
const SUPABASE_URL = "https://bxolefhoyroiryfhsngh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_AcT5rEF73vVg4plEUhIvtA_0Gyn_Ihq";

// Named "supabaseClient" so it never shadows the global `supabase`
// namespace injected by the CDN script.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Redirects to auth.html if there is no active session. Call this at the
 * top of any page that should be members-only. Resolves with the session
 * (or null, if it already redirected away).
 */
async function masofishRequireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    const page = window.location.pathname.split("/").pop() || "index.html";
    window.location.replace("auth.html?next=" + encodeURIComponent(page));
    return null;
  }
  return session;
}

/** Signs the current user out and sends them back to the auth screen. */
async function masofishLogout() {
  await supabaseClient.auth.signOut();
  window.location.href = "auth.html";
}

// If a session ends in another tab (or expires), bounce every open,
// guarded tab back to the auth screen too.
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && document.body.dataset.masofishGuarded === "true") {
    window.location.replace("auth.html");
  }
});
