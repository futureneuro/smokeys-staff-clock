import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (url, options) => {
      return fetch(url, { ...options, cache: 'no-store' });
    }
  }
});

function buildEdgeBase(url: string): string {
  if (!url) return '';
  if (url.includes('/functions/v1')) return url.replace(/\/+$/, '');
  return `${url.replace(/\/+$/, '')}/functions/v1`;
}

export const EDGE_FUNCTIONS_BASE_URL = buildEdgeBase(supabaseUrl);
export const EDGE_FUNCTION_URL = `${EDGE_FUNCTIONS_BASE_URL}/clock-action`;
