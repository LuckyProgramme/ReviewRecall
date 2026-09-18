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
    .insert({
        expired_at: new Date(Date.now()+30*60*1000).toISOString(),
    })
    .select("guest_id, created_at, expired_at")
    .single(); 
    
    if(error){ 
        return res.status(500).json({error:error.message})
    } 

    res.status(201).json({ 
        session_id: data.guest_id, 
        created_at: data.created_at,
        expired_at: data.expired_at 
    })
}
)

app.get("/api/sessions/:guest_id", async(req,res)=>{
    const{guest_id}=req.params;

    const{data, error}=await supabase 
    .from("guest_session")
    .select("guest_id, created_at, expired_at")
    .eq("guest_id", guest_id)
    .maybeSingle();

     if (error){
        return res.status(500).json({
             "valid": false,
             "error": error.message,
        });
     }

     if (!data){ 
        return res.status(404).json({
            "valid": false,
            "error": "Session not found"
        });
     }
     const expiresAt=new Date(data.expired_at).getTime(); 

     if(expiresAt<=Date.now()) {
        return res.status(410).json({
            valid:false,
            error: "Session expired"
        }); 
     }

     res.status(200).json({ 
        "valid": true,
        "guest_id":data.guest_id,
        "create_at":data.created_at,
        "expired_at": data.expired_at
     });
});

app.listen(PORT, () => {
    console.log('Server running at Port {PORT}');
});


