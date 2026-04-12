import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || 'https://YOUR-PUBLIC-URL.supabase.co';
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'YOUR-ANON-KEY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
