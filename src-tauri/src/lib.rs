mod graph;

use graph::{acquire_token, AppError, AppState, AutopilotDevice, AutopilotImportEntry, AutopilotImportResult, CachedToken, Credentials, DeviceInfo, GraphClient};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const KEYRING_SERVICE: &str = "com.jacob.intune-device-manager";

type State<'a> = tauri::State<'a, Mutex<AppState>>;

#[tauri::command]
async fn login(
    state: State<'_>,
    tenant_id: String,
    client_id: String,
    client_secret: String,
) -> Result<(), AppError> {
    let http_client = {
        let s = state.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        s.http_client.clone()
    };

    let (token, expires_in) = acquire_token(
        &http_client,
        &tenant_id,
        &client_id,
        &client_secret,
    ).await?;

    let mut s = state.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    s.credentials = Some(Credentials {
        tenant_id,
        client_id,
        client_secret,
    });
    s.token = Some(CachedToken {
        access_token: token,
        expires_at: Instant::now() + Duration::from_secs(expires_in),
    });

    Ok(())
}

#[tauri::command]
async fn logout(state: State<'_>) -> Result<(), AppError> {
    let mut s = state.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    s.token = None;
    s.credentials = None;
    Ok(())
}

/// Helper: get a valid token and the http client from state
async fn get_client_and_token(state: &Mutex<AppState>) -> Result<(reqwest::Client, String), AppError> {
    // First try with just a read
    {
        let s = state.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        if let Some(ref cached) = s.token {
            if !cached.is_expired() {
                return Ok((s.http_client.clone(), cached.access_token.clone()));
            }
        }
    }

    // Token expired — need to refresh
    let (http_client, creds) = {
        let s = state.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let creds = s.credentials.as_ref()
            .ok_or(AppError::NotAuthenticated)?
            .clone();
        (s.http_client.clone(), creds)
    };

    let (token, expires_in) = acquire_token(
        &http_client,
        &creds.tenant_id,
        &creds.client_id,
        &creds.client_secret,
    ).await?;

    {
        let mut s = state.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        s.token = Some(CachedToken {
            access_token: token.clone(),
            expires_at: Instant::now() + Duration::from_secs(expires_in),
        });
    }

    Ok((http_client, token))
}

#[tauri::command]
async fn get_devices(state: State<'_>) -> Result<Vec<DeviceInfo>, AppError> {
    let (http_client, token) = get_client_and_token(&state).await?;
    let client = GraphClient::new(&http_client, token);
    client.get_managed_devices().await
}

#[tauri::command]
async fn get_device(state: State<'_>, device_id: String) -> Result<DeviceInfo, AppError> {
    let (http_client, token) = get_client_and_token(&state).await?;
    let client = GraphClient::new(&http_client, token);
    client.get_managed_device(&device_id).await
}

#[tauri::command]
async fn sync_device(state: State<'_>, device_id: String) -> Result<(), AppError> {
    let (http_client, token) = get_client_and_token(&state).await?;
    let client = GraphClient::new(&http_client, token);
    client.sync_device(&device_id).await
}

#[tauri::command]
async fn restart_device(state: State<'_>, device_id: String) -> Result<(), AppError> {
    let (http_client, token) = get_client_and_token(&state).await?;
    let client = GraphClient::new(&http_client, token);
    client.restart_device(&device_id).await
}

#[tauri::command]
async fn run_remediation(
    state: State<'_>,
    script_id: String,
    device_id: String,
) -> Result<(), AppError> {
    let (http_client, token) = get_client_and_token(&state).await?;
    let client = GraphClient::new(&http_client, token);
    client.run_remediation(&script_id, &device_id).await
}

#[tauri::command]
async fn get_autopilot_devices(state: State<'_>) -> Result<Vec<AutopilotDevice>, AppError> {
    let (http_client, token) = get_client_and_token(&state).await?;
    let client = GraphClient::new(&http_client, token);
    client.get_autopilot_devices().await
}

#[tauri::command]
async fn delete_autopilot_device(state: State<'_>, device_id: String) -> Result<(), AppError> {
    let (http_client, token) = get_client_and_token(&state).await?;
    let client = GraphClient::new(&http_client, token);
    client.delete_autopilot_device(&device_id).await
}

#[tauri::command]
async fn update_autopilot_group_tag(
    state: State<'_>,
    device_id: String,
    group_tag: String,
) -> Result<(), AppError> {
    let (http_client, token) = get_client_and_token(&state).await?;
    let client = GraphClient::new(&http_client, token);
    client.update_autopilot_group_tag(&device_id, &group_tag).await
}

#[tauri::command]
async fn import_autopilot_devices(
    state: State<'_>,
    entries: Vec<AutopilotImportEntry>,
) -> Result<Vec<AutopilotImportResult>, AppError> {
    let (http_client, token) = get_client_and_token(&state).await?;
    let client = GraphClient::new(&http_client, token);
    client.import_autopilot_devices(entries).await
}

#[tauri::command]
fn save_secret(account: String, secret: String) -> Result<(), AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    entry.set_password(&secret)
        .map_err(|e| AppError::Keyring(e.to_string()))
}

#[tauri::command]
fn load_secret(account: String) -> Result<Option<String>, AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

#[tauri::command]
fn delete_secret(account: String) -> Result<(), AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(AppState::default()))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            get_devices,
            get_device,
            sync_device,
            restart_device,
            run_remediation,
            get_autopilot_devices,
            delete_autopilot_device,
            update_autopilot_group_tag,
            import_autopilot_devices,
            save_secret,
            load_secret,
            delete_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
