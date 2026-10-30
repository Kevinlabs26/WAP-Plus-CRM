import assert from "node:assert/strict";
import test from "node:test";
import { createChatFolderActions } from "../src/store/chatFolderActions.ts";

let settings = {
  chatFolders: [
    { id: "parent", name: "Parent", sort: 0, chatIds: ["chat-1", "chat-2"] },
    { id: "child", parentId: "parent", name: "Child", sort: 1, chatIds: ["chat-3"] },
  ],
  chatFolderClones: [
    { id: "clone-1", folderId: "parent", sourceChatId: "chat-4" },
    { id: "clone-2", folderId: "child", sourceChatId: "chat-5" },
  ],
};

const actions = createChatFolderActions({
  getSettings: () => settings,
  updateSettings: (patch) => {
    settings = { ...settings, ...patch };
  },
  pushToast() {},
});

actions.clearChatFolder("parent");

assert.deepEqual(settings.chatFolders[0].chatIds, []);
assert.deepEqual(settings.chatFolders[1].chatIds, ["chat-3"]);
assert.deepEqual(settings.chatFolderClones, [
  { id: "clone-2", folderId: "child", sourceChatId: "chat-5" },
]);

console.log("chat-folder-actions.test.mjs ok");

test("folders can nest repeatedly, inherit the parent account scope and reject a missing parent", () => {
  const toasts=[];
  let settings={uiLanguage:"zh-CN",accountViewMode:{type:"account",accountId:"other"},
    chatFolders:[{id:"root",name:"Root",sort:0,collapsed:true,chatIds:[],scope:{type:"account",accountId:"wa-a"}}],chatFolderClones:[]};
  const actions=createChatFolderActions({getSettings:()=>settings,updateSettings:patch=>{settings={...settings,...patch};},pushToast:message=>toasts.push(message)});
  let parent="root";
  for(let depth=1;depth<=12;depth++) {
    const id=actions.createChatFolder(`Level ${depth}`,parent);
    assert.ok(id);assert.notEqual(id,parent);
    const child=settings.chatFolders.find(f=>f.id===id);
    assert.equal(child.parentId,parent);
    assert.deepEqual(child.scope,{type:"account",accountId:"wa-a"});
    assert.equal(settings.chatFolders.find(f=>f.id===parent).collapsed,false);
    parent=id;
  }
  assert.equal(new Set(settings.chatFolders.map(f=>f.id)).size,13);
  const before=structuredClone(settings);
  assert.equal(actions.createChatFolder("Lost","removed"),null);
  assert.deepEqual(settings,before);assert.match(toasts.at(-1),/不存在/);
});

test("deleting an intermediate folder lifts its children while preserving deeper folders, members and copies", () => {
  let settings={chatFolders:[
    {id:"root",name:"Root",chatIds:[]},
    {id:"middle",parentId:"root",name:"Middle",chatIds:["unassigned"]},
    {id:"child",parentId:"middle",name:"Child",chatIds:["kept"]},
    {id:"leaf",parentId:"child",name:"Leaf",chatIds:["deep"]},
  ],chatFolderClones:[{id:"remove",folderId:"middle",sourceChatId:"one"},{id:"keep",folderId:"leaf",sourceChatId:"two"}]};
  const actions=createChatFolderActions({getSettings:()=>settings,updateSettings:patch=>{settings={...settings,...patch};},pushToast(){}});
  actions.deleteChatFolder("middle");
  assert.equal(settings.chatFolders.find(f=>f.id==="child").parentId,"root");
  assert.equal(settings.chatFolders.find(f=>f.id==="leaf").parentId,"child");
  assert.deepEqual(settings.chatFolders.flatMap(f=>f.chatIds),["kept","deep"]);
  assert.deepEqual(settings.chatFolderClones,[{id:"keep",folderId:"leaf",sourceChatId:"two"}]);
  actions.deleteChatFolder("root");
  assert.equal(settings.chatFolders.find(f=>f.id==="child").parentId,undefined);
  assert.equal(settings.chatFolders.find(f=>f.id==="leaf").parentId,"child");
});

test("deep folder siblings can be reordered without moving their descendants or changing parents", () => {
  const scope={type:"all"};
  let settings={chatFolders:[
    {id:"root",name:"Root",sort:0,chatIds:[],scope},
    {id:"parent",parentId:"root",name:"Parent",sort:1,chatIds:[],scope},
    ...["a","b","c"].map((id,i)=>({id,parentId:"parent",name:id,sort:3-i,chatIds:[],scope})),
    {id:"leaf",parentId:"a",name:"Leaf",sort:4,chatIds:["kept"],scope},
  ],chatFolderClones:[]};
  const actions=createChatFolderActions({getSettings:()=>settings,updateSettings:patch=>{settings={...settings,...patch};},pushToast(){}});
  actions.reorderChatFolder("c","a");
  assert.deepEqual(settings.chatFolders.filter(f=>f.parentId==="parent").sort((a,b)=>b.sort-a.sort).map(f=>f.id),["c","a","b"]);
  assert.deepEqual(settings.chatFolders.find(f=>f.id==="leaf"),{id:"leaf",parentId:"a",name:"Leaf",sort:4,chatIds:["kept"],scope});
  const before=structuredClone(settings);
  actions.reorderChatFolder("a","leaf");
  assert.deepEqual(settings,before);
});
