import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  const { data: assignments } = await supabase.from('shift_assignments').select('*, shift_definition:shift_definitions(*)')
  console.log(JSON.stringify(assignments, null, 2))
}
run()
