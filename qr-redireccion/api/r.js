// go.taudux.com/<codigo> → vercel.json lo reescribe a /api/r?codigo=<codigo>.
import { crearManejador, crearResolverSupabase } from "../lib/redireccion.mjs";

export const GET = crearManejador({
  resolver: crearResolverSupabase({
    url: process.env.SUPABASE_URL,
    llave: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }),
});
