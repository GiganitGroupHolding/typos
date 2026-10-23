mod paths;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(vault::Granted::default())
    .invoke_handler(tauri::generate_handler![
      vault::vault_saved,
      vault::vault_pick,
      vault::vault_remember,
      vault::vault_forget,
      vault::vault_list,
      vault::vault_read,
      vault::vault_write_text,
      vault::vault_write_bytes,
      vault::vault_exists,
      vault::vault_remove,
      vault::vault_move,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
