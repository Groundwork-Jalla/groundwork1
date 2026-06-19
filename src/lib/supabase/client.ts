import { createClient } from "@supabase/supabase-js";
import WS from "ws";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Vite's dev server evaluates this module under Node (even in SPA mode, to
// render the document shell), where no native WebSocket exists. In real
// browsers `WebSocket` is always defined, so this never touches `ws` there.
const realtimeTransport = typeof WebSocket === "undefined" ? (WS as unknown as typeof WebSocket) : undefined;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: "pkce",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  realtime: realtimeTransport ? { transport: realtimeTransport } : undefined,
});
