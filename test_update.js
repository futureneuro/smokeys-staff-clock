import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val) env[key] = val.join('=').trim().replace(/['"]/g, '');
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: active, error: fetchError } = await supabase.from('breaks').select('*').is('break_end', null).limit(1);
  if (fetchError || !active || active.length === 0) {
    console.log('No active breaks to test update.', fetchError);
    return;
  }
  
  const b = active[0];
  console.log('Found active break:', b.id, 'start:', b.break_start);
  
  const durationMinutes = Math.max(0, Math.round((Date.now() - new Date(b.break_start).getTime()) / 60000));
  
  console.log('Attempting to update with duration:', durationMinutes);
  const { data, error } = await supabase
    .from('breaks')
    .update({ break_end: new Date().toISOString(), duration_minutes: durationMinutes })
    .eq('id', b.id)
    .select();
    
  if (error) {
    console.error('Update failed with error:', error);
  } else {
    console.log('Update succeeded:', data);
  }
}
run();
