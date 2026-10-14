//! Привязка к клиентскому API libmpv. Библиотека загружается во время работы (libloading),
//! поэтому одна и та же сборка приложения не зависит от архитектуры libmpv при линковке.

use libloading::Library;
use serde_json::{Map, Number, Value};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;
use std::sync::{RwLock, RwLockReadGuard};

pub const FORMAT_STRING: c_int = 1;
pub const FORMAT_FLAG: c_int = 3;
pub const FORMAT_INT64: c_int = 4;
pub const FORMAT_DOUBLE: c_int = 5;
pub const FORMAT_NODE: c_int = 6;
const FORMAT_NODE_ARRAY: c_int = 7;
const FORMAT_NODE_MAP: c_int = 8;

/// Код ошибки для вызовов после `destroy()` (MPV_ERROR_UNINITIALIZED).
const ERR_CLOSED: c_int = -7;

pub const EVENT_NONE: c_int = 0;
pub const EVENT_SHUTDOWN: c_int = 1;
pub const EVENT_LOG_MESSAGE: c_int = 2;
pub const EVENT_START_FILE: c_int = 6;
pub const EVENT_END_FILE: c_int = 7;
pub const EVENT_FILE_LOADED: c_int = 8;
pub const EVENT_VIDEO_RECONFIG: c_int = 17;
pub const EVENT_PROPERTY_CHANGE: c_int = 22;

type Handle = *mut c_void;

#[repr(C)]
struct RawEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
#[derive(Clone, Copy)]
union RawNodeU {
    string: *mut c_char,
    flag: c_int,
    int64: i64,
    double_: f64,
    list: *mut RawNodeList,
    ba: *mut c_void,
}

#[repr(C)]
struct RawNode {
    u: RawNodeU,
    format: c_int,
}

#[repr(C)]
struct RawNodeList {
    num: c_int,
    values: *mut RawNode,
    keys: *mut *mut c_char,
}

#[repr(C)]
struct RawEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct RawEventEndFile {
    reason: c_int,
    error: c_int,
}

#[repr(C)]
struct RawEventLog {
    prefix: *const c_char,
    level: *const c_char,
    text: *const c_char,
}

/// Событие mpv в удобном виде.
pub struct Event {
    pub id: c_int,
    /// Имя события (`mpv_event_name`): property-change, file-loaded, end-file…
    pub name: String,
    pub log: Option<(String, String, String)>,
    pub property: Option<(String, Value)>,
    pub end_file: Option<(i32, Option<String>)>,
}

struct Fns {
    initialize: unsafe extern "C" fn(Handle) -> c_int,
    terminate_destroy: unsafe extern "C" fn(Handle),
    set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(Handle, *const c_char) -> *mut c_char,
    get_property: unsafe extern "C" fn(Handle, *const c_char, c_int, *mut c_void) -> c_int,
    free: unsafe extern "C" fn(*mut c_void),
    free_node_contents: unsafe extern "C" fn(*mut RawNode),
    command: unsafe extern "C" fn(Handle, *mut *const c_char) -> c_int,
    observe_property: unsafe extern "C" fn(Handle, u64, *const c_char, c_int) -> c_int,
    request_log_messages: unsafe extern "C" fn(Handle, *const c_char) -> c_int,
    wait_event: unsafe extern "C" fn(Handle, f64) -> *mut RawEvent,
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    event_name: unsafe extern "C" fn(c_int) -> *const c_char,
}

pub struct Mpv {
    _lib: Library,
    handle: Handle,
    f: Fns,
    /// true после `destroy()`. Каждое обращение к дескриптору держит блокировку на чтение, а `destroy()` берёт запись:
    /// освобождение ждёт уже начатые вызовы (например, из потока загрузки субтитров), а поздние вызовы ничего не делают.
    closed: RwLock<bool>,
}

// Клиентский API mpv потокобезопасен по документации; указатели функций неизменяемы.
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

fn cstr(s: &str) -> CString {
    // NUL внутри строки обрезает значение (как это сделал бы C), а не роняет приложение.
    CString::new(s.split('\0').next().unwrap_or("")).unwrap_or_default()
}

impl Mpv {
    pub fn load(dll: &Path) -> Result<Mpv, String> {
        unsafe {
            let lib = Library::new(dll).map_err(|e| format!("{}: {e}", dll.display()))?;
            macro_rules! sym {
                ($name:expr) => {
                    *lib.get($name).map_err(|e| format!("{}: {e}", String::from_utf8_lossy($name)))?
                };
            }
            let create: unsafe extern "C" fn() -> Handle = sym!(b"mpv_create");
            let f = Fns {
                initialize: sym!(b"mpv_initialize"),
                terminate_destroy: sym!(b"mpv_terminate_destroy"),
                set_option_string: sym!(b"mpv_set_option_string"),
                set_property_string: sym!(b"mpv_set_property_string"),
                get_property_string: sym!(b"mpv_get_property_string"),
                get_property: sym!(b"mpv_get_property"),
                free: sym!(b"mpv_free"),
                free_node_contents: sym!(b"mpv_free_node_contents"),
                command: sym!(b"mpv_command"),
                observe_property: sym!(b"mpv_observe_property"),
                request_log_messages: sym!(b"mpv_request_log_messages"),
                wait_event: sym!(b"mpv_wait_event"),
                error_string: sym!(b"mpv_error_string"),
                event_name: sym!(b"mpv_event_name"),
            };
            let handle = create();
            if handle.is_null() {
                return Err("mpv_create вернул NULL".into());
            }
            Ok(Mpv { _lib: lib, handle, f, closed: RwLock::new(false) })
        }
    }

    pub fn error_string(&self, rc: c_int) -> String {
        unsafe { CStr::from_ptr((self.f.error_string)(rc)).to_string_lossy().into_owned() }
    }

    /// Блокировка на чтение, пока mpv жив; None, если он уже освобождён.
    fn live(&self) -> Option<RwLockReadGuard<'_, bool>> {
        let g = self.closed.read().unwrap_or_else(|e| e.into_inner());
        if *g { None } else { Some(g) }
    }

    pub fn option(&self, name: &str, value: &str) -> c_int {
        let Some(_g) = self.live() else { return ERR_CLOSED };
        unsafe { (self.f.set_option_string)(self.handle, cstr(name).as_ptr(), cstr(value).as_ptr()) }
    }

    pub fn initialize(&self) -> Result<(), String> {
        let Some(_g) = self.live() else { return Err("mpv закрыт".into()) };
        let rc = unsafe { (self.f.initialize)(self.handle) };
        if rc < 0 { Err(self.error_string(rc)) } else { Ok(()) }
    }

    pub fn set_property(&self, name: &str, value: &str) -> c_int {
        let Some(_g) = self.live() else { return ERR_CLOSED };
        unsafe { (self.f.set_property_string)(self.handle, cstr(name).as_ptr(), cstr(value).as_ptr()) }
    }

    pub fn get_string(&self, name: &str) -> Option<String> {
        let _g = self.live()?;
        unsafe {
            let p = (self.f.get_property_string)(self.handle, cstr(name).as_ptr());
            if p.is_null() {
                return None;
            }
            let s = CStr::from_ptr(p).to_string_lossy().into_owned();
            (self.f.free)(p as *mut c_void);
            Some(s)
        }
    }

    /// Значение свойства как JSON (строки, числа, словари и списки; недоступное свойство — None).
    pub fn get(&self, name: &str) -> Option<Value> {
        let _g = self.live()?;
        unsafe {
            let mut node: RawNode = std::mem::zeroed();
            let rc = (self.f.get_property)(self.handle, cstr(name).as_ptr(), FORMAT_NODE, &mut node as *mut RawNode as *mut c_void);
            if rc < 0 {
                return None;
            }
            let v = node_to_value(&node);
            (self.f.free_node_contents)(&mut node);
            Some(v)
        }
    }

    pub fn command(&self, args: &[&str]) -> c_int {
        let Some(_g) = self.live() else { return ERR_CLOSED };
        let owned: Vec<CString> = args.iter().map(|a| cstr(a)).collect();
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        unsafe { (self.f.command)(self.handle, ptrs.as_mut_ptr()) }
    }

    pub fn observe(&self, props: &[(&str, c_int)]) {
        let Some(_g) = self.live() else { return };
        for (i, (name, format)) in props.iter().enumerate() {
            unsafe { (self.f.observe_property)(self.handle, i as u64 + 1, cstr(name).as_ptr(), *format) };
        }
    }

    pub fn request_log_messages(&self, level: &str) {
        let Some(_g) = self.live() else { return };
        unsafe { (self.f.request_log_messages)(self.handle, cstr(level).as_ptr()) };
    }

    /// Ждёт событие до `timeout` секунд. Вызывать только из одного потока.
    pub fn wait_event(&self, timeout: f64) -> Event {
        let Some(_g) = self.live() else {
            return Event { id: EVENT_NONE, name: String::new(), log: None, property: None, end_file: None };
        };
        unsafe {
            let ev = (self.f.wait_event)(self.handle, timeout);
            let id = if ev.is_null() { EVENT_NONE } else { (*ev).event_id };
            let mut out = Event { id, name: String::new(), log: None, property: None, end_file: None };
            if ev.is_null() || id == EVENT_NONE {
                return out;
            }
            out.name = CStr::from_ptr((self.f.event_name)(id)).to_string_lossy().into_owned();
            let data = (*ev).data;
            match id {
                EVENT_LOG_MESSAGE if !data.is_null() => {
                    let m = &*(data as *const RawEventLog);
                    let s = |p: *const c_char| CStr::from_ptr(p).to_string_lossy().trim().to_string();
                    out.log = Some((s(m.prefix), s(m.level), s(m.text)));
                }
                EVENT_END_FILE if !data.is_null() => {
                    let e = &*(data as *const RawEventEndFile);
                    out.end_file = Some((e.reason, if e.error < 0 { Some(self.error_string(e.error)) } else { None }));
                }
                EVENT_PROPERTY_CHANGE if !data.is_null() => {
                    let p = &*(data as *const RawEventProperty);
                    let name = CStr::from_ptr(p.name).to_string_lossy().into_owned();
                    out.property = Some((name, property_value(p)));
                }
                _ => {}
            }
            out
        }
    }

    /// Освобождает mpv: ждёт начатые вызовы, дальше все методы безопасно ничего не делают. Повторный вызов ничего не меняет.
    pub fn destroy(&self) {
        let mut closed = self.closed.write().unwrap_or_else(|e| e.into_inner());
        if !*closed {
            *closed = true;
            unsafe { (self.f.terminate_destroy)(self.handle) };
        }
    }
}

unsafe fn property_value(p: &RawEventProperty) -> Value {
    if p.data.is_null() {
        return Value::Null;
    }
    match p.format {
        FORMAT_FLAG => Value::Bool(*(p.data as *const c_int) != 0),
        FORMAT_INT64 => Value::from(*(p.data as *const i64)),
        FORMAT_DOUBLE => number(*(p.data as *const f64)),
        FORMAT_STRING => {
            let s = *(p.data as *const *const c_char);
            if s.is_null() { Value::Null } else { Value::String(CStr::from_ptr(s).to_string_lossy().into_owned()) }
        }
        FORMAT_NODE => node_to_value(p.data as *const RawNode),
        _ => Value::Null,
    }
}

/// NaN и бесконечности в JSON невозможны: превращаются в null.
fn number(d: f64) -> Value {
    Number::from_f64(d).map(Value::Number).unwrap_or(Value::Null)
}

unsafe fn node_to_value(n: *const RawNode) -> Value {
    match (*n).format {
        FORMAT_STRING => Value::String(CStr::from_ptr((*n).u.string).to_string_lossy().into_owned()),
        FORMAT_FLAG => Value::Bool((*n).u.flag != 0),
        FORMAT_INT64 => Value::from((*n).u.int64),
        FORMAT_DOUBLE => number((*n).u.double_),
        FORMAT_NODE_ARRAY => {
            let list = (*n).u.list;
            if list.is_null() {
                return Value::Array(vec![]);
            }
            Value::Array((0..(*list).num as usize).map(|i| node_to_value((*list).values.add(i))).collect())
        }
        FORMAT_NODE_MAP => {
            let list = (*n).u.list;
            let mut m = Map::new();
            if !list.is_null() {
                for i in 0..(*list).num as usize {
                    let key = CStr::from_ptr(*(*list).keys.add(i)).to_string_lossy().into_owned();
                    m.insert(key, node_to_value((*list).values.add(i)));
                }
            }
            Value::Object(m)
        }
        _ => Value::Null,
    }
}
