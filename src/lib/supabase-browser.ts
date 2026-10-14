import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function hasSupabaseBrowserConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  browserClient ??= createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}

function isInvalidSessionError(error: { status?: number } | null) {
  return error?.status === 400 || error?.status === 401 || error?.status === 403;
}

export async function getVerifiedSupabaseSession(
  client: SupabaseClient,
): Promise<Session | null> {
  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError) {
    if (!isInvalidSessionError(sessionError)) throw sessionError;
    await client.auth.signOut({ scope: "local" });
    return null;
  }
  if (!data.session) return null;

  const { data: userData, error: userError } = await client.auth.getUser();
  if (!userError && userData.user) return data.session;
  if (userError && !isInvalidSessionError(userError)) throw userError;

  await client.auth.signOut({ scope: "local" });
  return null;
}

export async function ensureAnonymousSupabaseSession(client: SupabaseClient) {
  const existingSession = await getVerifiedSupabaseSession(client);
  if (existingSession) return existingSession;

  const { data, error } = await client.auth.signInAnonymously();
  if (error) {
    throw new Error(
      error.message.includes("Anonymous sign-ins are disabled")
        ? "Anonymous sign-ins are disabled. Enable them in Supabase Authentication settings."
        : error.message,
    );
  }
  if (!data.session) {
    throw new Error("An authenticated session could not be created. Please try again.");
  }
  return data.session;
}
