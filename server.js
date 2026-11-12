const express = require("express");
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.set("trust proxy", 1);
app.use((req,res,next)=>{
  if(process.env.NODE_ENV==="production" && req.headers["x-forwarded-proto"]==="http")
    return res.redirect(301,"https://"+req.headers.host+req.originalUrl);
  next();
});
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "Admin2026!";
const USER_PASSWORD = "UPQ22";
const SHARED_USER = "usuarioupq";
const JWT_SECRET = process.env.JWT_SECRET || "upq-local-dev-secret-change-before-deployment";
const DB_FILE = process.env.DB_FILE || path.join(__dirname,"data","inventario.sqlite");
let db;

function saveDb(){
  fs.mkdirSync(path.dirname(DB_FILE),{recursive:true});
  fs.writeFileSync(DB_FILE,Buffer.from(db.export()));
}
function rows(sql,params=[]){
  const st=db.prepare(sql); st.bind(params); const out=[];
  while(st.step()) out.push(st.getAsObject());
  st.free(); return out;
}
function one(sql,params=[]){ return rows(sql,params)[0] || null; }
function run(sql,params=[]){
  db.run(sql,params);
  const id=Number(db.exec("SELECT last_insert_rowid()")[0]?.values?.[0]?.[0]||0);
  const changes=db.getRowsModified(); saveDb();
  return {id,changes};
}
function tx(fn){
  db.run("BEGIN");
  try { const result=fn(); db.run("COMMIT"); saveDb(); return result; }
  catch(e){ db.run("ROLLBACK"); throw e; }
}
async function init(){
  const SQL=await initSqlJs();
  fs.mkdirSync(path.dirname(DB_FILE),{recursive:true});
  db=fs.existsSync(DB_FILE) ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_FILE))) : new SQL.Database();
  db.run("PRAGMA foreign_keys=ON");
  db.run(`
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL,
    registration TEXT NOT NULL UNIQUE, email TEXT, role TEXT NOT NULL DEFAULT 'C',
    status TEXT NOT NULL DEFAULT 'activo', career TEXT, password_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS inventory(
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, warehouse TEXT NOT NULL,
    location TEXT NOT NULL, quantity_total INTEGER NOT NULL DEFAULT 0,
    quantity_available INTEGER NOT NULL DEFAULT 0, image_url TEXT, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS movements(
    id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_id INTEGER NOT NULL, type TEXT NOT NULL,
    quantity INTEGER NOT NULL, notes TEXT, actor_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(inventory_id) REFERENCES inventory(id), FOREIGN KEY(actor_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS requests(
    id INTEGER PRIMARY KEY AUTOINCREMENT, folio TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL,
    requested_at TEXT DEFAULT CURRENT_TIMESTAMP, status TEXT NOT NULL DEFAULT 'pendiente',
    career TEXT, due_date TEXT, notes TEXT, requester_name TEXT, requester_registration TEXT, teacher_name TEXT, delivered_at TEXT, return_started_at TEXT, return_completed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS request_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, inventory_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL, returned_quantity INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(request_id) REFERENCES requests(id), FOREIGN KEY(inventory_id) REFERENCES inventory(id)
  );
  CREATE TABLE IF NOT EXISTS return_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, request_item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL, damaged INTEGER NOT NULL DEFAULT 0, description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(request_id) REFERENCES requests(id), FOREIGN KEY(request_item_id) REFERENCES request_items(id)
  );
  CREATE TABLE IF NOT EXISTS debts(
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_item_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    inventory_id INTEGER NOT NULL, quantity INTEGER NOT NULL, description TEXT NOT NULL,
    due_date TEXT, status TEXT NOT NULL DEFAULT 'pendiente', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    delivered_at TEXT, FOREIGN KEY(request_item_id) REFERENCES request_items(id),
    FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(inventory_id) REFERENCES inventory(id)
  );`);
  // Repara cantidades heredadas después de crear la tabla inventory.
  db.run("UPDATE inventory SET quantity_total=MAX(0,quantity_total), quantity_available=MAX(0,MIN(quantity_available,MAX(0,quantity_total)))");
  // Compatibilidad con bases creadas en versiones anteriores.
  const requestCols=rows("PRAGMA table_info(requests)").map(x=>x.name);
  if(!requestCols.includes("requester_name")) db.run("ALTER TABLE requests ADD COLUMN requester_name TEXT");
  if(!requestCols.includes("requester_registration")) db.run("ALTER TABLE requests ADD COLUMN requester_registration TEXT");
  if(!requestCols.includes("teacher_name")) db.run("ALTER TABLE requests ADD COLUMN teacher_name TEXT");
  if(!requestCols.includes("delivered_at")) db.run("ALTER TABLE requests ADD COLUMN delivered_at TEXT");
  if(!requestCols.includes("return_started_at")) db.run("ALTER TABLE requests ADD COLUMN return_started_at TEXT");
  if(!requestCols.includes("return_completed_at")) db.run("ALTER TABLE requests ADD COLUMN return_completed_at TEXT");
  // Importa el Excel solo si la base está vacía: nunca duplica materiales.
  const count=one("SELECT COUNT(*) n FROM inventory").n;
  if(count===0){
    const seed=fs.readFileSync(path.join(__dirname,"seed_inventory.sql"),"utf8");
    tx(()=>{ for(const statement of seed.split(/;\s*(?:\r?\n|$)/).map(x=>x.trim()).filter(Boolean)) db.run(statement); });
    console.log("Inventario inicial importado:",one("SELECT COUNT(*) n FROM inventory").n,"materiales.");
  }
  if(!one("SELECT id FROM users WHERE registration='admin'")){
    db.run("INSERT INTO users(full_name,registration,role,status,password_hash) VALUES(?,?,?,?,?)",
      ["Administrador UPQ","admin","admin","activo",bcrypt.hashSync(ADMIN_PASSWORD,10)]);
  } else {
    db.run("UPDATE users SET password_hash=? WHERE registration='admin'",[bcrypt.hashSync(ADMIN_PASSWORD,10)]);
  }
  if(!one("SELECT id FROM users WHERE registration=?",[SHARED_USER])){
    db.run("INSERT INTO users(full_name,registration,role,status,career,password_hash) VALUES(?,?,?,?,?,?)",
      ["Usuario UPQ",SHARED_USER,"C","activo","Comunidad UPQ",bcrypt.hashSync(USER_PASSWORD,10)]);
  } else {
    db.run("UPDATE users SET full_name=?,role='C',status='activo',password_hash=? WHERE registration=?",
      ["Usuario UPQ",bcrypt.hashSync(USER_PASSWORD,10),SHARED_USER]);
  }
  saveDb();
}
function auth(req,res,next){
  const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!token) return res.status(401).json({error:"Inicia sesión."});
  try{
    const p=jwt.verify(token,JWT_SECRET), u=one("SELECT id,full_name,registration,role,status,career FROM users WHERE id=?",[p.id]);
    if(!u||u.status!=="activo") return res.status(401).json({error:"Cuenta inactiva."});
    req.user=u; next();
  }catch(e){ return res.status(401).json({error:"Sesión vencida. Vuelve a ingresar."}); }
}
const allow=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:"No tienes permisos para esta acción."});
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

app.post("/api/login",wrap(async(req,res)=>{
  const id=String(req.body.identifier||"").trim(), password=String(req.body.password||"");
  const lookup=id.toLowerCase()==="usuarioupq"?SHARED_USER:id;
  const u=one("SELECT * FROM users WHERE registration=?",[lookup]);
  let ok=false;
  if(u && u.status==="activo"){
    if(u.role==="admin") ok=password===ADMIN_PASSWORD;
    else if(u.registration===SHARED_USER) ok=password===USER_PASSWORD;
    else ok=password===USER_PASSWORD;
  }
  if(!ok) return res.status(401).json({error:"Usuario o contraseña incorrectos, o cuenta inactiva."});
  const token=jwt.sign({id:u.id},JWT_SECRET,{expiresIn:"12h"});
  res.json({token,user:{id:u.id,name:u.full_name,registration:u.registration,role:u.role,career:u.career}});
}));
app.get("/api/me",auth,(req,res)=>res.json({user:req.user}));

app.get("/api/dashboard",auth,(req,res)=>{
  const inventory=one("SELECT COUNT(*) materials,COALESCE(SUM(quantity_total),0) units,COALESCE(SUM(quantity_available),0) available FROM inventory WHERE active=1");
  const requests=one("SELECT COUNT(*) total FROM requests");
  const loans=one("SELECT COUNT(*) total FROM requests WHERE status='prestamo_activo'");
  const debts=one("SELECT COUNT(*) total FROM debts WHERE status='pendiente'");
  if(req.user.role==="C") return res.json({inventory,requests:null,loans:null,debts:null});
  res.json({inventory,requests:requests.total,loans:loans.total,debts:debts.total});
});
app.get("/api/inventory",auth,(req,res)=>{
  const q=`%${req.query.q||""}%`, warehouse=`%${req.query.warehouse||""}%`;
  res.json(rows("SELECT * FROM inventory WHERE active=1 AND name LIKE ? AND warehouse LIKE ? ORDER BY warehouse,name",[q,warehouse]));
});
app.post("/api/inventory",auth,allow("admin","A"),(req,res)=>{
  const {name,warehouse,location,quantity,image_url}=req.body, n=Number(quantity);
  if(!name||!warehouse||!location||!Number.isInteger(n)||n<0) return res.status(400).json({error:"Completa herramienta, almacén, ubicación y cantidad válida."});
  const r=run("INSERT INTO inventory(name,warehouse,location,quantity_total,quantity_available,image_url) VALUES(?,?,?,?,?,?)",[name,warehouse,location,n,n,image_url||"/assets/tool.svg"]);
  run("INSERT INTO movements(inventory_id,type,quantity,notes,actor_id) VALUES(?,?,?,?,?)",[r.id,"alta",n,"Alta de material",req.user.id]);
  res.status(201).json({message:"Material agregado."});
});
app.post("/api/inventory/:id/movement",auth,allow("admin","A"),(req,res)=>{
  const type=req.body.type, n=Number(req.body.quantity), item=one("SELECT * FROM inventory WHERE id=? AND active=1",[req.params.id]);
  if(!item||!["alta","baja"].includes(type)||!Number.isInteger(n)||n<1) return res.status(400).json({error:"Movimiento o cantidad inválida."});
  if(type==="baja"&&(item.quantity_available<n||item.quantity_total<n)) return res.status(400).json({error:"No puedes dar de baja más unidades que las existencias físicas disponibles."});
  tx(()=>{
    const delta=type==="alta"?n:-n;
    db.run("UPDATE inventory SET quantity_total=quantity_total+?,quantity_available=quantity_available+? WHERE id=?",[delta,delta,item.id]);
    db.run("INSERT INTO movements(inventory_id,type,quantity,notes,actor_id) VALUES(?,?,?,?,?)",[item.id,type,n,req.body.notes||"",req.user.id]);
  });
  res.json({message:`Movimiento de ${type} registrado.`});
});
app.get("/api/movements",auth,allow("admin","A"),(req,res)=>{
  res.json(rows(`SELECT m.*,i.name,i.warehouse,u.full_name actor FROM movements m JOIN inventory i ON i.id=m.inventory_id LEFT JOIN users u ON u.id=m.actor_id ORDER BY m.created_at DESC LIMIT 300`));
});

app.get("/api/users",auth,allow("admin"),(req,res)=>res.json(rows("SELECT id,full_name,registration,email,role,status,career,created_at FROM users ORDER BY full_name")));
app.post("/api/users",auth,allow("admin"),(req,res)=>{
  const {full_name,registration,email,role,career}=req.body;
  if(!full_name||!registration||!["A","B","C","admin"].includes(role)) return res.status(400).json({error:"Completa nombre, matrícula/usuario y rol."});
  if(one("SELECT id FROM users WHERE registration=?",[registration])) return res.status(409).json({error:"Esa matrícula/usuario ya existe."});
  run("INSERT INTO users(full_name,registration,email,role,status,career) VALUES(?,?,?,?,?,?)",[full_name,registration,email||null,role,"activo",career||null]);
  res.status(201).json({message:"Usuario creado. Contraseña fija asignada según su tipo de cuenta."});
});
app.patch("/api/users/:id",auth,allow("admin"),(req,res)=>{
  const {role,status}=req.body;
  if(role&&!["A","B","C","admin"].includes(role)) return res.status(400).json({error:"Nivel no válido."});
  if(status&&!["activo","baja"].includes(status)) return res.status(400).json({error:"Estatus no válido."});
  run("UPDATE users SET role=COALESCE(?,role),status=COALESCE(?,status) WHERE id=?",[role||null,status||null,req.params.id]);
  res.json({message:"Usuario actualizado."});
});

app.post("/api/requests",auth,(req,res)=>{
  const items=Array.isArray(req.body.items)?req.body.items:[], {career,due_date,notes,requester_name,requester_registration,teacher_name}=req.body;
  const personName=String(requester_name|| (req.user.registration===SHARED_USER?"":req.user.full_name)).trim();
  const personRegistration=String(requester_registration|| (req.user.registration===SHARED_USER?"":req.user.registration)).trim();
  const teacher=String(teacher_name||"").trim(), area=String(career||req.user.career||"").trim();
  if(!personName||!personRegistration||!teacher||!area||!due_date)
    return res.status(400).json({error:"Completa todos los campos obligatorios: nombre, matrícula, carrera/área, docente responsable y fecha estimada de devolución."});
  if(!items.length) return res.status(400).json({error:"Agrega al menos una herramienta."});
  const clean=items.map(x=>({id:Number(x.inventory_id),qty:Number(x.quantity)}));
  if(clean.some(x=>!Number.isInteger(x.id)||!Number.isInteger(x.qty)||x.qty<1)) return res.status(400).json({error:"Revisa las herramientas y cantidades."});
  if(new Set(clean.map(x=>x.id)).size!==clean.length) return res.status(400).json({error:"No repitas el mismo material; ajusta su cantidad en una sola fila."});
  for(const x of clean){const it=one("SELECT * FROM inventory WHERE id=? AND active=1",[x.id]);if(!it||it.quantity_available<x.qty)return res.status(400).json({error:`Existencia insuficiente para ${it?.name||"un material"}. Disponible: ${it?.quantity_available??0}.`});}
  const folio="UPQ-"+Date.now();
  const requestId=tx(()=>{
    db.run("INSERT INTO requests(folio,user_id,career,due_date,notes,status,requester_name,requester_registration,teacher_name) VALUES(?,?,?,?,?,'pendiente',?,?,?)",[folio,req.user.id,area,due_date,notes||null,personName,personRegistration,teacher]);
    const id=one("SELECT id FROM requests WHERE folio=?",[folio]).id;
    clean.forEach(x=>db.run("INSERT INTO request_items(request_id,inventory_id,quantity) VALUES(?,?,?)",[id,x.id,x.qty]));
    return id;
  });
  res.status(201).json({message:"Solicitud registrada.",folio,id:requestId});
});
app.get("/api/requests",auth,(req,res)=>{
  if(req.user.role==="C" && req.user.registration===SHARED_USER) return res.json([]);
  const q=`%${req.query.q||""}%`;
  let sql=`SELECT r.*,COALESCE(r.requester_name,u.full_name) full_name,
    COALESCE(r.requester_registration,u.registration) registration,u.role,
    u.career user_career,r.teacher_name,r.delivered_at,
    GROUP_CONCAT(i.name || ' × ' || ri.quantity, ' · ') materials
    FROM requests r JOIN users u ON u.id=r.user_id JOIN request_items ri ON ri.request_id=r.id JOIN inventory i ON i.id=ri.inventory_id`;
  const params=[];
  if(req.user.role!=="admin"&&!["A","B"].includes(req.user.role)){sql+=" WHERE r.user_id=?";params.push(req.user.id);}
  else if(req.query.q){sql+=" WHERE (COALESCE(r.requester_name,u.full_name) LIKE ? OR COALESCE(r.requester_registration,u.registration) LIKE ?)";params.push(q,q);}
  sql+=" GROUP BY r.id ORDER BY r.requested_at DESC";
  res.json(rows(sql,params));
});
app.post("/api/requests/:id/approve",auth,allow("admin","A"),(req,res)=>{
  const r=one("SELECT * FROM requests WHERE id=?",[req.params.id]);
  if(!r||r.status!=="pendiente") return res.status(400).json({error:"La solicitud no está pendiente."});
  const its=rows("SELECT * FROM request_items WHERE request_id=?",[r.id]);
  for(const it of its){const inv=one("SELECT * FROM inventory WHERE id=?",[it.inventory_id]);if(!inv||inv.quantity_available<it.quantity)return res.status(400).json({error:"No hay existencias suficientes."});}
  tx(()=>{
    its.forEach(it=>{
      db.run("UPDATE inventory SET quantity_available=quantity_available-? WHERE id=?",[it.quantity,it.inventory_id]);
      db.run("INSERT INTO movements(inventory_id,type,quantity,notes,actor_id) VALUES(?,?,?,?,?)",[it.inventory_id,"préstamo",it.quantity,r.folio,req.user.id]);
    });
    db.run("UPDATE requests SET status='prestamo_activo',delivered_at=CURRENT_TIMESTAMP WHERE id=?",[r.id]);
  });
  res.json({message:"Préstamo aprobado y existencias descontadas."});
});
app.post("/api/requests/:id/reject",auth,allow("admin","A"),(req,res)=>{
  const r=one("SELECT * FROM requests WHERE id=? AND status='pendiente'",[req.params.id]);
  if(!r)return res.status(404).json({error:"Solicitud no encontrada."});
  run("UPDATE requests SET status='rechazada' WHERE id=?",[r.id]);res.json({message:"Solicitud rechazada."});
});
app.get("/api/loans",auth,allow("admin","A","B"),(req,res)=>{
  const q=`%${req.query.q||""}%`;
  res.json(rows(`SELECT r.id,r.folio,r.requested_at,r.due_date,r.status,u.full_name,u.registration,
    GROUP_CONCAT(i.name || ' × ' || (ri.quantity-ri.returned_quantity),' · ') materials
    FROM requests r JOIN users u ON u.id=r.user_id JOIN request_items ri ON ri.request_id=r.id JOIN inventory i ON i.id=ri.inventory_id
    WHERE r.status='prestamo_activo' AND (COALESCE(r.requester_name,u.full_name) LIKE ? OR COALESCE(r.requester_registration,u.registration) LIKE ?)
    GROUP BY r.id ORDER BY r.requested_at DESC`,[q,q]));
});
app.get("/api/returns",auth,allow("admin","A","B"),(req,res)=>{
  const q=`%${req.query.q||""}%`;
  res.json(rows(`SELECT r.id,r.folio,r.due_date,r.teacher_name,r.delivered_at,r.return_started_at,r.return_completed_at,COALESCE(r.requester_name,u.full_name) full_name,COALESCE(r.requester_registration,u.registration) registration,
    GROUP_CONCAT(i.name || ' × ' || (ri.quantity-ri.returned_quantity),' · ') materials
    FROM requests r JOIN users u ON u.id=r.user_id JOIN request_items ri ON ri.request_id=r.id JOIN inventory i ON i.id=ri.inventory_id
    WHERE r.status='prestamo_activo' AND ri.returned_quantity<ri.quantity AND (COALESCE(r.requester_name,u.full_name) LIKE ? OR COALESCE(r.requester_registration,u.registration) LIKE ?)
    GROUP BY r.id ORDER BY r.due_date`,[q,q]));
});
app.post("/api/returns/:id/start",auth,allow("admin","A"),(req,res)=>{
  const request=one("SELECT id,status FROM requests WHERE id=? AND status='prestamo_activo'",[req.params.id]);
  if(!request) return res.status(404).json({error:"Préstamo activo no encontrado."});
  run("UPDATE requests SET return_started_at=CASE WHEN return_completed_at IS NULL THEN COALESCE(return_started_at,CURRENT_TIMESTAMP) ELSE CURRENT_TIMESTAMP END,return_completed_at=NULL WHERE id=?",[request.id]);
  res.json({message:"Se registró la hora de entrada de la devolución."});
});
app.get("/api/returns/:id/items",auth,allow("admin","A","B"),(req,res)=>{
  res.json(rows(`SELECT ri.id item_id,ri.quantity,ri.returned_quantity,ri.quantity-ri.returned_quantity remaining,i.name,i.id inventory_id
    FROM request_items ri JOIN inventory i ON i.id=ri.inventory_id WHERE ri.request_id=? AND ri.returned_quantity<ri.quantity ORDER BY i.name`,[req.params.id]));
});
app.post("/api/returns/:id",auth,allow("admin","A"),(req,res)=>{
  const items=Array.isArray(req.body.items)?req.body.items:[];
  if(!items.length) return res.status(400).json({error:"Marca al menos un material que se recibió."});
  const request=one("SELECT * FROM requests WHERE id=? AND status='prestamo_activo'",[req.params.id]);
  if(!request) return res.status(404).json({error:"Préstamo activo no encontrado."});
  const clean=items.map(x=>({itemId:Number(x.itemId),quantity:Number(x.quantity),damaged:Number(x.damaged||0),description:String(x.description||"").trim(),debtDue:x.debtDue||null}));
  if(clean.some(x=>!Number.isInteger(x.itemId)||!Number.isInteger(x.quantity)||x.quantity<1||!Number.isInteger(x.damaged)||x.damaged<0||x.damaged>x.quantity||(x.damaged>0&&!x.description)))
    return res.status(400).json({error:"Revisa las cantidades recibidas y la descripción de cada daño."});
  const ids=clean.map(x=>x.itemId); if(new Set(ids).size!==ids.length) return res.status(400).json({error:"Un material aparece más de una vez."});
  for(const x of clean){const it=one("SELECT ri.*,i.name,i.quantity_total FROM request_items ri JOIN inventory i ON i.id=ri.inventory_id WHERE ri.id=? AND ri.request_id=?",[x.itemId,request.id]);if(!it||x.quantity>it.quantity-it.returned_quantity||x.damaged>it.quantity_total)return res.status(400).json({error:`Cantidad no válida para ${it?.name||"el material"}.`});}
  tx(()=>{
    for(const x of clean){
      const it=one("SELECT ri.*,i.id inventory_id FROM request_items ri JOIN inventory i ON i.id=ri.inventory_id WHERE ri.id=?",[x.itemId]);
      db.run("UPDATE request_items SET returned_quantity=returned_quantity+? WHERE id=?",[x.quantity,it.id]);
      const good=x.quantity-x.damaged;
      db.run("UPDATE inventory SET quantity_available=quantity_available+?,quantity_total=quantity_total-? WHERE id=?",[good,x.damaged,it.inventory_id]);
      db.run("INSERT INTO return_events(request_id,request_item_id,quantity,damaged,description) VALUES(?,?,?,?,?)",[request.id,it.id,x.quantity,x.damaged,x.description||null]);
      if(x.damaged>0) db.run("INSERT INTO debts(request_item_id,user_id,inventory_id,quantity,description,due_date) VALUES(?,?,?,?,?,?)",[it.id,request.user_id,it.inventory_id,x.damaged,x.description,x.debtDue]);
    }
    const pending=one("SELECT COALESCE(SUM(quantity-returned_quantity),0) n FROM request_items WHERE request_id=?",[request.id]).n;
    db.run("UPDATE requests SET return_completed_at=CURRENT_TIMESTAMP WHERE id=?",[request.id]);
    if(!pending) db.run("UPDATE requests SET status='devuelto' WHERE id=?",[request.id]);
  });
  res.json({message:"Devolución parcial o completa registrada. Las existencias y adeudos fueron actualizados."});
});
app.get("/api/history",auth,allow("admin","A","B"),(req,res)=>{
  const month=String(req.query.month||"");
  if(month&&!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({error:"Mes no válido."});
  const params=[]; let where="";
  if(month){where="WHERE strftime('%Y-%m',r.requested_at)=?";params.push(month);}
  const data=rows(`SELECT r.id,r.folio,r.requested_at,r.delivered_at,r.return_started_at,r.return_completed_at,r.status,r.career,r.teacher_name,
    COALESCE(r.requester_name,u.full_name) full_name,COALESCE(r.requester_registration,u.registration) registration,
    GROUP_CONCAT(i.name || ' × ' || ri.quantity,' · ') materials,
    (SELECT MAX(re.created_at) FROM return_events re WHERE re.request_id=r.id) last_return_at,
    (SELECT COALESCE(SUM(re.quantity),0) FROM return_events re WHERE re.request_id=r.id) returned_units
    FROM requests r JOIN users u ON u.id=r.user_id JOIN request_items ri ON ri.request_id=r.id JOIN inventory i ON i.id=ri.inventory_id
    ${where} GROUP BY r.id ORDER BY r.requested_at DESC`,params);
  res.json(data);
});
app.get("/api/debts",auth,allow("admin","A","B"),(req,res)=>{
  const q=`%${req.query.q||""}%`;
  res.json(rows(`SELECT d.*,COALESCE(r.requester_name,u.full_name) full_name,COALESCE(r.requester_registration,u.registration) registration,i.name material,r.folio FROM debts d JOIN users u ON u.id=d.user_id JOIN inventory i ON i.id=d.inventory_id JOIN request_items ri ON ri.id=d.request_item_id JOIN requests r ON r.id=ri.request_id WHERE (COALESCE(r.requester_name,u.full_name) LIKE ? OR COALESCE(r.requester_registration,u.registration) LIKE ?) ORDER BY CASE WHEN d.status='entregado' THEN 3 WHEN d.due_date IS NOT NULL AND date(d.due_date)<date('now') THEN 1 ELSE 2 END,d.due_date`,[q,q]));
});
app.post("/api/debts/:id/delivered",auth,allow("admin","A"),(req,res)=>{
  const d=one("SELECT * FROM debts WHERE id=? AND status='pendiente'",[req.params.id]);
  if(!d)return res.status(404).json({error:"Adeudo no encontrado o ya entregado."});
  tx(()=>{
    db.run("UPDATE debts SET status='entregado',delivered_at=CURRENT_TIMESTAMP WHERE id=?",[d.id]);
    db.run("UPDATE inventory SET quantity_total=quantity_total+?,quantity_available=quantity_available+? WHERE id=?",[d.quantity,d.quantity,d.inventory_id]);
  });
  res.json({message:"Adeudo marcado como entregado y material repuesto."});
});
app.get("/api/reports",auth,allow("admin","A"),(req,res)=>{
  const summary=one("SELECT COUNT(*) materials,COALESCE(SUM(quantity_total),0) units FROM inventory WHERE active=1");
  const byWarehouse=rows("SELECT warehouse,COUNT(*) materials,COALESCE(SUM(quantity_total),0) units FROM inventory GROUP BY warehouse ORDER BY warehouse");
  const topItems=rows("SELECT i.name, SUM(ri.quantity) total FROM request_items ri JOIN inventory i ON i.id=ri.inventory_id GROUP BY i.id ORDER BY total DESC LIMIT 10");
  const topUsers=rows("SELECT u.full_name,u.registration,COUNT(*) total FROM requests r JOIN users u ON u.id=r.user_id GROUP BY u.id ORDER BY total DESC LIMIT 10");
  const hours=rows("SELECT strftime('%H',requested_at) hour,COUNT(*) total FROM requests GROUP BY hour ORDER BY hour");
  const recent=rows("SELECT r.folio,r.requested_at,r.status,r.career,u.full_name,u.registration,GROUP_CONCAT(i.name,' · ') materials FROM requests r JOIN users u ON u.id=r.user_id JOIN request_items ri ON ri.request_id=r.id JOIN inventory i ON i.id=ri.inventory_id GROUP BY r.id ORDER BY r.requested_at DESC LIMIT 100");
  res.json({summary,byWarehouse,topItems,topUsers,hours,recent});
});
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:err.message||"Error interno."});});
init().then(()=>{
  app.listen(PORT,"0.0.0.0",()=>console.log(`Sistema de Inventario UPQ listo en puerto ${PORT}`));
}).catch(e=>{console.error("Error al iniciar:",e);process.exit(1);});
