require("dotenv").config();
const {createClient}=require("@supabase/supabase-js"); 

const supabase=createClient( 
    process.env.VITE_SUPABASE_URL, 
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY
); 

module.exports=supabase; 

console.log({
  hasUrl: Boolean(process.env.VITE_SUPABASE_URL),
  hasServiceKey: Boolean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY),
});