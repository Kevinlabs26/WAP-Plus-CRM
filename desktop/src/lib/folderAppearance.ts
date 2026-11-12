export function folderBackground(color:unknown,depth:unknown=10):string|undefined{
  if(typeof color!=="string"||!/^#[0-9a-f]{6}$/i.test(color))return undefined;
  const percent=typeof depth==="number"&&Number.isFinite(depth)?Math.min(40,Math.max(0,depth)):10;
  return `${color}${Math.round(percent*255/100).toString(16).padStart(2,"0")}`;
}
export function folderRowPadding(density:unknown):number{
  return density==="compact"?2:density==="comfortable"?10:6;
}
