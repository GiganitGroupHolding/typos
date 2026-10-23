//! Пути vault на диске: без Tauri, чтобы проверка путей тестировалась отдельно от окна.
//! Повторяет mcp/nodeAdapter.ts: строка пути не выходит за корень (resolve), и настоящий путь после
//! symlink и junction тоже (confine). Служебная папка сервера хранения закрыта под любым написанием.

use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

/// Ключи сервера хранения, если выбранная папка — его vault. Под любым написанием: на macOS и Windows «.TYPOS-SERVER» — та же папка.
/// Держи в согласии с isStateDir (server/typos-server.mjs) и isServerStateDir (mcp/nodeAdapter.ts).
pub fn is_state_dir(name: &str) -> bool {
  name.trim_end_matches(['.', ' ']).eq_ignore_ascii_case(".typos-server")
}

fn outside(rel: &str) -> String {
  format!("Путь вне хранилища: {rel}")
}

/// Относительный путь vault («Физика/Конспекты/x.md») → абсолютный внутри корня. Проверяет только строку.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
  if !root.is_absolute() {
    return Err(format!("Корень хранилища должен быть абсолютным: {}", root.display()));
  }
  let mut p = root.to_path_buf();
  for (i, part) in rel.split('/').filter(|s| !s.is_empty()).enumerate() {
    if part == "." || part == ".." || part.contains(['\\', ':', '\0']) || (i == 0 && is_state_dir(part)) {
      return Err(format!("Недопустимый путь: {rel}"));
    }
    p.push(part);
  }
  Ok(p)
}

/// Настоящий путь лежит в корне и не в служебной папке?
pub fn inside(root_real: &Path, real: &Path) -> bool {
  match real.strip_prefix(root_real) {
    Ok(rest) => !matches!(rest.components().next(), Some(Component::Normal(first)) if is_state_dir(&first.to_string_lossy())),
    Err(_) => false,
  }
}

/// Проверка на диске для пути из resolve: ссылка внутри vault не выведет за корень и не приведёт к ключам сервера.
/// Несуществующий путь проверяется по ближайшей существующей папке над ним.
pub fn confine(root: &Path, target: &Path, rel: &str) -> Result<(), String> {
  let root_real = fs::canonicalize(root).map_err(|e| e.to_string())?;
  let mut probe = target;
  loop {
    match fs::canonicalize(probe) {
      Ok(real) => return if inside(&root_real, &real) { Ok(()) } else { Err(outside(rel)) },
      Err(e) if e.kind() == ErrorKind::NotFound => {
        // битая ссылка: цели нет, но сама ссылка есть — запись или create_dir_all по ней ушли бы наружу
        if fs::symlink_metadata(probe).is_ok() {
          return Err(outside(rel));
        }
        probe = probe.parent().ok_or_else(|| outside(rel))?;
      }
      Err(e) => return Err(e.to_string()),
    }
  }
}

/// resolve + confine.
pub fn checked(root: &Path, rel: &str) -> Result<PathBuf, String> {
  let target = resolve(root, rel)?;
  confine(root, &target, rel)?;
  Ok(target)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn resolve_stays_inside_root() {
    let root = Path::new(if cfg!(windows) { "C:\\vault" } else { "/vault" });
    assert_eq!(resolve(root, "Физика/x.md").unwrap(), root.join("Физика").join("x.md"));
    assert_eq!(resolve(root, "").unwrap(), root);
    for bad in [
      "../x",
      "a/../../x",
      "a\\..\\x",
      "C:/x",
      "./x",
      ".typos-server/server.json",
      ".TYPOS-SERVER./x",
      "./.typos-server/x",
    ] {
      assert!(resolve(root, bad).is_err(), "{bad}");
    }
    assert!(resolve(root, "a/.typos-server").is_ok(), "служебная только в корне");
    assert!(resolve(Path::new("relative"), "x").is_err());
  }

  #[test]
  fn state_dir_any_spelling() {
    for name in [
      ".typos-server",
      ".TYPOS-SERVER",
      ".Typos-Server.",
      ".typos-server .",
      ".typos-server  ",
    ] {
      assert!(is_state_dir(name), "{name}");
    }
    assert!(!is_state_dir("typos-server"));
    assert!(!is_state_dir(".typos-server-x"));
  }

  /// Временная папка теста: удаляется и при упавшей проверке.
  struct Temp(PathBuf);

  impl Temp {
    fn new(name: &str) -> Self {
      let dir = std::env::temp_dir().join(format!("typos-paths-{name}-{}", std::process::id()));
      let _ = fs::remove_dir_all(&dir);
      fs::create_dir_all(&dir).unwrap();
      Temp(fs::canonicalize(dir).unwrap())
    }
  }

  impl Drop for Temp {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  #[cfg(unix)]
  #[test]
  fn links_do_not_escape_root() {
    use std::os::unix::fs::symlink;
    let outside_dir = Temp::new("outside");
    let vault = Temp::new("vault");
    let root = vault.0.as_path();
    fs::write(outside_dir.0.join("marker.txt"), "снаружи").unwrap();
    symlink(&outside_dir.0, root.join("jump")).unwrap();
    symlink(outside_dir.0.join("нет.txt"), root.join("битая.txt")).unwrap();
    fs::create_dir(root.join(".typos-server")).unwrap();
    symlink(root.join(".typos-server"), root.join("ключи")).unwrap();
    fs::create_dir(root.join("Физика")).unwrap();
    symlink(root.join("Физика"), root.join("Ярлык")).unwrap();

    assert!(checked(root, "jump/marker.txt").is_err());
    assert!(checked(root, "jump/new/x.md").is_err());
    assert!(checked(root, "битая.txt").is_err());
    assert!(checked(root, "ключи/server.json").is_err());
    assert!(checked(root, "Ярлык/x.md").is_ok(), "ссылка внутри vault работает");
    assert!(checked(root, "Новая/папка/x.md").is_ok(), "несуществующий путь внутри корня");
    assert!(checked(root, "").is_ok());
    assert!(!inside(root, &outside_dir.0.join("marker.txt")));
    assert!(!inside(root, &root.join(".TYPOS-SERVER").join("server.json")));
  }
}
