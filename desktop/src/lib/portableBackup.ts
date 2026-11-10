const MAGIC=new TextEncoder().encode("WAPCRM-PORTABLE-1\0");
const LIMIT=256*1024*1024;
const HEADER=MAGIC.length+16+12;
async function passwordKey(password:string,salt:Uint8Array,usage:KeyUsage){
  if(password.length<10||password.length>1024)throw Error("备份密码须为 10–1024 个字符");
  const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt:new Uint8Array(salt),iterations:600_000},material,{name:"AES-GCM",length:256},false,[usage]);
}
export async function encryptPortableBackup(value:unknown,password:string):Promise<Blob>{
  const plain=new TextEncoder().encode(JSON.stringify(value));
  if(plain.byteLength>LIMIT)throw Error("备份超过 256 MB，请减少附件后重试");
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const header=new Uint8Array(HEADER);header.set(MAGIC);header.set(salt,MAGIC.length);header.set(iv,MAGIC.length+16);
  const key=await passwordKey(password,salt,"encrypt");
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:header,tagLength:128},key,plain);
  return new Blob([header,encrypted],{type:"application/octet-stream"});
}
export async function decryptPortableBackup(file:Blob,password:string):Promise<unknown>{
  if(file.size<HEADER+16||file.size>LIMIT+HEADER+16)throw Error("加密备份大小无效或超过 256 MB");
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!MAGIC.every((byte,index)=>bytes[index]===byte))throw Error("这不是支持的加密迁移备份");
  const header=bytes.slice(0,HEADER),salt=bytes.slice(MAGIC.length,MAGIC.length+16),iv=bytes.slice(MAGIC.length+16,HEADER);
  const key=await passwordKey(password,salt,"decrypt");
  let plain:ArrayBuffer;
  try{plain=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:header,tagLength:128},key,bytes.slice(HEADER));}
  catch{throw Error("密码不正确，或备份文件已损坏；未修改本机数据");}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(plain));}
  catch{throw Error("解密后的备份格式无效；未修改本机数据");}
}
export function downloadPortableBackup(blob:Blob){
  const url=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=url;anchor.download=`wap-plus-backup-${new Date().toISOString().slice(0,10)}.wapbackup`;
  document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
}
