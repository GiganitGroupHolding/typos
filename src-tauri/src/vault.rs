//! Папка vault на диске для десктопного приложения (src/storage/tauriAdapter.ts).
//! Повторяет mcp/nodeAdapter.ts: пути относительные через «/», выйти за корень нельзя,
//! запись атомарная — во временный «имя.1a2b3c4d.tmp» и переименование.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

/// Ошибка «файла нет» — адаптер превращает её в null.
const MISSING: &str = "ENOENT";

#[derive(Serialize)]
pub struct Entry {
  name: String,
  kind: &'static str,
}

fn err(e: impl ToString) -> String {
  e.to_string()
}

/// Относительный путь vault («Физика/Конспекты/x.md») → абсолютный внутри корня.
fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
  let root = Path::new(root);
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

#[tauri::command]
pub async fn vault_list(root: String, dir: String) -> Result<Vec<Entry>, String> {
  let items = match fs::read_dir(resolve(&root, &dir)?) {
    Ok(items) => items,
    Err(e) if e.kind() == ErrorKind::NotFound => return Ok(vec![]),
    Err(e) => return Err(err(e)),
  };
  let mut out = Vec::new();
  for item in items {
    let item = item.map_err(err)?;
    // ссылку на папку считаем папкой, как readdir + stat
    let is_dir = fs::metadata(item.path()).map(|m| m.is_dir()).unwrap_or(false);
    out.push(Entry { name: item.file_name().to_string_lossy().into_owned(), kind: if is_dir { "dir" } else { "file" } });
  }
  Ok(out)
}

/// Содержимое файла сырыми байтами (в JS — ArrayBuffer, без JSON).
#[tauri::command]
pub async fn vault_read(root: String, path: String) -> Result<Response, String> {
  match fs::read(resolve(&root, &path)?) {
    Ok(bytes) => Ok(Response::new(bytes)),
    Err(e) if e.kind() == ErrorKind::NotFound || e.kind() == ErrorKind::IsADirectory => Err(MISSING.into()),
    Err(e) => Err(err(e)),
  }
}

#[tauri::command]
pub async fn vault_write_text(root: String, path: String, text: String) -> Result<(), String> {
  write_atomic(&resolve(&root, &path)?, text.as_bytes())
}

/// Тело запроса — сырые байты, корень и путь — в заголовках x-root / x-path (encodeURIComponent).
#[tauri::command]
pub async fn vault_write_bytes(request: Request<'_>) -> Result<(), String> {
  let header = |name: &str| -> Result<String, String> {
    let raw = request.headers().get(name).ok_or_else(|| format!("Нет заголовка {name}"))?;
    let raw = raw.to_str().map_err(err)?;
    Ok(percent_decode_str(raw).decode_utf8().map_err(err)?.into_owned())
  };
  let target = resolve(&header("x-root")?, &header("x-path")?)?;
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("Ожидались сырые байты".into());
  };
  write_atomic(&target, bytes)
}

#[tauri::command]
pub async fn vault_exists(root: String, path: String) -> Result<bool, String> {
  Ok(resolve(&root, &path)?.exists())
}

#[tauri::command]
pub async fn vault_remove(root: String, path: String) -> Result<(), String> {
  let target = resolve(&root, &path)?;
  if path.split('/').all(|s| s.is_empty()) {
    return Err("Нельзя удалить корень хранилища".into());
  }
  let res = match fs::symlink_metadata(&target) {
    Ok(m) if m.is_dir() => fs::remove_dir_all(&target),
    Ok(_) => fs::remove_file(&target),
    Err(e) => Err(e),
  };
  match res {
    Err(e) if e.kind() != ErrorKind::NotFound => Err(err(e)),
    _ => Ok(()),
  }
}

#[tauri::command]
pub async fn vault_move(root: String, from: String, to: String) -> Result<(), String> {
  if from == to {
    return Ok(());
  }
  let (src, dst) = (resolve(&root, &from)?, resolve(&root, &to)?);
  if dst.exists() {
    return Err(format!("Уже существует: {to}"));
  }
  if let Some(parent) = dst.parent() {
    fs::create_dir_all(parent).map_err(err)?;
  }
  fs::rename(src, dst).map_err(err)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn resolve_stays_inside_root() {
    let root = if cfg!(windows) { "C:\\vault" } else { "/vault" };
    assert_eq!(resolve(root, "Физика/x.md").unwrap(), Path::new(root).join("Физика").join("x.md"));
    assert_eq!(resolve(root, "").unwrap(), Path::new(root));
    for bad in ["../x", "a/../../x", "a\\..\\x", "C:/x", "./x"] {
      assert!(resolve(root, bad).is_err(), "{bad}");
    }
    assert!(resolve("relative", "x").is_err());
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
