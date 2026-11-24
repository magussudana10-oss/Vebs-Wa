import { createHash, randomUUID } from "node:crypto";
const TARGET_TAB = "NTB Riject";
const CHUNK_SIZE = 1000;
const REQUIRED_HEADERS = ["created_date","created_date_weekly","created_date_monthly","region_name","area_name","branch_name","customer_number","reject_type","reject_reason","principal_amount"];
function norm(v){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");}
function sheetValue(v){if(v===null||v===undefined||v==="")return "";if(v instanceof Date)return v.getTime()/86400000+25569;if(typeof v==="number"&&!Number.isFinite(v))return "";return v;}
export function detectNtbRejectWorkbook(XLSX,buffer,{detectOnly=false}={}){
 let wb;try{wb=XLSX.read(buffer,{type:"buffer",cellDates:true,raw:true});}catch(e){if(detectOnly)return {isNtbReject:false};throw new Error("Workbook NTB Reject tidak dapat dibaca: "+(e?.message||e));}
 const name=wb.SheetNames.find(n=>n.toLowerCase()==="sheet1")||wb.SheetNames[0];const sh=wb.Sheets[name];if(!sh)return detectOnly?{isNtbReject:false}:(()=>{throw new Error("Sheet sumber NTB Reject tidak ditemukan.");})();
 const matrix=XLSX.utils.sheet_to_json(sh,{header:1,defval:null,raw:true,blankrows:false});if(!matrix.length)return detectOnly?{isNtbReject:false}:(()=>{throw new Error("Sheet Excel NTB Reject kosong.");})();
 const headers=matrix[0].map(v=>String(v??"").trim());const positions=new Map();headers.forEach((h,i)=>{const k=norm(h);if(k&&!positions.has(k))positions.set(k,i);});
 const signature=headers.length===18&&REQUIRED_HEADERS.every(h=>positions.has(h));
 if(!signature)return detectOnly?{isNtbReject:false}:(()=>{throw new Error("Struktur NTB Reject tidak sesuai: wajib 18 kolom A:R dengan header NTB Reject.");})();
 if(detectOnly)return {isNtbReject:true,sheetName:name,columns:18};
 const rows=[];for(let r=1;r<matrix.length;r++){const src=matrix[r];if(!src||src.every(v=>v===null||v===""))continue;rows.push(Array.from({length:18},(_,c)=>sheetValue(src[c])));}
 if(!rows.length)throw new Error("Tidak ada baris data NTB Reject untuk di-upload.");
 return {isNtbReject:true,sheetName:name,headers,rows,totalRows:rows.length};
}
function hash(v){return createHash("sha256").update(JSON.stringify(v)).digest("hex");}
async function post(url,token,payload){const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({token,...payload}),signal:AbortSignal.timeout(120000)});let body;try{body=await res.json()}catch{throw new Error("Apps Script NTB Reject tidak mengembalikan JSON.");}if(!res.ok||body.success!==true)throw new Error(body.message||`Apps Script gagal HTTP ${res.status}`);return body.result||{};}
export async function uploadNtbRejectRows({url,token,parsed,fileName}){
 if(!url||!token)throw new Error("Integrasi NTB Reject belum dikonfigurasi. Periksa NTBREJECT_WEBAPP_URL dan NTBREJECT_API_TOKEN di Railway.");
 const id=randomUUID(),chunks=Math.ceil(parsed.rows.length/CHUNK_SIZE);
 const b=await post(url,token,{action:"ntbreject_begin",uploadId:id,fileName:String(fileName||"NTB Reject.xlsx").slice(0,180),targetTab:TARGET_TAB,headers:parsed.headers,expectedRows:parsed.rows.length,expectedChunks:chunks});
 if(b.mode!=="FULL_REPLACE_DIRECT"||b.directWrite!==true||b.targetTab!==TARGET_TAB)throw new Error("Konfigurasi target NTB Reject tidak sesuai; upload dihentikan.");
 let total=0;for(let i=0;i<chunks;i++){const rows=parsed.rows.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE);const r=await post(url,token,{action:"ntbreject_chunk",uploadId:id,chunkIndex:i,chunkHash:hash(rows),rows});total+=rows.length;if(r.writtenRows!==total)throw new Error(`Verifikasi chunk NTB Reject tidak sesuai (${r.writtenRows}/${total}).`);}
 const c=await post(url,token,{action:"ntbreject_commit",uploadId:id,expectedRows:parsed.rows.length,expectedChunks:chunks});
 if(c.mode!=="FULL_REPLACE_DIRECT"||c.directWrite!==true||c.verified!==true||c.totalWritten!==parsed.rows.length||c.targetTab!==TARGET_TAB)throw new Error("Upload NTB Reject belum terverifikasi lengkap. Tidak mengirim status berhasil.");
 return {...c,totalRows:parsed.rows.length,fileName};
}
