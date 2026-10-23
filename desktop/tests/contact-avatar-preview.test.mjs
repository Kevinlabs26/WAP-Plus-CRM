import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { translate } from "../src/i18n/core.ts";

const mocks = {
  react: "export const useState=v=>globalThis.avatarHooks.state(v);export const useRef=v=>globalThis.avatarHooks.ref(v);export const useEffect=(fn,deps)=>globalThis.avatarHooks.effect(fn,deps);",
  "react-dom": "export const createPortal=node=>node;",
  "react/jsx-runtime": "export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;export const Fragment='fragment';",
  "lucide-react": "export const X=()=>null;",
  "@/store/appStore": "export const useAppStore=fn=>fn(globalThis.avatarState);useAppStore.getState=()=>globalThis.avatarState;",
  "@/i18n": "export const useI18n=()=>({t:(key,params)=>globalThis.avatarTranslate(key,params)});",
  "@/components/ui/Avatar": "export const Avatar=()=>null;",
  "@/lib/baileys": "export const baileysFetchAvatar=opts=>globalThis.avatarFetch(opts);",
};
const built=await build({stdin:{contents:`export {ContactAvatar} from './src/components/crm/ContactAvatar.tsx';export {ImagePreviewDialog} from './src/components/chat/ImagePreviewDialog.tsx';`,resolveDir:fileURLToPath(new URL("../",import.meta.url))},
  bundle:true,write:false,platform:"browser",format:"esm",jsx:"automatic",alias:{"@":fileURLToPath(new URL("../src",import.meta.url))},
  plugins:[{name:"avatar-boundaries",setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:"mock"}:undefined);b.onLoad({filter:/.*/,namespace:"mock"},a=>({contents:mocks[a.path]}));}}],
});
const {ContactAvatar,ImagePreviewDialog}=await import("data:text/javascript;base64,"+Buffer.from(built.outputFiles[0].text).toString("base64"));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const preview=tree=>nodes(tree).find(n=>n.type===ImagePreviewDialog);
const contact={id:"customer",name:"Customer",phone:"+12025550100",channelAddress:"12025550100@s.whatsapp.net",accountId:"wa-a",avatarUrl:"small",tags:[],stage:"new"};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

function fixture() {
  const oldWindow=globalThis.window,oldDocument=globalThis.document,cells=[],effects=[],listeners=new Map(),requests=[];
  let cursor=0;
  const trigger={isConnected:true,focus(){globalThis.document.activeElement=this;}};
  globalThis.window={addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
  globalThis.document={body:{},activeElement:trigger};
  globalThis.avatarHooks={state(initial){const i=cursor++;cells[i]??={value:typeof initial==="function"?initial():initial};return[cells[i].value,next=>{cells[i].value=typeof next==="function"?next(cells[i].value):next;}];},
    ref(initial){return cells[cursor++]??={current:initial};},effect(fn,deps){const i=cursor++,previous=cells[i];if(previous&&deps.every((d,j)=>Object.is(d,previous.deps[j])))return;cells[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});}};
  globalThis.avatarTranslate=(key,params)=>translate("zh-CN",key,params);
  globalThis.avatarState={settings:{sendChannel:"baileys",activeAccountId:"wa-wrong",liveBaileysAccountId:"wa-live"}};
  globalThis.avatarFetch=opts=>{const pending=deferred();requests.push({opts,...pending});return pending.promise;};
  return {requests,listeners,trigger,
    render(Component=ContactAvatar,props={contact}){cursor=0;const tree=Component(props);for(const n of nodes(tree))if(n.props.ref)n.props.ref.current={focus(){document.activeElement=this;}};while(effects.length)effects.shift()();return tree;},
    unmount(){for(const c of cells)c?.cleanup?.();},
    close(){this.unmount();globalThis.window=oldWindow;globalThis.document=oldDocument;for(const key of ["avatarHooks","avatarTranslate","avatarState","avatarFetch"])delete globalThis[key];},
  };
}

test("contact avatar opens immediately, fetches HD through the actual thread account and keeps the thumbnail fallback",async()=>{
  const ui=fixture();try {
    let tree=ui.render(ContactAvatar,{contact,accountId:"wa-b"});const button=nodes(tree).find(n=>n.type==="button");
    assert.equal(button.props["aria-label"],"查看 Customer 的头像");button.props.onClick();tree=ui.render(ContactAvatar,{contact,accountId:"wa-b"});
    assert.equal(preview(tree).props.preview.src,"small");assert.equal(preview(tree).props.preview.loading,true);assert.equal(preview(tree).props.className,"z-[220]");
    assert.deepEqual(ui.requests[0].opts,{jid:contact.channelAddress,phone:contact.phone,quality:"image",accountId:"wa-b"});
    ui.requests[0].resolve({avatarFullUrl:"full",avatarUrl:"new-preview"});await flush();tree=ui.render(ContactAvatar,{contact,accountId:"wa-b"});
    assert.equal(preview(tree).props.preview.src,"full");assert.equal(preview(tree).props.preview.fallbackSrc,"small");assert.equal(preview(tree).props.preview.loading,false);
    assert.equal(contact.avatarUrl,"small");
  }finally{ui.close();}
});

test("failed HD requests keep cached pictures and missing/private avatars produce an explicit empty state",async()=>{
  const ui=fixture();try {
    let tree=ui.render();nodes(tree).find(n=>n.type==="button").props.onClick();ui.requests[0].reject(new Error("offline"));await flush();tree=ui.render();
    assert.equal(preview(tree).props.preview.src,"small");assert.equal(preview(tree).props.preview.error,undefined);assert.equal(preview(tree).props.preview.loading,false);
    preview(tree).props.onClose();const missing={...contact,id:"missing",avatarUrl:undefined};tree=ui.render(ContactAvatar,{contact:missing});nodes(tree).find(n=>n.type==="button").props.onClick();
    ui.requests[1].resolve({ok:false});await flush();tree=ui.render(ContactAvatar,{contact:missing});
    assert.equal(preview(tree).props.preview.error,translate("zh-CN","avatar.unavailable"));assert.equal(preview(tree).props.preview.src,"");
  }finally{ui.close();}
});

test("Android uses existing full photos without bridge requests and placeholders without any target are disabled",()=>{
  const ui=fixture();try {
    avatarState.settings.sendChannel="android_bridge";let tree=ui.render(ContactAvatar,{contact:{...contact,avatarFullUrl:"known-full"}});
    nodes(tree).find(n=>n.type==="button").props.onClick();tree=ui.render(ContactAvatar,{contact:{...contact,avatarFullUrl:"known-full"}});
    assert.equal(preview(tree).props.preview.src,"known-full");assert.equal(ui.requests.length,0);
    tree=ui.render(ContactAvatar,{contact:{...contact,avatarUrl:undefined}});assert.equal(nodes(tree).find(n=>n.type==="button").props.disabled,true);
  }finally{ui.close();}
});

test("closing, switching contacts/accounts and unmounting invalidate late photo responses",async()=>{
  for(const scenario of ["close","contact","account","unmount"]) {
    const ui=fixture();try {
      let tree=ui.render();nodes(tree).find(n=>n.type==="button").props.onClick();tree=ui.render();
      let props={contact};
      if(scenario==="close")preview(tree).props.onClose();
      if(scenario==="contact")props={contact:{...contact,id:"another",phone:"+12025550101"}};
      if(scenario==="account")props={contact,accountId:"wa-b"};
      if(scenario==="unmount")ui.unmount();else ui.render(ContactAvatar,props);
      ui.requests[0].resolve({avatarFullUrl:"stale"});await flush();tree=ui.render(ContactAvatar,props);
      assert.notEqual(preview(tree)?.props.preview.src,"stale",scenario);
      if(scenario!=="unmount")assert.equal(preview(tree),undefined,scenario);
    }finally{ui.close();}
  }
});

test("image preview falls back from an expired full photo, handles broken thumbnails and preserves existing message-image use",()=>{
  const ui=fixture();try {
    let props={preview:{src:"full",alt:"Customer",fallbackSrc:"small"},onClose(){},className:"z-[220]"};
    let tree=ui.render(ImagePreviewDialog,props);assert.match(tree.props.className,/z-\[220\]/);let image=nodes(tree).find(n=>n.type==="img");
    assert.equal(image.props.src,"full");image.props.onError();tree=ui.render(ImagePreviewDialog,props);image=nodes(tree).find(n=>n.type==="img");assert.equal(image.props.src,"small");
    image.props.onError();tree=ui.render(ImagePreviewDialog,props);assert.equal(nodes(tree).some(n=>n.type==="img"),false);assert.equal(nodes(tree).find(n=>n.props.role==="status").props.children,"图片无法加载。");
    props={preview:{src:"other-message",alt:"Image"},onClose(){}};tree=ui.render(ImagePreviewDialog,props);assert.equal(nodes(tree).find(n=>n.type==="img").props.src,"other-message");
  }finally{ui.close();}
});

test("same full/thumbnail URL fails once without leaving a broken image, and empty loading states do not request the page as an image",()=>{
  const ui=fixture();try {
    let props={preview:{src:"same",alt:"Customer",fallbackSrc:"same"},onClose(){}};let tree=ui.render(ImagePreviewDialog,props);nodes(tree).find(n=>n.type==="img").props.onError();tree=ui.render(ImagePreviewDialog,props);
    assert.equal(nodes(tree).some(n=>n.type==="img"),false);
    props={preview:{src:"",alt:"Customer",loading:true},onClose(){}};tree=ui.render(ImagePreviewDialog,props);
    assert.equal(nodes(tree).some(n=>n.type==="img"||n.props.role==="status"),false);
    assert.ok(nodes(tree).some(n=>n.props.children===translate("zh-CN","messageBubble.avatarLoading")));
  }finally{ui.close();}
});

test("preview supports bounded zoom, keyboard dismissal, focus trapping/restoration and backdrop dismissal",()=>{
  const ui=fixture();try {
    let closes=0;const props={preview:{src:"image",alt:"Customer"},onClose(){closes++;}};
    let tree=ui.render(ImagePreviewDialog,props);assert.notEqual(document.activeElement,ui.trigger);
    const tab={key:"Tab",preventDefault(){this.prevented=true;}};ui.listeners.get("keydown")(tab);assert.equal(tab.prevented,true);
    for(let i=0;i<30;i++)tree.props.onWheel({deltaY:-1,preventDefault(){}});tree=ui.render(ImagePreviewDialog,props);assert.equal(nodes(tree).find(n=>n.type==="img").props.style.transform,"scale(4)");
    for(let i=0;i<40;i++)tree.props.onWheel({deltaY:1,preventDefault(){}});tree=ui.render(ImagePreviewDialog,props);assert.equal(nodes(tree).find(n=>n.type==="img").props.style.transform,"scale(0.5)");
    ui.listeners.get("keydown")({key:"Escape",preventDefault(){}});assert.equal(closes,1);tree.props.onClick();assert.equal(closes,2);
    ui.unmount();assert.equal(document.activeElement,ui.trigger);assert.equal(ui.listeners.size,0);
  }finally{ui.close();}
});
