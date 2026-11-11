use super::{valid_app_id, valid_client_name, CloneApp};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use windows::{
    core::{Interface, BSTR, GUID, HSTRING, PCWSTR, PWSTR},
    Data::Xml::Dom::XmlDocument,
    Management::Deployment::PackageManager,
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM},
        Storage::{EnhancedStorage::PKEY_AppUserModel_ID, Packaging::Appx::GetPackageFamilyName},
        System::{
            Com::{
                CoAllowSetForegroundWindow, CoCreateInstance, CoTaskMemFree,
                StructuredStorage::{PropVariantClear, PropVariantToStringAlloc},
                CLSCTX_ALL,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
            Variant::VARIANT,
            WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        },
        UI::{
            Accessibility::*,
            Notifications::INotificationActivationCallback,
            Shell::{
                ApplicationActivationManager, IApplicationActivationManager,
                PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow},
                AO_NONE,
            },
            WindowsAndMessaging::*,
        },
    },
};

struct Apartment;
impl Apartment {
    fn new() -> Result<Self, String> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|e| e.to_string())?;
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            RoUninitialize();
        }
    }
}

pub fn apps() -> Result<Vec<CloneApp>, String> {
    find_apps(None)
}

pub fn installed_app(id: &str) -> Result<CloneApp, String> {
    if !valid_app_id(id) {
        return Err("无效的 WhatsApp 客户端".into());
    }
    find_apps(Some(id.split_once('!').unwrap().0))?
        .into_iter()
        .find(|app| app.app_id == id)
        .ok_or_else(|| "绑定的客户端已卸载或不可用，请重新选择".into())
}

fn find_apps(family: Option<&str>) -> Result<Vec<CloneApp>, String> {
    let _apartment = Apartment::new()?;
    let packages = PackageManager::new()
        .and_then(|manager| match family {
            Some(family) => manager.FindPackagesByUserSecurityIdPackageFamilyName(
                &HSTRING::new(),
                &HSTRING::from(family),
            ),
            None => manager.FindPackagesByUserSecurityId(&HSTRING::new()),
        })
        .map_err(|e| format!("无法读取本机 WhatsApp 客户端：{e}"))?;
    let mut out = Vec::new();
    for package in packages {
        let Ok(id) = package.Id() else {
            continue;
        };
        let Ok(name) = id.Name() else {
            continue;
        };
        if !valid_client_name(&name.to_string_lossy()) {
            continue;
        }
        let entries = package
            .GetAppListEntriesAsync()
            .and_then(|op| op.get())
            .map_err(|e| format!("无法读取客户端启动入口：{e}"))?;
        for entry in entries {
            let app_id = entry
                .AppUserModelId()
                .map_err(|e| e.to_string())?
                .to_string_lossy();
            if !valid_app_id(&app_id) {
                continue;
            }
            let display = entry
                .DisplayInfo()
                .and_then(|info| info.DisplayName())
                .map(|v| v.to_string_lossy())
                .unwrap_or_else(|_| name.to_string_lossy());
            out.push(CloneApp {
                app_id,
                name: display,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

unsafe fn activate(id: &str) -> Result<(), String> {
    let manager: IApplicationActivationManager =
        CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_ALL)
            .map_err(|e| e.to_string())?;
    manager
        .ActivateApplication(&HSTRING::from(id), PCWSTR::null(), AO_NONE)
        .map_err(|e| format!("无法启动绑定的客户端：{e}"))?;
    Ok(())
}

pub fn open(id: &str) -> Result<(), String> {
    let _apartment = Apartment::new()?;
    unsafe { activate(id) }
}

pub fn open_call_link(id: &str, url: &str) -> Result<(), String> {
    let _apartment = Apartment::new()?;
    let args = super::call_link_activation_args(url)?;
    let activator = call_link_activator(id)?;
    unsafe {
        // The client's own call-link action also works for clones without protocol registration.
        let callback: INotificationActivationCallback = CoCreateInstance(&activator, None, CLSCTX_ALL)
            .map_err(|e| format!("无法启动绑定客户端：{e}"))?;
        let _ = CoAllowSetForegroundWindow(&callback, None);
        callback.Activate(&HSTRING::from(id), &HSTRING::from(args), &[])
            .map_err(|e| format!("无法将通话链接交给绑定客户端：{e}"))?;
        Ok(())
    }
}

fn call_link_activator(id: &str) -> Result<GUID, String> {
    use std::io::Read;
    if !valid_app_id(id) { return Err("无效的 WhatsApp 客户端".into()); }
    let (family, entry) = id.split_once('!').ok_or("无效的客户端入口")?;
    let packages = PackageManager::new()
        .and_then(|manager| manager.FindPackagesByUserSecurityIdPackageFamilyName(&HSTRING::new(), &HSTRING::from(family)))
        .map_err(|e| e.to_string())?;
    for package in packages {
        let path = package.InstalledPath().map_err(|e| e.to_string())?;
        let file = std::fs::File::open(std::path::Path::new(&path.to_string_lossy()).join("AppxManifest.xml"))
            .map_err(|e| e.to_string())?;
        let mut xml = String::new();
        file.take(256 * 1024 + 1).read_to_string(&mut xml).map_err(|e| e.to_string())?;
        if xml.len() > 256 * 1024 { return Err("客户端清单过大".into()); }
        return call_link_activator_from_manifest(&xml, entry);
    }
    Err("绑定的客户端已卸载或不可用".into())
}

fn call_link_activator_from_manifest(xml: &str, entry: &str) -> Result<GUID, String> {
    let document = XmlDocument::new().map_err(|e| e.to_string())?;
    document.LoadXml(&HSTRING::from(xml)).map_err(|e| e.to_string())?;
    let selector = format!("//*[local-name()='Application' and @Id='{entry}']/*[local-name()='Extensions']/*[local-name()='Extension']/*[local-name()='ToastNotificationActivation']/@ToastActivatorCLSID");
    let value = document.SelectSingleNode(&HSTRING::from(selector))
        .and_then(|node| node.InnerText()).map_err(|_| "客户端不支持直接打开通话链接".to_string())?;
    GUID::try_from(value.to_string_lossy().as_str()).map_err(|_| "客户端激活入口无效".into())
}

unsafe fn process_family(pid: u32) -> Option<String> {
    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut name = [0u16; 256];
    let mut len = name.len() as u32;
    let result = GetPackageFamilyName(process, &mut len, Some(PWSTR(name.as_mut_ptr())));
    let _ = CloseHandle(process);
    if result.is_err() || len == 0 || len as usize > name.len() {
        return None;
    }
    Some(String::from_utf16_lossy(&name[..len as usize - 1]))
}

unsafe extern "system" fn enumerate(hwnd: HWND, data: LPARAM) -> windows::core::BOOL {
    let (family, windows) = &mut *(data.0 as *mut (String, Vec<HWND>));
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if IsWindowVisible(hwnd).as_bool()
        && (process_family(pid).as_deref() == Some(family.as_str())
            || window_app_id(hwnd).is_some_and(|id| id.starts_with(&format!("{family}!"))))
    {
        windows.push(hwnd);
    }
    true.into()
}

// Hosted windows may belong to a shell process; their shell app identity still identifies the clone.
unsafe fn window_app_id(hwnd: HWND) -> Option<String> {
    let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
    let mut value = store.GetValue(&PKEY_AppUserModel_ID).ok()?;
    let text = PropVariantToStringAlloc(&value);
    let _ = PropVariantClear(&mut value);
    let text = text.ok()?;
    let result = text.to_string().ok();
    CoTaskMemFree(Some(text.0.cast()));
    result
}

unsafe fn client_windows(family: &str, prefer_content: bool) -> Result<Vec<HWND>, String> {
    let mut matches = (family.to_string(), Vec::<HWND>::new());
    EnumWindows(Some(enumerate), LPARAM(&mut matches as *mut _ as isize))
        .map_err(|e| e.to_string())?;
    // Account/profile pages belong to the WinUI host, alongside the chat WebView.
    let mut hosts = Vec::new();
    let mut content = Vec::new();
    for hwnd in &matches.1 {
        let mut pid = 0;
        GetWindowThreadProcessId(*hwnd, Some(&mut pid));
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            continue;
        };
        let mut path = [0u16; 1024];
        let mut length = path.len() as u32;
        let read = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(path.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        if read.is_ok() {
            let path = String::from_utf16_lossy(&path[..length as usize]).to_ascii_lowercase();
            if path.ends_with("\\whatsapp.root.exe") {
                hosts.push(*hwnd);
            } else if path.ends_with("\\msedgewebview2.exe") {
                content.push(*hwnd);
            }
        }
    }
    Ok(if prefer_content && !content.is_empty() {
        content
    } else if !hosts.is_empty() {
        hosts
    } else if !content.is_empty() {
        content
    } else {
        matches.1
    })
}

unsafe fn window(family: &str) -> Result<HWND, String> {
    let matches = client_windows(family, false)?;
    if matches.len() != 1 {
        return Err("客户端窗口尚未就绪，或已有通话窗口；请先在客户端内确认".into());
    }
    Ok(matches[0])
}

unsafe fn chat_window(family: &str) -> Result<HWND, String> {
    let matches = client_windows(family, true)?;
    if matches.len() != 1 {
        return Err("无法唯一识别客户端聊天窗口，未拨号".into());
    }
    Ok(matches[0])
}

// Do not strip arbitrary letters/JIDs into phone numbers or accept partial matches.
fn displayed_phone(value: &str) -> Option<String> {
    let phone: String = value
        .chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, '-' | '(' | ')' | '\u{200e}' | '\u{200f}'))
        .collect();
    super::valid_phone(&phone).then_some(phone)
}

struct Ui<'a> {
    automation: IUIAutomation,
    hwnd: HWND,
    deadline: Instant,
    cancelled: &'a AtomicBool,
    chat: bool,
}
fn check_request(deadline: Instant, cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        Err("已取消呼叫准备".into())
    } else if Instant::now() >= deadline {
        Err("客户端操作超时，未发起呼叫，请重试".into())
    } else {
        Ok(())
    }
}
fn toggle_required(state: ToggleState) -> Result<bool, String> {
    if state == ToggleState_Off {
        Ok(true)
    } else if state == ToggleState_On {
        Ok(false)
    } else {
        Err("客户端开关状态不明确，已停止自动操作".into())
    }
}
// The old chat-list search remains exposed behind the new-chat panel.
const CONTACT_SEARCH_NAMES: &[&str] = &[
    "搜索姓名、电话号码或 @账号",
    "搜索姓名或号码",
    "搜索联系人",
    "搜索",
    "Search name, phone number or @username",
    "Search name or number",
    "Search contacts",
    "Search",
    "Rechercher un nom ou un numéro",
    "Rechercher des contacts",
    "Rechercher",
];
const NEW_CHAT_NAMES: &[&str] = &["新聊天", "New chat", "Nouvelle discussion"];
const VOICE_CALL_NAMES: &[&str] = &[
    "语音通话",
    "语音呼叫",
    "Voice call",
    "Audio call",
    "Appel vocal",
    "Appel audio",
];

fn unique_search_result(
    matches: &[bool],
    settled: bool,
    timed_out: bool,
) -> Result<Option<usize>, String> {
    if matches.len() > 1 && timed_out {
        return Err("搜索结果不唯一，未拨号".into());
    }
    Ok((matches.len() == 1 && (matches[0] || settled)).then_some(0))
}

fn contact_result_index(path: &[UIA_CONTROLTYPE_ID]) -> Option<usize> {
    // Search text is not a contact; nested button/row aliases belong to one outer action.
    if path.contains(&UIA_EditControlTypeId) {
        return None;
    }
    path.iter()
        .rposition(|kind| *kind == UIA_ButtonControlTypeId)
        .or_else(|| {
            path.iter().rposition(|kind| {
                *kind == UIA_ListItemControlTypeId || *kind == UIA_DataItemControlTypeId
            })
        })
}

fn normalized_label(value: &str) -> String {
    value
        .replace(['\u{200e}', '\u{200f}'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn header_contact_label(value: &str) -> &str {
    // The native title includes status text and, for business contacts, an account badge.
    let value = value
        .split_once(" 最后上线时间：")
        .map_or(value, |(label, _)| label);
    [
        " 点击此处查看联系人信息",
        " 点击此处查看商家信息",
        " 点击此处查看企业信息",
        " 点击此处查看商业帐号信息",
        " 业务账户",
    ]
    .iter()
    .find_map(|suffix| value.strip_suffix(suffix))
    .unwrap_or(value)
}

fn header_label_matches(value: &str, selected_label: &str, recipient: &str) -> bool {
    let value = normalized_label(value);
    let label = header_contact_label(&value);
    if let Some(phone) = displayed_phone(label) {
        return phone == recipient;
    }
    !label.is_empty() && label == normalized_label(selected_label)
}

fn chat_call_index(matches: &[bool]) -> Result<usize, String> {
    if matches.is_empty() {
        return Err("未找到语音通话按钮，请确认联系人支持通话且聊天已打开".into());
    }
    let mut matched = matches
        .iter()
        .enumerate()
        .filter_map(|(index, matched)| matched.then_some(index));
    let index = matched
        .next()
        .ok_or("聊天标题与选中的联系人不一致或尚未就绪，未拨号")?;
    if matched.next().is_some() {
        return Err("当前聊天的语音通话按钮不唯一，未拨号".into());
    }
    Ok(index)
}

impl Ui<'_> {
    unsafe fn root(&self) -> Result<IUIAutomationElement, String> {
        self.check()?;
        let root = self
            .automation
            .ElementFromHandle(self.hwnd)
            .map_err(|e| e.to_string())?;
        if self.chat {
            // Limit chat queries to one fresh document instead of the native host's repeated WebView tree.
            let kind = self
                .automation
                .CreatePropertyCondition(
                    UIA_ControlTypePropertyId,
                    &VARIANT::from(UIA_DocumentControlTypeId.0),
                )
                .map_err(|e| e.to_string())?;
            let visible = self
                .automation
                .CreatePropertyCondition(UIA_IsOffscreenPropertyId, &VARIANT::from(false))
                .map_err(|e| e.to_string())?;
            let condition = self
                .automation
                .CreateAndCondition(&kind, &visible)
                .map_err(|e| e.to_string())?;
            if let Ok(document) = root.FindFirst(TreeScope_Descendants, &condition) {
                return Ok(document);
            }
        }
        Ok(root)
    }
    fn check(&self) -> Result<(), String> {
        check_request(self.deadline, self.cancelled)
    }
    unsafe fn descendants(
        &self,
        root: &IUIAutomationElement,
    ) -> Result<Vec<IUIAutomationElement>, String> {
        self.read_descendants(root, true)
    }
    unsafe fn read_descendants(
        &self,
        root: &IUIAutomationElement,
        visible_only: bool,
    ) -> Result<Vec<IUIAutomationElement>, String> {
        self.check()?;
        let control = self
            .automation
            .ControlViewCondition()
            .map_err(|e| e.to_string())?;
        let visible = self
            .automation
            .CreatePropertyCondition(UIA_IsOffscreenPropertyId, &VARIANT::from(false))
            .map_err(|e| e.to_string())?;
        let condition = if visible_only {
            self.automation
                .CreateAndCondition(&control, &visible)
                .map_err(|e| e.to_string())?
        } else {
            control
        };
        let cache = self
            .automation
            .CreateCacheRequest()
            .map_err(|e| e.to_string())?;
        cache
            .SetTreeScope(TreeScope_Element)
            .map_err(|e| e.to_string())?;
        cache
            .SetAutomationElementMode(AutomationElementMode_Full)
            .map_err(|e| e.to_string())?;
        for property in [
            UIA_NamePropertyId,
            UIA_ControlTypePropertyId,
            UIA_IsOffscreenPropertyId,
        ] {
            cache.AddProperty(property).map_err(|e| e.to_string())?;
        }
        // Fetch a fresh snapshot in one provider call instead of reading each property across processes.
        let items = root
            .FindAllBuildCache(TreeScope_Descendants, &condition, &cache)
            .map_err(|_| "无法读取客户端控件，请在原生窗口操作")?;
        let count = items.Length().map_err(|e| e.to_string())?;
        if count > 2500 {
            return Err("客户端界面过于复杂，已停止自动操作".into());
        }
        let mut result = Vec::new();
        for i in 0..count {
            self.check()?;
            let item = items.GetElement(i).map_err(|e| e.to_string())?;
            result.push(item);
        }
        Ok(result)
    }
    unsafe fn named(
        &self,
        names: &[&str],
        types: &[UIA_CONTROLTYPE_ID],
    ) -> Result<IUIAutomationElement, String> {
        self.find_named(names, types, true)
    }
    unsafe fn find_named(
        &self,
        names: &[&str],
        types: &[UIA_CONTROLTYPE_ID],
        visible_only: bool,
    ) -> Result<IUIAutomationElement, String> {
        let mut result = self.named_candidates(names, types, visible_only)?;
        if result.len() != 1 {
            return Err(format!(
                "未找到唯一的“{}”控件，未拨号；请确认客户端已登录",
                names[0]
            ));
        }
        Ok(result.remove(0))
    }
    unsafe fn named_candidates(
        &self,
        names: &[&str],
        types: &[UIA_CONTROLTYPE_ID],
        visible_only: bool,
    ) -> Result<Vec<IUIAutomationElement>, String> {
        self.check()?;
        let name_conditions = names
            .iter()
            .map(|name| {
                self.automation
                    .CreatePropertyCondition(UIA_NamePropertyId, &VARIANT::from(*name))
                    .map(Some)
            })
            .collect::<windows::core::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        let types = types
            .iter()
            .map(|kind| {
                self.automation
                    .CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(kind.0))
                    .map(Some)
            })
            .collect::<windows::core::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        let name_condition = if name_conditions.len() == 1 {
            name_conditions[0].as_ref().unwrap().clone()
        } else {
            self.automation
                .CreateOrConditionFromNativeArray(&name_conditions)
                .map_err(|e| e.to_string())?
        };
        let type_condition = if types.len() == 1 {
            types[0].as_ref().unwrap().clone()
        } else {
            self.automation
                .CreateOrConditionFromNativeArray(&types)
                .map_err(|e| e.to_string())?
        };
        let visible = self
            .automation
            .CreatePropertyCondition(UIA_IsOffscreenPropertyId, &VARIANT::from(false))
            .map_err(|e| e.to_string())?;
        let mut conditions = vec![Some(name_condition), Some(type_condition)];
        if visible_only {
            conditions.push(Some(visible));
        }
        let condition = self
            .automation
            .CreateAndConditionFromNativeArray(&conditions)
            .map_err(|e| e.to_string())?;
        // Query only the requested control on a fresh page root, not the entire changing WebView tree.
        let items = self
            .root()?
            .FindAll(TreeScope_Descendants, &condition)
            .map_err(|e| e.to_string())?;
        let count = items.Length().map_err(|e| e.to_string())?;
        if count > 256 {
            return Err("目标控件重复过多，请等页面加载完成后重试".into());
        }
        let mut result = Vec::new();
        for index in 0..count {
            self.check()?;
            let node = items.GetElement(index).map_err(|e| e.to_string())?;
            if !result.iter().any(|other| {
                self.automation
                    .CompareElements(other, &node)
                    .map(|v| v.as_bool())
                    .unwrap_or(false)
            }) {
                result.push(node);
            }
        }
        Ok(result)
    }
    unsafe fn wait_named(
        &self,
        names: &[&str],
        types: &[UIA_CONTROLTYPE_ID],
    ) -> Result<IUIAutomationElement, String> {
        let until = self.deadline.min(Instant::now() + Duration::from_secs(5));
        loop {
            self.check()?;
            match self.named(names, types) {
                Ok(node) => return Ok(node),
                Err(error) if Instant::now() >= until => return Err(error),
                Err(_) => std::thread::sleep(Duration::from_millis(100)),
            }
        }
    }
    unsafe fn invoke(&self, element: &IUIAutomationElement) -> Result<(), String> {
        self.check()?;
        if !element
            .CurrentIsEnabled()
            .map(|v| v.as_bool())
            .unwrap_or(false)
        {
            return Err("客户端控件不可用，请检查登录或正在进行的通话".into());
        }
        let error = |error: windows::core::Error| {
            format!(
                "无法操作“{}”：{error}；未重试，请查看客户端",
                element
                    .CurrentName()
                    .map(|v| v.to_string())
                    .unwrap_or_default()
            )
        };
        if let Ok(pattern) =
            element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
        {
            return pattern.Invoke().map_err(error);
        }
        // Profile/navigation entries are toggles; selecting an already open one must not close it.
        if let Ok(pattern) =
            element.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
        {
            let state = pattern.CurrentToggleState().map_err(error)?;
            if toggle_required(state)? {
                pattern.Toggle().map_err(error)?;
                eprintln!(
                    "[voice-call] toggle {state:?} -> {:?}",
                    pattern.CurrentToggleState()
                );
            }
            return Ok(());
        }
        if let Ok(pattern) = element
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
        {
            return pattern.Select().map_err(error);
        }
        element
            .GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(
                UIA_LegacyIAccessiblePatternId,
            )
            .and_then(|p| p.DoDefaultAction())
            .map_err(error)
    }
    unsafe fn phone_label(&self, labels: &[&str]) -> Result<IUIAutomationElement, String> {
        self.find_named(labels, &[UIA_TextControlTypeId], false)
            .or_else(|_| {
                self.find_named(
                    labels,
                    &[UIA_HeaderControlTypeId, UIA_GroupControlTypeId],
                    false,
                )
            })
    }
    unsafe fn profile_navigation(&self) -> Result<IUIAutomationElement, String> {
        // These aliases can coexist as different buttons; prefer the account navigation entry.
        for name in [
            "自己",
            "个人主页",
            "Profile",
            "Profil",
            "You",
            "Vous",
            "查看个人主页",
            "个人资料",
            "个人信息",
        ] {
            if let Ok(node) = self.named(&[name], &[UIA_ButtonControlTypeId]) {
                return Ok(node);
            }
        }
        Err("个人资料入口尚未就绪，请确认绑定的客户端已登录".into())
    }
    unsafe fn phone_field(&self, labels: &[&str], expected: &str) -> Result<(), String> {
        let until = self.deadline.min(Instant::now() + Duration::from_secs(5));
        let label = loop {
            self.check()?;
            match self.phone_label(labels) {
                Ok(label) => break label,
                Err(error) if Instant::now() >= until => return Err(error),
                Err(_) => std::thread::sleep(Duration::from_millis(100)),
            }
        };
        let walker = self.automation.RawViewWalker().map_err(|e| e.to_string())?;
        let mut field = label;
        // Restrict evidence to the labelled field, never the whole chat/transcript.
        for _ in 0..4 {
            field = walker.GetParentElement(&field).map_err(|e| e.to_string())?;
            if self
                .automation
                .CompareElements(&field, &self.root()?)
                .map(|same| same.as_bool())
                .unwrap_or(true)
            {
                break;
            }
            let nodes = self.read_descendants(&field, false)?;
            if nodes.len() > 12 {
                break;
            }
            let mut phones = Vec::new();
            for node in nodes {
                if let Ok(name) = node.CachedName() {
                    if let Some(phone) = displayed_phone(&name.to_string()) {
                        phones.push(phone);
                    }
                }
                if let Ok(value) = node
                    .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    .and_then(|p| p.CurrentValue())
                {
                    if let Some(phone) = displayed_phone(&value.to_string()) {
                        phones.push(phone);
                    }
                }
            }
            if phones.is_empty() {
                continue;
            }
            if phones.iter().any(|phone| phone != expected) {
                return Err("客户端登录账号与当前账号不一致，核对未通过".into());
            }
            return Ok(());
        }
        Err("无法读取客户端账号的手机号，核对未通过".into())
    }
    unsafe fn contact_search(
        &self,
    ) -> Result<(IUIAutomationElement, IUIAutomationElement), String> {
        let title = self.named(
            NEW_CHAT_NAMES,
            &[UIA_TextControlTypeId, UIA_HeaderControlTypeId],
        )?;
        let walker = self.automation.RawViewWalker().map_err(|e| e.to_string())?;
        let mut panel = title;
        for _ in 0..10 {
            panel = walker.GetParentElement(&panel).map_err(|e| e.to_string())?;
            if self
                .automation
                .CompareElements(&panel, &self.root()?)
                .map(|v| v.as_bool())
                .unwrap_or(true)
            {
                break;
            }
            let nodes = self.descendants(&panel)?;
            let mut edits: Vec<IUIAutomationElement> = Vec::new();
            for node in nodes {
                if node.CachedControlType().ok() == Some(UIA_EditControlTypeId)
                    && !edits.iter().any(|other| {
                        self.automation
                            .CompareElements(other, &node)
                            .map(|v| v.as_bool())
                            .unwrap_or(false)
                    })
                {
                    edits.push(node);
                }
            }
            if edits.len() > 1 {
                break;
            }
            if let Some(search) = edits.pop() {
                let name = search.CurrentName().map_err(|e| e.to_string())?.to_string();
                // The placeholder/accessibility name disappears once the input contains a query.
                if name.is_empty() || CONTACT_SEARCH_NAMES.contains(&name.as_str()) {
                    return Ok((panel, search));
                }
                break;
            }
        }
        Err("无法确认新聊天搜索面板，未拨号".into())
    }
    unsafe fn search_results(
        &self,
        panel: &IUIAutomationElement,
        recipient: &str,
    ) -> Result<Vec<(IUIAutomationElement, bool)>, String> {
        let walker = self.automation.RawViewWalker().map_err(|e| e.to_string())?;
        let mut results: Vec<(IUIAutomationElement, bool)> = Vec::new();
        for node in self.descendants(panel)? {
            let kind = node.CachedControlType().map_err(|e| e.to_string())?;
            let exact =
                displayed_phone(&node.CachedName().map(|v| v.to_string()).unwrap_or_default())
                    .as_deref()
                    == Some(recipient);
            let row = kind == UIA_ListItemControlTypeId || kind == UIA_DataItemControlTypeId;
            if !exact && !row {
                continue;
            }
            let mut target = node;
            let mut path = Vec::new();
            let mut kinds = Vec::new();
            let mut reached_panel = false;
            for _ in 0..16 {
                if self
                    .automation
                    .CompareElements(&target, panel)
                    .map(|v| v.as_bool())
                    .unwrap_or(true)
                {
                    reached_panel = true;
                    break;
                }
                kinds.push(target.CurrentControlType().map_err(|e| e.to_string())?);
                path.push(target.clone());
                target = walker
                    .GetParentElement(&target)
                    .map_err(|e| e.to_string())?;
            }
            if !reached_panel {
                return Err("无法确认搜索结果所属面板，未拨号".into());
            }
            let Some(index) = contact_result_index(&kinds) else {
                continue;
            };
            let target = path.swap_remove(index);
            if let Some(existing) = results.iter_mut().find(|(other, _)| {
                self.automation
                    .CompareElements(other, &target)
                    .map(|v| v.as_bool())
                    .unwrap_or(false)
            }) {
                existing.1 |= exact;
            } else {
                results.push((target, exact));
            }
        }
        Ok(results)
    }
    unsafe fn contact_result_label(&self, result: &IUIAutomationElement) -> Result<String, String> {
        let mut labels = Vec::new();
        for node in self.descendants(result)? {
            if node
                .CachedControlType()
                .map(|kind| kind == UIA_DataItemControlTypeId || kind == UIA_ListItemControlTypeId)
                .unwrap_or(false)
            {
                let label =
                    normalized_label(&node.CachedName().map_err(|e| e.to_string())?.to_string());
                if !label.is_empty() && !labels.contains(&label) {
                    labels.push(label);
                }
            }
        }
        if labels.len() == 1 {
            return Ok(labels.remove(0));
        }
        if labels.is_empty() {
            let label =
                normalized_label(&result.CurrentName().map_err(|e| e.to_string())?.to_string());
            if !label.is_empty() {
                return Ok(label);
            }
        }
        Err("无法确认搜索结果的联系人名称，未拨号".into())
    }
    unsafe fn contact_result_action(
        &self,
        result: &IUIAutomationElement,
    ) -> Result<IUIAutomationElement, String> {
        self.check()?;
        let walker = self.automation.RawViewWalker().map_err(|e| e.to_string())?;
        // Chrome exposes a wrapper button; the nested row owns the actual click handler.
        if let Ok(row) = walker.GetFirstChildElement(result) {
            if row.CurrentControlType().ok() == Some(UIA_GroupControlTypeId)
                && row
                    .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                    .is_ok()
            {
                return Ok(row);
            }
        }
        Ok(result.clone())
    }
    unsafe fn verify_chat_header(
        &self,
        call: &IUIAutomationElement,
        recipient: &str,
        selected_label: &str,
    ) -> Result<(), String> {
        let walker = self.automation.RawViewWalker().map_err(|e| e.to_string())?;
        let mut header = call.clone();
        for _ in 0..10 {
            header = walker
                .GetParentElement(&header)
                .map_err(|e| e.to_string())?;
            if self
                .automation
                .CompareElements(&header, &self.root()?)
                .map(|v| v.as_bool())
                .unwrap_or(true)
            {
                break;
            }
            let nodes = match self.descendants(&header) {
                Ok(nodes) => nodes,
                Err(_) => {
                    self.check()?;
                    break;
                }
            };
            if nodes.len() > 80
                || nodes.iter().any(|node| {
                    node.CachedControlType()
                        .map(|t| {
                            t == UIA_EditControlTypeId
                                || t == UIA_ListControlTypeId
                                || t == UIA_ListItemControlTypeId
                                || t == UIA_DataItemControlTypeId
                        })
                        .unwrap_or(true)
                })
            {
                break;
            }
            if nodes.iter().any(|node| {
                !self
                    .automation
                    .CompareElements(node, call)
                    .map(|same| same.as_bool())
                    .unwrap_or(true)
                    && node
                        .CachedControlType()
                        .map(|kind| {
                            kind == UIA_ButtonControlTypeId
                                || kind == UIA_TextControlTypeId
                                || kind == UIA_HeaderControlTypeId
                        })
                        .unwrap_or(false)
                    && node
                        .CachedName()
                        .map(|name| {
                            header_label_matches(&name.to_string(), selected_label, recipient)
                        })
                        .unwrap_or(false)
            }) {
                return Ok(());
            }
        }
        Err("聊天标题与选中的联系人不一致或尚未就绪，未拨号".into())
    }
    unsafe fn wait_chat_header(
        &self,
        recipient: &str,
        selected_label: &str,
    ) -> Result<IUIAutomationElement, String> {
        let until = self.deadline.min(Instant::now() + Duration::from_secs(5));
        loop {
            self.check()?;
            // The previous chat's call button can remain visible while React switches the header.
            match self.chat_call(recipient, selected_label) {
                Ok(call) => return Ok(call),
                Err(error) if Instant::now() >= until => return Err(error),
                Err(_) => {}
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    unsafe fn chat_call(
        &self,
        recipient: &str,
        selected_label: &str,
    ) -> Result<IUIAutomationElement, String> {
        let mut calls = self.named_candidates(
            VOICE_CALL_NAMES,
            &[UIA_ButtonControlTypeId, UIA_MenuItemControlTypeId],
            true,
        )?;
        // History and business layouts may expose other calls; only the verified chat header qualifies.
        let matches: Vec<_> = calls
            .iter()
            .map(|call| {
                self.verify_chat_header(call, recipient, selected_label)
                    .is_ok()
            })
            .collect();
        Ok(calls.remove(chat_call_index(&matches)?))
    }
}

fn connect_client<'a>(id: &str, cancelled: &'a AtomicBool) -> Result<(Apartment, Ui<'a>), String> {
    let apartment = Apartment::new()?;
    unsafe {
        if cancelled.load(Ordering::SeqCst) {
            return Err("已取消呼叫准备".into());
        }
        activate(id)?;

        let family = id.split_once('!').ok_or("无效实例")?.0;
        let deadline = Instant::now() + Duration::from_secs(60);
        let hwnd = loop {
            if cancelled.load(Ordering::SeqCst) {
                return Err("已取消呼叫准备".into());
            }
            if let Ok(hwnd) = window(family) {
                break hwnd;
            }
            if Instant::now() >= deadline {
                return Err("客户端窗口未就绪，请登录后重试".into());
            }
            std::thread::sleep(Duration::from_millis(200));
        };
        let _ = ShowWindow(hwnd, SW_RESTORE);
        let _ = SetForegroundWindow(hwnd);
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation8, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let config: IUIAutomation2 = automation.cast().map_err(|e| e.to_string())?;
        config
            .SetConnectionTimeout(1500)
            .map_err(|e| e.to_string())?;
        config
            .SetTransactionTimeout(1500)
            .map_err(|e| e.to_string())?;
        Ok((
            apartment,
            Ui {
                automation,
                hwnd,
                deadline,
                cancelled,
                chat: false,
            },
        ))
    }
}

pub fn verify_owner(id: &str, owner: &str) -> Result<(), String> {
    let cancelled = AtomicBool::new(false);
    let (_apartment, ui) = connect_client(id, &cancelled)?;
    unsafe {
        let phone_labels = ["电话号码", "手机号", "Phone number", "Numéro de téléphone"];
        let until = ui.deadline.min(Instant::now() + Duration::from_secs(5));
        let navigation = loop {
            ui.check()?;
            match ui.profile_navigation() {
                Ok(node) => break node,
                Err(error) if Instant::now() >= until => return Err(error),
                Err(_) => std::thread::sleep(Duration::from_millis(100)),
            }
        };
        ui.invoke(&navigation)?;
        let until = ui.deadline.min(Instant::now() + Duration::from_secs(5));
        let mut opened_entry = false;
        loop {
            ui.check()?;
            if ui.phone_label(&phone_labels).is_ok() {
                break;
            }
            if !opened_entry {
                for name in [
                    "查看个人主页",
                    "个人主页 姓名、头像、用户名",
                    "个人主页",
                    "Profile Name, photo, username",
                    "Profile",
                    "Profil",
                ] {
                    if let Ok(entry) = ui.named(&[name], &[UIA_ButtonControlTypeId]) {
                        ui.invoke(&entry)?;
                        opened_entry = true;
                        break;
                    }
                }
            }
            if Instant::now() >= until {
                return Err("个人资料手机号尚未加载，请稍后重新核对".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        ui.phone_field(&phone_labels, owner)?;

        let back = ui
            .named(
                &["对话", "聊天", "Chats", "Discussions"],
                &[UIA_ButtonControlTypeId],
            )
            .or_else(|_| ui.wait_named(&["返回", "Back", "Retour"], &[UIA_ButtonControlTypeId]))?;
        ui.invoke(&back)?;
    }
    Ok(())
}

pub fn call(id: &str, recipient: &str, cancelled: &AtomicBool) -> Result<(), String> {
    let started = Instant::now();
    #[cfg(debug_assertions)]
    let timing_file = std::cell::RefCell::new(
        std::fs::File::create(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/.codex-call-timing.log"
        ))
        .ok(),
    );
    let stage = std::cell::Cell::new("打开客户端");
    let mark = |value: &'static str| {
        stage.set(value);
        let elapsed = started.elapsed().as_millis();
        eprintln!("[voice-call] {value} elapsed_ms={elapsed}");
        #[cfg(debug_assertions)]
        if let Some(file) = timing_file.borrow_mut().as_mut() {
            use std::io::Write;
            let _ = writeln!(file, "{value} elapsed_ms={elapsed}");
        }
    };
    let result = (|| {
        let (_apartment, mut ui) = connect_client(id, cancelled)?;
        let family = id.split_once('!').ok_or("无效实例")?.0;
        let hwnd = ui.hwnd;
        unsafe {
            // Chat controls live in the WebView; the native host can repeat that tree many times.
            ui.hwnd = chat_window(family)?;
            ui.chat = true;
            mark("检查当前聊天");
            if let Ok(call) = ui.chat_call(recipient, "") {
                // Only a visible full phone number qualifies; a saved nickname still uses number search.
                if window(family)? != hwnd || chat_window(family)? != ui.hwnd {
                    return Err("客户端窗口已改变，未拨号".into());
                }
                mark("直接发起语音通话");
                return ui.invoke(&call);
            }
            mark("打开联系人搜索");
            ui.invoke(&ui.wait_named(NEW_CHAT_NAMES, &[UIA_ButtonControlTypeId])?)?;
            let until = ui.deadline.min(Instant::now() + Duration::from_secs(5));
            let search = loop {
                ui.check()?;
                match ui.contact_search() {
                    Ok((_, search)) => break search,
                    Err(error) if Instant::now() >= until => return Err(error),
                    Err(_) => std::thread::sleep(Duration::from_millis(100)),
                }
            };
            ui.check()?;
            mark("填写联系人号码");
            search
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .and_then(|p| p.SetValue(&BSTR::from(recipient)))
                .map_err(|_| "无法填写联系人搜索，未拨号")?;
            mark("查找目标联系人");
            let search_started = Instant::now();
            let until = ui.deadline.min(search_started + Duration::from_secs(8));
            let selected = loop {
                ui.check()?;
                // React may replace the input after SetValue; reacquire it and wait for the current query.
                if let Ok((panel, current_search)) = ui.contact_search() {
                    let query_matches = current_search
                        .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                        .and_then(|p| p.CurrentValue())
                        .ok()
                        .and_then(|value| displayed_phone(&value.to_string()))
                        .as_deref()
                        == Some(recipient);
                    if query_matches {
                        let mut results = ui.search_results(&panel, recipient)?;
                        let matches: Vec<_> = results.iter().map(|(_, exact)| *exact).collect();
                        let timed_out = Instant::now() >= until;
                        if let Some(index) = unique_search_result(
                            &matches,
                            search_started.elapsed() >= Duration::from_millis(500),
                            timed_out,
                        )? {
                            break results.remove(index).0;
                        }
                        if Instant::now() >= until {
                            eprintln!(
                                "[voice-call] search: distinct_results={}; exact={}",
                                results.len(),
                                matches.iter().filter(|m| **m).count()
                            );
                        }
                    }
                }
                if Instant::now() >= until {
                    return Err("搜索内容或联系人尚未就绪，未拨号；请查看客户端搜索结果".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            let selected_label = ui.contact_result_label(&selected)?;
            mark("打开联系人聊天");
            ui.invoke(&ui.contact_result_action(&selected)?)?;
            let until = ui.deadline.min(Instant::now() + Duration::from_secs(5));
            while ui.contact_search().is_ok() {
                ui.check()?;
                if Instant::now() >= until {
                    return Err("联系人聊天尚未打开，未拨号".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            mark("确认聊天已切换");
            let call = ui.wait_chat_header(recipient, &selected_label)?;
            // Final action is never retried: an invocation error can still mean a call was placed.
            if window(family)? != hwnd || chat_window(family)? != ui.hwnd {
                return Err("客户端窗口已改变，未拨号".into());
            }
            mark("发起语音通话");
            ui.invoke(&call)
        }
    })();
    result.map_err(|error: String| {
        eprintln!("[voice-call] failed at {}: {error}", stage.get());
        format!("{}：{error}", stage.get())
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn call_links_select_the_bound_apps_notification_entry() {
        let _apartment = super::Apartment::new().unwrap();
        let xml = r#"<Package xmlns="urn:test"><Applications><Application Id="Other"><Extensions><Extension><ToastNotificationActivation ToastActivatorCLSID="11111111-1111-1111-1111-111111111111"/></Extension></Extensions></Application><Application Id="App"><Extensions><Extension><ToastNotificationActivation ToastActivatorCLSID="ddddf9e0-75ae-8802-a944-96ac22ad8814"/></Extension></Extensions></Application></Applications></Package>"#;
        assert_eq!(super::call_link_activator_from_manifest(xml, "App").unwrap(), windows::core::GUID::try_from("ddddf9e0-75ae-8802-a944-96ac22ad8814").unwrap());
        assert!(super::call_link_activator_from_manifest(xml, "Missing").is_err());
        assert!(super::call_link_activator_from_manifest("<broken", "App").is_err());
    }
    use super::*;
    #[test]
    #[ignore = "Read-only header diagnostic on an already open client; no input or calls"]
    fn inspect_visible_chat_header() {
        let _apartment = Apartment::new().unwrap();
        let cancelled = AtomicBool::new(false);
        unsafe {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_ALL).unwrap();
            let config: IUIAutomation2 = automation.cast().unwrap();
            config.SetConnectionTimeout(1500).unwrap();
            config.SetTransactionTimeout(1500).unwrap();
            let walker = automation.RawViewWalker().unwrap();
            let mut checked = 0;
            for app in apps().unwrap() {
                let Ok(hwnd) = chat_window(app.app_id.split_once('!').unwrap().0) else {
                    continue;
                };
                let ui = Ui {
                    automation: automation.clone(),
                    hwnd,
                    deadline: Instant::now() + Duration::from_secs(15),
                    cancelled: &cancelled,
                    chat: true,
                };
                let Ok(mut header) = ui.named(VOICE_CALL_NAMES, &[UIA_ButtonControlTypeId]) else {
                    continue;
                };
                let call = header.clone();
                let call_rect = call.CurrentBoundingRectangle().unwrap();
                println!("Client: {}", app.name);
                for level in 0..10 {
                    let Ok(parent) = walker.GetParentElement(&header) else {
                        break;
                    };
                    header = parent;
                    if automation
                        .CompareElements(&header, &ui.root().unwrap())
                        .unwrap()
                        .as_bool()
                    {
                        break;
                    }
                    let Ok(nodes) = ui.descendants(&header) else {
                        break;
                    };
                    println!("level={level} count={}", nodes.len());
                    if nodes.len() > 80 {
                        break;
                    }
                    for node in &nodes {
                        if node.CurrentBoundingRectangle().is_ok_and(|rect| {
                            rect.top < call_rect.bottom && rect.bottom > call_rect.top
                        }) {
                            println!(
                                "header control {:?}: {:?}",
                                node.CachedControlType(),
                                node.CachedName().map(|name| name.to_string())
                            );
                        }
                    }
                    if nodes.iter().any(|node| matches!(node.CachedControlType().ok(), Some(t) if t == UIA_EditControlTypeId || t == UIA_ListControlTypeId || t == UIA_ListItemControlTypeId || t == UIA_DataItemControlTypeId)) { break }
                    if let Some(phone) = nodes.iter().find_map(|node| {
                        let label = normalized_label(&node.CachedName().ok()?.to_string());
                        displayed_phone(header_contact_label(&label))
                    }) {
                        ui.wait_chat_header(&phone, "").expect(
                            "an observed complete header phone must verify without clicking",
                        );
                        assert!(ui
                            .verify_chat_header(&call, &format!("{phone}9"), "")
                            .is_err());
                        println!(
                            "header verified; wrong phone rejected; no input or call performed"
                        );
                        checked += 1;
                        break;
                    }
                }
            }
            assert!(
                checked > 0,
                "No visible chat header available; no live check performed"
            );
        }
    }
    #[test]
    fn direct_call_requires_a_complete_matching_phone_and_never_just_a_saved_name() {
        assert!(header_label_matches(
            "+1 (202) 555-0101 点击此处查看联系人信息",
            "",
            "+12025550101"
        ));
        for value in [
            "Grace",
            "",
            "+12025550102",
            "+120255501010",
            "Message +12025550101",
        ] {
            assert!(!header_label_matches(value, "", "+12025550101"));
        }
    }
    #[test]
    fn business_and_personal_headers_match_the_same_exact_recipient() {
        for suffix in [
            "点击此处查看联系人信息",
            "点击此处查看商家信息",
            "点击此处查看企业信息",
            "点击此处查看商业帐号信息",
            "业务账户",
        ] {
            let phone_header = format!("+1 (202) 555-0101 {suffix}");
            assert!(header_label_matches(&phone_header, "", "+12025550101"));
            assert!(!header_label_matches(&phone_header, "", "+12025550102"));
            assert!(!header_label_matches(&phone_header, "", "+1202555010"));
            let named_header = format!("Grace Boutique {suffix}");
            assert!(header_label_matches(
                &named_header,
                "Grace Boutique",
                "+12025550101"
            ));
            assert!(!header_label_matches(
                &named_header,
                "Grace",
                "+12025550101"
            ));
            assert!(!header_label_matches(&named_header, "", "+12025550101"));
        }
    }
    #[test]
    fn call_selection_ignores_other_headers_and_history_but_rejects_ambiguity() {
        assert_eq!(chat_call_index(&[true]).unwrap(), 0);
        assert_eq!(chat_call_index(&[false, true, false]).unwrap(), 1);
        assert!(chat_call_index(&[true, true])
            .unwrap_err()
            .contains("不唯一"));
        assert!(chat_call_index(&[false]).unwrap_err().contains("聊天标题"));
        assert!(chat_call_index(&[])
            .unwrap_err()
            .contains("未找到语音通话按钮"));
    }
    #[test]
    fn native_last_seen_status_is_not_part_of_the_contact_identity() {
        let header = "+1 (202) 555-0101 最后上线时间：今天中午11:31";
        assert!(header_label_matches(header, "", "+12025550101"));
        assert!(!header_label_matches(header, "", "+12025550102"));
        assert!(!header_label_matches(header, "", "+1202555010"));
        assert!(header_label_matches(
            "Grace Matsima 最后上线时间：昨天",
            "Grace Matsima",
            "+12025550101"
        ));
        assert!(!header_label_matches(
            "Grace Matsima Jr 最后上线时间：昨天",
            "Grace Matsima",
            "+12025550101"
        ));
        let business = "+1 (202) 555-0101 业务账户 最后上线时间：今天中午11:31";
        assert!(header_label_matches(business, "", "+12025550101"));
        assert!(!header_label_matches(business, "", "+12025550102"));
        assert!(!header_label_matches(business, "", "+1202555010"));
    }
    #[test]
    #[ignore = "Read-only comparison of host and chat-window control lookup latency"]
    fn chat_window_control_lookup_matches_host() {
        let _apartment = Apartment::new().unwrap();
        let cancelled = AtomicBool::new(false);
        unsafe {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_ALL).unwrap();
            let config: IUIAutomation2 = automation.cast().unwrap();
            config.SetConnectionTimeout(1500).unwrap();
            config.SetTransactionTimeout(1500).unwrap();
            let mut checked = 0;
            for app in apps().unwrap() {
                let family = app.app_id.split_once('!').unwrap().0;
                let Ok(host) = window(family) else {
                    continue;
                };
                let content = chat_window(family).unwrap();
                let ui = Ui {
                    automation: automation.clone(),
                    hwnd: host,
                    deadline: Instant::now() + Duration::from_secs(20),
                    cancelled: &cancelled,
                    chat: false,
                };
                let started = Instant::now();
                let Ok(host_control) = ui.named(NEW_CHAT_NAMES, &[UIA_ButtonControlTypeId]) else {
                    continue;
                };
                let host_time = started.elapsed();
                let ui = Ui {
                    hwnd: content,
                    chat: true,
                    ..ui
                };
                let started = Instant::now();
                let content_control = ui
                    .named(NEW_CHAT_NAMES, &[UIA_ButtonControlTypeId])
                    .expect("the same client chat window must expose its new-chat control");
                assert_eq!(
                    host_control.CurrentName().unwrap(),
                    content_control.CurrentName().unwrap()
                );
                println!(
                    "{}: host lookup={} ms; chat lookup={} ms",
                    app.name,
                    host_time.as_millis(),
                    started.elapsed().as_millis()
                );
                checked += 1;
            }
            assert!(
                checked > 0,
                "No running client with its chat page available for comparison"
            );
        }
    }
    #[test]
    #[ignore = "Read-only installed-client lookup comparison; no input or calls"]
    fn targeted_inventory_matches_full_discovery() {
        let started = Instant::now();
        let all = apps().unwrap();
        let full_time = started.elapsed();
        assert!(
            !all.is_empty(),
            "No installed client available for the regression"
        );
        for app in &all {
            let started = Instant::now();
            let selected = installed_app(&app.app_id).unwrap();
            assert_eq!(selected.app_id, app.app_id);
            assert_eq!(selected.name, app.name);
            println!(
                "{}: targeted={} ms; full discovery={} ms",
                app.name,
                started.elapsed().as_millis(),
                full_time.as_millis()
            );
        }
        assert!(installed_app("KevinLabs.WhatsAppClone99999999_20wb6qy974p7e!App").is_err());
        assert!(installed_app("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!MissingEntry").is_err());
    }
    #[test]
    #[ignore = "Read-only comparison of batched and live UI properties on a running client"]
    fn batched_control_properties_match_live_values() {
        let _apartment = Apartment::new().unwrap();
        let cancelled = AtomicBool::new(false);
        unsafe {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_ALL).unwrap();
            for app in apps().unwrap() {
                let Ok(hwnd) = window(app.app_id.split_once('!').unwrap().0) else {
                    continue;
                };
                let ui = Ui {
                    automation: automation.clone(),
                    hwnd,
                    deadline: Instant::now() + Duration::from_secs(20),
                    cancelled: &cancelled,
                    chat: false,
                };
                let Ok(nav) = ui.named(
                    &["对话", "聊天", "Chats", "Discussions"],
                    &[UIA_ButtonControlTypeId],
                ) else {
                    continue;
                };
                let parent = automation
                    .RawViewWalker()
                    .unwrap()
                    .GetParentElement(&nav)
                    .unwrap();
                let started = Instant::now();
                let nodes = ui.descendants(&parent).unwrap();
                let batch_time = started.elapsed();
                assert!(!nodes.is_empty());
                for node in nodes.iter().take(8) {
                    assert_eq!(node.CachedName().unwrap(), node.CurrentName().unwrap());
                    assert_eq!(
                        node.CachedControlType().unwrap(),
                        node.CurrentControlType().unwrap()
                    );
                    assert_eq!(
                        node.CachedIsOffscreen().unwrap().as_bool(),
                        node.CurrentIsOffscreen().unwrap().as_bool()
                    );
                }
                println!(
                    "{}: {} controls fetched in {} ms; cached properties match live values",
                    app.name,
                    nodes.len(),
                    batch_time.as_millis()
                );
                return;
            }
            panic!("No running client available; batched properties were not checked");
        }
    }
    #[test]
    fn only_a_unique_result_can_open_and_saved_names_wait_for_search() {
        assert_eq!(unique_search_result(&[], true, true).unwrap(), None);
        assert_eq!(unique_search_result(&[false], false, false).unwrap(), None);
        assert_eq!(
            unique_search_result(&[false], true, false).unwrap(),
            Some(0)
        );
        assert_eq!(
            unique_search_result(&[false, false], true, false).unwrap(),
            None
        );
        assert_eq!(
            unique_search_result(&[true, true], true, false).unwrap(),
            None
        );
        assert!(unique_search_result(&[false, false], true, true).is_err());
        assert!(unique_search_result(&[false, true, false], false, true).is_err());
        assert!(unique_search_result(&[true, true], true, true).is_err());
    }
    #[test]
    fn search_aliases_resolve_to_the_outer_contact_action_and_ignore_query_text() {
        let path = [
            UIA_DataItemControlTypeId,
            UIA_ButtonControlTypeId,
            UIA_GroupControlTypeId,
            UIA_ButtonControlTypeId,
        ];
        assert_eq!(contact_result_index(&path), Some(3));
        assert_eq!(contact_result_index(&path[1..]), Some(2));
        assert_eq!(contact_result_index(&path[2..]), Some(1));
        assert_eq!(
            contact_result_index(&[
                UIA_TextControlTypeId,
                UIA_EditControlTypeId,
                UIA_ButtonControlTypeId
            ]),
            None
        );
        assert_eq!(contact_result_index(&[UIA_TextControlTypeId]), None);
        assert_eq!(
            contact_result_index(&[UIA_TextControlTypeId, UIA_DataItemControlTypeId]),
            Some(1)
        );
    }
    #[test]
    fn chat_title_must_match_the_selected_result_without_partial_name_or_number_matches() {
        assert!(header_label_matches(
            "\u{200e}Grace  Matsima",
            "Grace Matsima",
            "+12025550101"
        ));
        assert!(header_label_matches(
            "Grace Matsima 点击此处查看联系人信息",
            "Grace Matsima",
            "+12025550101"
        ));
        assert!(header_label_matches(
            "+1 (202) 555-0101 点击此处查看联系人信息",
            "Some name",
            "+12025550101"
        ));
        assert!(!header_label_matches(
            "+12025550102 点击此处查看联系人信息",
            "Some name",
            "+12025550101"
        ));
        assert!(!header_label_matches(
            "Grace Matsima Jr 点击此处查看联系人信息",
            "Grace Matsima",
            "+12025550101"
        ));
        assert!(header_label_matches(
            "+1 (202) 555-0101",
            "Some name",
            "+12025550101"
        ));
        for title in [
            "",
            "Grace",
            "Grace Matsima Jr",
            "Other contact",
            "+12025550102",
        ] {
            assert!(!header_label_matches(
                title,
                "Grace Matsima",
                "+12025550101"
            ));
        }
    }
    #[test]
    #[ignore = "Read-only regression on the visible new-chat panel; no input or calls"]
    fn visible_contact_search() {
        let _apartment = Apartment::new().unwrap();
        let cancelled = AtomicBool::new(false);
        unsafe {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_ALL).unwrap();
            let config: IUIAutomation2 = automation.cast().unwrap();
            config.SetConnectionTimeout(1500).unwrap();
            config.SetTransactionTimeout(1500).unwrap();
            let mut checked = 0;
            for app in apps().unwrap() {
                let hwnd = match window(app.app_id.split_once('!').unwrap().0) {
                    Ok(hwnd) => hwnd,
                    Err(error) => {
                        println!("{} window: {error}", app.name);
                        continue;
                    }
                };
                let ui = Ui {
                    automation: automation.clone(),
                    hwnd,
                    deadline: Instant::now() + Duration::from_secs(20),
                    cancelled: &cancelled,
                    chat: false,
                };
                let Ok((panel, search)) = ui.contact_search() else {
                    continue;
                };
                let nodes = ui.descendants(&panel).unwrap();
                assert_eq!(nodes.iter().filter(|node| node.CurrentControlType().ok() == Some(UIA_EditControlTypeId)).count(), 1);
                let query = search
                    .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    .and_then(|p| p.CurrentValue())
                    .unwrap()
                    .to_string();
                let query_phone = displayed_phone(&query);
                let phone = query_phone
                    .clone()
                    .or_else(|| {
                        nodes
                            .iter()
                            .filter(|node| {
                                node.CurrentControlType().ok() == Some(UIA_DataItemControlTypeId)
                            })
                            .find_map(|node| {
                                displayed_phone(&node.CurrentName().unwrap().to_string())
                            })
                    })
                    .expect("keep a phone result or phone query visible for this regression");
                let raw_matches = nodes
                    .iter()
                    .filter(|node| {
                        displayed_phone(&node.CurrentName().unwrap().to_string()).as_deref()
                            == Some(&phone)
                    })
                    .count();
                let mut results = ui.search_results(&panel, &phone).unwrap();
                let matches: Vec<_> = results.iter().map(|(_, exact)| *exact).collect();
                if query_phone.is_none() {
                    assert!(
                        raw_matches >= 2,
                        "the unfiltered regression must contain button and data-item aliases"
                    );
                    assert_eq!(
                        matches.iter().filter(|found| **found).count(),
                        1,
                        "aliases must resolve to one clickable contact"
                    );
                }
                if query_phone.is_none() && matches.len() > 1 {
                    assert!(unique_search_result(&matches, true, true).is_err());
                    checked += 1;
                    continue;
                }
                let index = unique_search_result(&matches, true, true).unwrap().expect(
                    "a typed phone query must resolve despite the disappearing placeholder",
                );
                let selected = results.remove(index).0;
                let label = ui.contact_result_label(&selected).unwrap();
                assert!(!label.is_empty());
                let action = ui.contact_result_action(&selected).unwrap();
                assert_eq!(action.CurrentControlType().unwrap(), UIA_GroupControlTypeId);
                assert!(action
                    .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                    .is_ok());
                assert_eq!(
                    selected.CurrentControlType().unwrap(),
                    UIA_ButtonControlTypeId
                );
                assert!(selected
                    .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                    .is_ok());
                println!("{}: query_present={}; field_name_empty={}; {raw_matches} exact controls; one contact button", app.name, query_phone.is_some(), search.CurrentName().unwrap().is_empty());
                checked += 1;
            }
            assert!(
                checked > 0,
                "No new-chat search panel available; live regression was not checked"
            );
        }
    }
    #[test]
    fn profile_activation_is_idempotent_and_rejects_uncertain_state() {
        assert!(toggle_required(ToggleState_Off).unwrap());
        assert!(!toggle_required(ToggleState_On).unwrap());
        assert!(toggle_required(ToggleState_Indeterminate).is_err());
        assert!(toggle_required(ToggleState(99)).is_err());
    }
    #[test]
    #[ignore = "Read-only regression check on a running Windows WhatsApp host with a large accessibility tree"]
    fn targeted_lookup_handles_large_webview_hosts() {
        let _apartment = Apartment::new().unwrap();
        let cancelled = AtomicBool::new(false);
        unsafe {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_ALL).unwrap();
            let config: IUIAutomation2 = automation.cast().unwrap();
            config.SetConnectionTimeout(1500).unwrap();
            config.SetTransactionTimeout(1500).unwrap();
            let mut checked = 0;
            for app in apps().unwrap() {
                let family = app.app_id.split_once('!').unwrap().0.to_string();
                let mut windows = (family, Vec::<HWND>::new());
                EnumWindows(Some(enumerate), LPARAM(&mut windows as *mut _ as isize)).unwrap();
                for hwnd in windows.1 {
                    let ui = Ui {
                        automation: automation.clone(),
                        hwnd,
                        deadline: Instant::now() + Duration::from_secs(10),
                        cancelled: &cancelled,
                        chat: false,
                    };
                    let root = ui.root().unwrap();
                    let all = root
                        .FindAll(
                            TreeScope_Descendants,
                            &automation.CreateTrueCondition().unwrap(),
                        )
                        .unwrap();
                    if all.Length().unwrap() <= 2500 {
                        continue;
                    }
                    let control = ui
                        .named(
                            &["对话", "Chats", "Discussions"],
                            &[UIA_ButtonControlTypeId],
                        )
                        .expect("a large host must not prevent targeted lookup");
                    assert!(["对话", "Chats", "Discussions"]
                        .contains(&control.CurrentName().unwrap().to_string().as_str()));
                    println!(
                        "{}: {} raw nodes; one unique navigation control",
                        app.name,
                        all.Length().unwrap()
                    );
                    checked += 1;
                }
            }
            assert!(
                checked > 0,
                "No large running WhatsApp host was available; regression was not verified"
            );
        }
    }
    #[test]
    #[ignore = "Read-only check in the interactive Windows user's session"]
    fn installed_clone_inventory() {
        let installed = apps().expect("read Windows package inventory");
        for app in &installed {
            println!("{}: {}", app.name, app.app_id);
        }
        assert!(
            !installed.is_empty(),
            "No clones visible to this Windows user"
        );
    }
    #[test]
    #[ignore = "Read-only compatibility check on an already visible clone; no input or calls"]
    fn visible_clone_controls() {
        let installed = apps().unwrap();
        let _apartment = Apartment::new().unwrap();
        let cancelled = AtomicBool::new(false);
        unsafe {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_ALL).unwrap();
            let config: IUIAutomation2 = automation.cast().unwrap();
            config.SetConnectionTimeout(1500).unwrap();
            config.SetTransactionTimeout(1500).unwrap();
            let walker = automation.RawViewWalker().unwrap();
            let labels = ["电话号码", "手机号", "Phone number", "Numéro de téléphone"];
            let mut observed = 0;
            let mut fields = 0;
            for app in installed {
                let Ok(hwnd) = window(app.app_id.split_once('!').unwrap().0) else {
                    continue;
                };
                let ui = Ui {
                    automation: automation.clone(),
                    hwnd,
                    deadline: Instant::now() + Duration::from_secs(30),
                    cancelled: &cancelled,
                    chat: false,
                };
                let navigation = ui
                    .profile_navigation()
                    .expect("coexisting navigation/view-profile buttons must resolve by priority");
                assert_eq!(
                    navigation.CurrentControlType().unwrap(),
                    UIA_ButtonControlTypeId
                );
                println!(
                    "{}: unique account navigation {:?}",
                    app.name,
                    navigation.CurrentName().unwrap()
                );
                observed += 1;
                if let Ok(mut field) = ui.phone_label(&labels) {
                    let mut phone = None;
                    for _ in 0..4 {
                        field = walker.GetParentElement(&field).unwrap();
                        let nodes = ui.read_descendants(&field, false).unwrap();
                        if nodes.len() > 12 {
                            break;
                        }
                        phone = nodes.iter().find_map(|node| {
                            displayed_phone(&node.CachedName().unwrap().to_string()).or_else(|| {
                                node.GetCurrentPatternAs::<IUIAutomationValuePattern>(
                                    UIA_ValuePatternId,
                                )
                                .and_then(|p| p.CurrentValue())
                                .ok()
                                .and_then(|value| displayed_phone(&value.to_string()))
                            })
                        });
                        if phone.is_some() {
                            break;
                        }
                    }
                    let phone = phone.expect("the labelled phone must be readable through both supported wrapper layouts");
                    ui.phone_field(&labels, &phone)
                        .expect("the displayed account phone must pass");
                    let wrong = if phone == "+12025550199" {
                        "+12025550198"
                    } else {
                        "+12025550199"
                    };
                    assert!(
                        ui.phone_field(&labels, wrong).is_err(),
                        "a different account phone must never pass"
                    );
                    fields += 1;
                    println!(
                        "{}: nested phone field verified; wrong phone rejected",
                        app.name
                    );
                }
            }
            assert!(
                observed > 0,
                "No running client available for navigation checks"
            );
            assert!(
                fields > 0,
                "Keep at least one account profile page open to check its nested phone field"
            );
        }
    }
    #[test]
    fn only_complete_displayed_numbers_match() {
        assert_eq!(
            displayed_phone("\u{200e}+1 (202) 555-0101"),
            Some("+12025550101".into())
        );
        for value in [
            "customer 12025550101",
            "12025550101@lid",
            "+12025550101 +12025550102",
            "+12025550101 message",
        ] {
            assert_eq!(displayed_phone(value), None);
        }
    }
    #[test]
    fn cancelled_or_expired_requests_never_reach_the_next_action() {
        let cancelled = AtomicBool::new(false);
        assert!(check_request(Instant::now() + Duration::from_secs(1), &cancelled).is_ok());
        assert!(check_request(Instant::now() - Duration::from_secs(1), &cancelled).is_err());
        cancelled.store(true, Ordering::SeqCst);
        assert!(check_request(Instant::now() + Duration::from_secs(1), &cancelled).is_err());
    }
}
