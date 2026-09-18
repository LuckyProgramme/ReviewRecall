const express = require("express") ;
const cors=require("cors");
const supabase=require("./supabase")
const app=express();
const path= require("path")
const crypto= require("crypto")
const PORT=5000;


const MAX_FILE_SIZE=10*1024*1024; 

const ALLOWED_FILE_TYPES= new Set([ 
    "application/pdf"
]); 

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
app.patch("/api/sessions/:guest_id/activity", async(req,res) =>{
    const{guest_id}=req.params; 
    const{data: session, error: findError} = await supabase
    .from("guest_session")
    .select("guest_id, created_at, expired_at")
    .eq("guest_id", guest_id)
    .maybeSingle()

    if(findError){ 
        return res.status(500).json({
             "valid": false,
             "error": error.message,
        });
    }

    if(!session){ 
        return res.status(404).json({ 
            valid:false,
            error: "Session not found"
        })
    }
    const currentExpiry= new Date(session.expired_at).getTime(); 

    if(!session.expired_at || currentExpiry<=Date.now()){
        return res.status(410).json({
            valid:false,
            error: "Session expired",
        });  
    }

    const newExpiry=new Date(Date.now()+30*60*1000).toISOString(); 
    const{data: updatedSession, error:updatedError}=await supabase 
    .from ("guest_session")
    .update({ 
        expired_at:newExpiry 
    })
    .eq("guest_id", guest_id)
    .select("guest_id, created_at, expired_at")
    .single(); 

    if(updatedError){ 
       return res.status(500),json({
        valid:false,
        error: updatedError.message 
       });
    }

    return res.status(200).json({
        valid:true,
        guest_id: updatedSession.guest_id,
        created_at: updatedSession.created_at,
        expired_at: updatedSession.expired_at 
    }); 
});


app.post("/api/uploads/sign", async(req,res) => {
    const { guest_id, file_name, file_type, file_size}=req.body;
    
    if(!guest_id || !file_name || !file_type || !file_size) {
        return res.status(400).json({
            error: "something is required"
        }); 
    }
    if(!ALLOWED_FILE_TYPES.has(file_type)) { 
        return res.status(415).json({
            error: "File Type not supported"
        });
    }
    if(file_size> MAX_FILE_SIZE){
        return res.status(413).json({
            error: "File Exceeded 10MB"
        });
    }
    const {data: session, error: sessionError } = await supabase
    .from("guest_session")
    .select("guest_id, expired_at")
    .eq("guest_id", guest_id)
    .maybeSingle();

    if(sessionError){
        return res.status(500).json({
            error:sessionError.message 
        });
    }

     if (!session) {
    return res.status(404).json({
      error: "Session not found",
    });
  }
    if(!session.expired_at|| new Date(session.expired_at).getTime() <= Date.now()) 
    {
        return res.status(410).json({
            error: "Session Expired"
        }); 
    }

    const extension=path.extname(file_name).toLowerCase(); 
    const storagePath= `${guest_id}/${crypto.randomUUID()}${extension}`;

    const {data:uploadData, error: uploadError} = await supabase.storage
    .from("reviewer_upload")
    .createSignedUploadUrl(storagePath);

    if(uploadError){
        return res.status(500).json({ error:uploadError.message});
    }

    return res.status(201).json({
        path:storagePath,
        token: uploadData.token,
    });
});



app.listen(PORT, () => {
    console.log('Server running at Port {PORT}');
});


