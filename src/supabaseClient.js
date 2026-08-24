import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://jrkfnbgiafwkdpiwylis.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_3Rs7NWY_fl2DLYqbhEs5Sw_TONFx8N4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    experimental: { passkey: true },
  },
});
