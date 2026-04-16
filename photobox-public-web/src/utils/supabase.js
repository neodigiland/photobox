import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || 'https://webkgblwyxqytmjwlndk.supabase.co';
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_HcEcYUubM-EW-zjjLD_-5g_YsSyqnys';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
