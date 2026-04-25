import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val) env[key] = val.join('=').trim().replace(/['"]/g, '');
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;

function buildEdgeBase(url) {
  if (!url) return '';
  if (url.includes('/functions/v1')) return url.replace(/\/+$/, '');
  return `${url.replace(/\/+$/, '')}/functions/v1`;
}
const edgeUrl = `${buildEdgeBase(supabaseUrl)}/clock-action`;

async function run() {
  // To test check_out, we need a JWT or staff_pin. We can't easily forge a JWT without the secret.
  // But wait! Is there a test user pin we can use? 
  // Let's query the database for the active staff member!
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  
  const { data: logs } = await supabase.from('time_logs').select('staff_id, staff(pin)').is('check_out', null).limit(1);
  if (!logs || logs.length === 0) {
    console.log('No open time logs found in DB.');
    return;
  }
  
  const pin = logs[0].staff.pin;
  console.log('Found open log for staff pin:', pin);
  
  const payload = { action: 'check_out', staff_pin: pin, gps_lat: 40, gps_lng: -74 };
  console.log('Sending request to', edgeUrl, payload);
  
  const res = await fetch(edgeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  console.log('Response status:', res.status);
  const text = await res.text();
  console.log('Response body:', text);
}
run();
