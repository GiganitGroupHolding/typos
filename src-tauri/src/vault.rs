//! Папка vault на диске для десктопного приложения (src/storage/tauriAdapter.ts).
//! Повторяет mcp/nodeAdapter.ts: пути относительные через «/», выйти за корень нельзя,
//! запись атомарная — во временный «имя.1a2b3c4d.tmp» и переименование.
//!
//! Корень приходит из JS, но Rust пускает только в папки, которые пользователь сам выбрал в системном диалоге
//! (сейчас или раньше — тогда путь запомнен в настройках приложения). Скрипт в окне не прочитает произвольный файл на диске.

use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Ошибка «файла нет» — адаптер превращает её в null.
const MISSING: &str = "ENOENT";
/// Запомненная папка в каталоге настроек приложения.
const SAVED_FILE: &str = "vault.json";

#[derive(Serialize)]
pub struct Entry {
  name: String,
  kind: &'static str,
}

#[derive(Serialize, Deserialize)]
struct Saved {
  root: PathBuf,
}

/// Папки, которые пользователь выбрал сам. Только в них и ходят команды vault_*.
#[derive(Default)]
pub struct Granted(Mutex<HashSet<PathBuf>>);

impl Granted {
  fn grant(&self, root: PathBuf) {
    self.0.lock().unwrap_or_else(PoisonError::into_inner).insert(root);
  }

  /// Корень из JS → путь, если эту папку выбирал пользователь.
  fn check(&self, root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root);
    if self.0.lock().unwrap_or_else(PoisonError::into_inner).contains(&root) {
      Ok(root)
    } else {
      Err(format!("Нет доступа к папке: {}", root.display()))
    }
  }
}

fn err(e: impl ToString) -> String {
  e.to_string()
}

/// Файловые операции — в пуле блокирующих задач, чтобы не занимать потоки асинхронного рантайма.
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(job).await.map_err(err)?
}

/// Относительный путь vault («Физика/Конспекты/x.md») → абсолютный внутри корня.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
  if !root.is_absolute() {
    return Err(format!("Корень хранилища должен быть абсолютным: {}", root.display()));
  }
  let mut p = root.to_path_buf();
  for part in rel.split('/').filter(|s| !s.is_empty()) {
    if part == "." || part == ".." || part.contains('\\') || part.contains(':') {
      return Err(format!("Недопустимый путь: {rel}"));
    }
    p.push(part);
  }
  Ok(p)
}

fn tmp_name(target: &Path) -> PathBuf {
  static COUNTER: AtomicU32 = AtomicU32::new(0);
  let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
  let salt = nanos ^ std::process::id().rotate_left(16) ^ COUNTER.fetch_add(1, Ordering::Relaxed).wrapping_mul(0x9e37_79b9);
  let mut name = target.as_os_str().to_owned();
  name.push(format!(".{salt:08x}.tmp"));
  PathBuf::from(name)
}

/// Пишет во временный файл и переименовывает — никто не прочитает файл наполовину.
fn write_atomic(target: &Path, data: &[u8]) -> Result<(), String> {
  if let Some(parent) = target.parent() {
    fs::create_dir_all(parent).map_err(err)?;
  }
  let tmp = tmp_name(target);
  let res = fs::write(&tmp, data).and_then(|_| fs::rename(&tmp, target));
  if res.is_err() {
    let _ = fs::remove_file(&tmp);
  }
  res.map_err(err)
}

fn saved_file(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app.path().app_config_dir().map_err(err)?.join(SAVED_FILE))
}

fn path_string(path: &Path) -> String {
  path.to_string_lossy().into_owned()
}

// ---------- выбор папки ----------

/// Папка, выбранная в прошлый раз; None — не выбирали.
#[tauri::command]
pub async fn vault_saved(app: AppHandle, granted: State<'_, Granted>) -> Result<Option<String>, String> {
  let file = saved_file(&app)?;
  let saved = blocking(move || match fs::read(&file) {
    // испорченный файл — как будто папку не выбирали: пользователь выберет снова
    Ok(bytes) => Ok(serde_json::from_slice::<Saved>(&bytes).ok()),
    Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
    Err(e) => Err(err(e)),
  })
  .await?;
  Ok(saved.map(|s| {
    let path = path_string(&s.root);
    granted.grant(s.root);
    path
  }))
}

/// Системный диалог выбора папки; None — пользователь передумал.
#[tauri::command]
pub async fn vault_pick(app: AppHandle, granted: State<'_, Granted>) -> Result<Option<String>, String> {
  let picked = blocking(move || Ok(app.dialog().file().set_title("Папка для конспектов").blocking_pick_folder())).await?;
  let Some(picked) = picked else { return Ok(None) };
  let root = picked.into_path().map_err(err)?;
  let path = path_string(&root);
  granted.grant(root);
  Ok(Some(path))
}

/// Запомнить выбранную папку до следующего запуска.
#[tauri::command]
pub async fn vault_remember(app: AppHandle, granted: State<'_, Granted>, root: String) -> Result<(), String> {
  let json = serde_json::to_vec(&Saved {
    root: granted.check(&root)?,
  })
  .map_err(err)?;
  let file = saved_file(&app)?;
  blocking(move || write_atomic(&file, &json)).await
}

#[tauri::command]
pub async fn vault_forget(app: AppHandle) -> Result<(), String> {
  let file = saved_file(&app)?;
  blocking(move || match fs::remove_file(&file) {
    Err(e) if e.kind() != ErrorKind::NotFound => Err(err(e)),
    _ => Ok(()),
  })
  .await
}

// ---------- файлы ----------

#[tauri::command]
pub async fn vault_list(granted: State<'_, Granted>, root: String, dir: String) -> Result<Vec<Entry>, String> {
  let dir = resolve(&granted.check(&root)?, &dir)?;
  blocking(move || {
    let items = match fs::read_dir(dir) {
      Ok(items) => items,
      Err(e) if e.kind() == ErrorKind::NotFound => return Ok(vec![]),
      Err(e) => return Err(err(e)),
    };
    let mut out = Vec::new();
    for item in items {
      let item = item.map_err(err)?;
      // ссылку на папку считаем папкой, как readdir + stat
      let is_dir = fs::metadata(item.path()).map(|m| m.is_dir()).unwrap_or(false);
      out.push(Entry {
        name: item.file_name().to_string_lossy().into_owned(),
        kind: if is_dir { "dir" } else { "file" },
      });
    }
    Ok(out)
  })
  .await
}

/// Содержимое файла сырыми байтами (в JS — ArrayBuffer, без JSON).
#[tauri::command]
pub async fn vault_read(granted: State<'_, Granted>, root: String, path: String) -> Result<Response, String> {
  let target = resolve(&granted.check(&root)?, &path)?;
  let bytes = blocking(move || match fs::read(target) {
    Ok(bytes) => Ok(bytes),
    Err(e) if e.kind() == ErrorKind::NotFound || e.kind() == ErrorKind::IsADirectory => Err(MISSING.into()),
    Err(e) => Err(err(e)),
  })
  .await?;
  Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn vault_write_text(granted: State<'_, Granted>, root: String, path: String, text: String) -> Result<(), String> {
  let target = resolve(&granted.check(&root)?, &path)?;
  blocking(move || write_atomic(&target, text.as_bytes())).await
}

/// Тело запроса — сырые байты, корень и путь — в заголовках x-root / x-path (encodeURIComponent).
#[tauri::command]
pub async fn vault_write_bytes(granted: State<'_, Granted>, request: Request<'_>) -> Result<(), String> {
  let header = |name: &str| -> Result<String, String> {
    let raw = request.headers().get(name).ok_or_else(|| format!("Нет заголовка {name}"))?;
    let raw = raw.to_str().map_err(err)?;
    Ok(percent_decode_str(raw).decode_utf8().map_err(err)?.into_owned())
  };
  let target = resolve(&granted.check(&header("x-root")?)?, &header("x-path")?)?;
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("Ожидались сырые байты".into());
  };
  let bytes = bytes.clone();
  blocking(move || write_atomic(&target, &bytes)).await
}

#[tauri::command]
pub async fn vault_exists(granted: State<'_, Granted>, root: String, path: String) -> Result<bool, String> {
  let target = resolve(&granted.check(&root)?, &path)?;
  blocking(move || Ok(target.exists())).await
}

#[tauri::command]
pub async fn vault_remove(granted: State<'_, Granted>, root: String, path: String) -> Result<(), String> {
  if path.split('/').all(|s| s.is_empty()) {
    return Err("Нельзя удалить корень хранилища".into());
  }
  let target = resolve(&granted.check(&root)?, &path)?;
  blocking(move || {
    let res = match fs::symlink_metadata(&target) {
      Ok(m) if m.is_dir() => fs::remove_dir_all(&target),
      Ok(_) => fs::remove_file(&target),
      Err(e) => Err(e),
    };
    match res {
      Err(e) if e.kind() != ErrorKind::NotFound => Err(err(e)),
      _ => Ok(()),
    }
  })
  .await
}

#[tauri::command]
pub async fn vault_move(granted: State<'_, Granted>, root: String, from: String, to: String) -> Result<(), String> {
  if from == to {
    return Ok(());
  }
  let root = granted.check(&root)?;
  let (src, dst) = (resolve(&root, &from)?, resolve(&root, &to)?);
  blocking(move || {
    if dst.exists() {
      return Err(format!("Уже существует: {to}"));
    }
    if let Some(parent) = dst.parent() {
      fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(src, dst).map_err(err)
  })
  .await
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn resolve_stays_inside_root() {
    let root = Path::new(if cfg!(windows) { "C:\\vault" } else { "/vault" });
    assert_eq!(resolve(root, "Физика/x.md").unwrap(), root.join("Физика").join("x.md"));
    assert_eq!(resolve(root, "").unwrap(), root);
    for bad in ["../x", "a/../../x", "a\\..\\x", "C:/x", "./x"] {
      assert!(resolve(root, bad).is_err(), "{bad}");
    }
    assert!(resolve(Path::new("relative"), "x").is_err());
  }

  #[test]
  fn only_granted_roots() {
    let granted = Granted::default();
    let root = if cfg!(windows) { "C:\\vault" } else { "/vault" };
    assert!(granted.check(root).is_err());
    granted.grant(PathBuf::from(root));
    assert_eq!(granted.check(root).unwrap(), Path::new(root));
    assert!(granted.check(if cfg!(windows) { "C:\\" } else { "/" }).is_err());
  }

  #[test]
  fn tmp_matches_mcp_pattern() {
    let tmp = tmp_name(Path::new("/vault/x.md"));
    let name = tmp.file_name().unwrap().to_string_lossy().into_owned();
    let suffix = name.strip_prefix("x.md.").unwrap().strip_suffix(".tmp").unwrap();
    assert_eq!(suffix.len(), 8);
    assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
  }
}
