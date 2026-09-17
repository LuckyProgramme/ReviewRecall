const express = require("express") ;
const cors=require("cors");
const supabase=require("./supabase")
const app=express();
const PORT=5000;

app.use(cors()); 
app.use(express.json());

app.get("/health",(req,res) => {
    res.json({status:"ok"});
});


app.post("/api/sessions", async(req,res) => {
    const{data, error}= await supabase 
    .from("guest_session")
    .insert({})
    .select("id, created_at, expired_at")
    .single(); 
    
    if(error){ 
        return res.status(500).json({error:error.message})
    } 

    res.status(201).json({ 
        session_id: data.id, 
        created_at: data.created_at,
        expired_at: data.expired_at 
    })``
}
)

app.listen(PORT, () => {
    console.log('Server running at Port {PORT}');
});


