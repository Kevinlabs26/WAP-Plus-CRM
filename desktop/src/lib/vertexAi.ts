import type { AppSettings } from "@/store/types";
export type VertexAiConfig = Pick<AppSettings,"vertexProjectId"|"vertexLocation"|"vertexCredentialId">;
export type VertexAiStatus = {configured:boolean;projectId:string|null;email:string|null;credentialId:string|null};
export const vertexAiConfig=(settings:Partial<AppSettings>):VertexAiConfig|undefined=>settings.aiProvider==="vertex"?{vertexProjectId:settings.vertexProjectId||"",vertexLocation:settings.vertexLocation||"global",vertexCredentialId:settings.vertexCredentialId||""}:undefined;
export function vertexBaseUrl(config:VertexAiConfig){
  const project=config.vertexProjectId,location=config.vertexLocation;
  if(!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)||!/^([a-z]+-[a-z]+\d+|global)$/.test(location))throw Error("请填写有效的 Vertex 项目 ID 和区域");
  const host=location==="global"?"aiplatform.googleapis.com":`${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models`;
}
export async function vertexAccessToken(expectedCredentialId?:string){const {invoke}=await import("@tauri-apps/api/core");return invoke<string>("vertex_ai_access_token",{expectedCredentialId:expectedCredentialId||null});}
export async function vertexStatus(){const {invoke}=await import("@tauri-apps/api/core");return invoke<VertexAiStatus>("vertex_ai_status");}
export async function saveVertexCredentials(credentials:string){const {invoke}=await import("@tauri-apps/api/core");return invoke<VertexAiStatus>("vertex_ai_save",{credentials});}
export async function removeVertexCredentials(){const {invoke}=await import("@tauri-apps/api/core");return invoke<void>("vertex_ai_remove");}
