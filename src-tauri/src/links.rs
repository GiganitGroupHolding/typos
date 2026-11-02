fn web_url(value: &str) -> Result<tauri::Url, String> {
  let url = tauri::Url::parse(value).map_err(|_| "Некорректный адрес ссылки.".to_string())?;
  if !matches!(url.scheme(), "http" | "https") || !url.has_host() {
    return Err("Можно открыть только ссылку HTTP или HTTPS.".into());
  }
  Ok(url)
}

#[tauri::command]
pub fn open_web_link(url: &str) -> Result<(), String> {
  let url = web_url(url)?;
  if launch(url.as_str()) {
    Ok(())
  } else {
    Err("Не удалось открыть ссылку. Проверь браузер по умолчанию.".into())
  }
}

#[cfg(windows)]
fn launch(url: &str) -> bool {
  use std::ptr::null;
  use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
  let url: Vec<u16> = url.encode_utf16().chain([0]).collect();
  // Передаём адрес обработчику HTTP(S) Windows без командной оболочки.
  unsafe {
    ShellExecuteW(
      std::ptr::null_mut(),
      windows_sys::w!("open"),
      url.as_ptr(),
      null(),
      null(),
      SW_SHOWNORMAL,
    ) as isize
      > 32
  }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn launch(url: &str) -> bool {
  let program = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
  std::process::Command::new(program)
    .arg(url)
    .status()
    .is_ok_and(|status| status.success())
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn launch(_: &str) -> bool {
  false
}

#[cfg(test)]
mod tests {
  use super::web_url;

  #[test]
  fn разрешены_только_веб_адреса() {
    assert!(web_url("https://example.com/").is_ok());
    assert!(web_url("http://localhost:80/").is_ok());
    for value in ["file:///C:/Windows", "javascript:alert(1)", "mailto:test@example.com", "https://"] {
      assert!(web_url(value).is_err(), "{value}");
    }
  }
}
