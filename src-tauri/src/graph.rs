use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime};
use thiserror::Error;

const GRAPH_BASE: &str = "https://graph.microsoft.com/beta/deviceManagement";
const GRAPH_BETA: &str = "https://graph.microsoft.com/beta";

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Graph API error: {0}")]
    Graph(String),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Keyring error: {0}")]
    Keyring(String),

    #[error("Not authenticated. Please sign in.")]
    NotAuthenticated,

    #[error("This app registration needs the DeviceManagementApps.Read.All application permission with admin consent. Ask your Entra admin to add it, then sign out and back in.")]
    MissingPermission,

    #[error("Invalid input: {0}")]
    Validation(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

// Required for Tauri command return types
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub device_name: String,
    #[serde(default)]
    pub user_principal_name: Option<String>,
    #[serde(default)]
    pub serial_number: Option<String>,
    #[serde(default)]
    pub operating_system: Option<String>,
    #[serde(default)]
    pub os_version: Option<String>,
    #[serde(default)]
    pub compliance_state: Option<String>,
    #[serde(default)]
    pub last_sync_date_time: Option<String>,
    #[serde(default)]
    pub management_state: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotDevice {
    pub id: String,
    #[serde(default)]
    pub group_tag: Option<String>,
    #[serde(default)]
    pub serial_number: Option<String>,
    #[serde(default)]
    pub product_key: Option<String>,
    #[serde(default)]
    pub manufacturer: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub enrollment_state: Option<String>,
    #[serde(default)]
    pub last_contacted_date_time: Option<String>,
    #[serde(default)]
    pub addressable_user_name: Option<String>,
    #[serde(default)]
    pub user_principal_name: Option<String>,
    #[serde(default)]
    pub managed_device_id: Option<String>,
    #[serde(default)]
    pub azure_active_directory_device_id: Option<String>,
    #[serde(default)]
    pub azure_ad_device_id: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotImportEntry {
    #[serde(default)]
    pub serial_number: Option<String>,
    pub hardware_identifier: String,
    #[serde(default)]
    pub product_key: Option<String>,
    #[serde(default)]
    pub group_tag: Option<String>,
    #[serde(default)]
    pub assigned_user_principal_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotImportResult {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub serial_number: Option<String>,
    #[serde(default)]
    pub state: Option<AutopilotImportState>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotImportState {
    #[serde(default)]
    pub device_import_status: Option<String>,
    #[serde(default)]
    pub device_error_code: Option<i64>,
    #[serde(default)]
    pub device_error_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Intune app, as offered by the install board's picker
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MobileAppSummary {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub publisher: Option<String>,
}

/// One app assigned to a device and its install state there
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAppState {
    pub app_id: String,
    pub app_name: String,
    pub intent: Option<String>,
    pub app_version: Option<String>,
    pub install_state: Option<String>,
    pub state_detail: Option<String>,
    pub error_code: Option<String>,
    pub last_reported: Option<String>,
    /// Set when the report refused this app (usually throttling); the state above is then the fallback
    pub report_error: Option<String>,
}

/// One row of Intune's per-device install report for an app
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppInstallStatus {
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub install_state: Option<String>,
    pub state_detail: Option<String>,
    pub error_code: Option<String>,
    pub last_reported: Option<String>,
    pub app_version: Option<String>,
}

#[derive(Debug)]
struct InstallReportPage {
    total: usize,
    rows: Vec<AppInstallStatus>,
}

/// The report returns `Values` as positional rows against `Schema`, so look
/// columns up by name: the order is not part of any documented contract.
fn parse_install_report(body: &serde_json::Value) -> Result<InstallReportPage, AppError> {
    let schema = body["Schema"]
        .as_array()
        .ok_or_else(|| AppError::Graph(format!("Unexpected install report: {}", body)))?;
    let index = |name: &str| schema.iter().position(|c| c["Column"] == name);
    let columns = [
        "DeviceId",
        "DeviceName",
        "AppInstallState_loc",
        "AppInstallStateDetails_loc",
        "HexErrorCode",
        "LastModifiedDateTime",
        "AppVersion",
    ]
    .map(index);

    let rows = body["Values"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|row| {
            let cell = |i: Option<usize>| -> Option<String> {
                let value = &row[i?];
                let text = match value {
                    serde_json::Value::Null => return None,
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                (!text.is_empty()).then_some(text)
            };
            AppInstallStatus {
                device_id: cell(columns[0]),
                device_name: cell(columns[1]),
                install_state: cell(columns[2]),
                state_detail: cell(columns[3]),
                error_code: cell(columns[4]),
                last_reported: cell(columns[5]).map(assume_utc),
                app_version: cell(columns[6]),
            }
        })
        .collect::<Vec<_>>();

    let total = body["TotalRowCount"].as_u64().map_or(rows.len(), |n| n as usize);
    Ok(InstallReportPage { total, rows })
}

const NO_USER: &str = "00000000-0000-0000-0000-000000000000";

/// The apps Intune means for one device. Its `installState` is often "unknown", so it only
/// stands in until the report has a row for the device.
fn parse_intent_list(body: &serde_json::Value) -> Vec<DeviceAppState> {
    let text = |v: &serde_json::Value| v.as_str().filter(|s| !s.is_empty()).map(str::to_string);
    body["mobileAppList"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|a| {
            Some(DeviceAppState {
                app_id: text(&a["applicationId"])?,
                app_name: text(&a["displayName"]).unwrap_or_else(|| "Unnamed app".to_string()),
                intent: text(&a["mobileAppIntent"]),
                app_version: text(&a["displayVersion"]),
                install_state: text(&a["installState"]).filter(|s| !s.eq_ignore_ascii_case("unknown")),
                state_detail: None,
                error_code: None,
                last_reported: None,
                report_error: None,
            })
        })
        .collect()
}

/// One row per signed-in user; the most recently reported one is the device's state
fn newest_row_for<'r>(rows: &'r [AppInstallStatus], device_id: &str) -> Option<&'r AppInstallStatus> {
    rows.iter()
        .filter(|r| r.device_id.as_deref().is_some_and(|d| d.eq_ignore_ascii_case(device_id)))
        .max_by(|a, b| a.last_reported.cmp(&b.last_reported))
}

/// Newest `remoteLock` result's PIN. Times are ISO 8601 UTC, so they compare as text.
fn latest_unlock_pin(device: &serde_json::Value) -> Option<String> {
    device["deviceActionResults"]
        .as_array()?
        .iter()
        .filter(|r| r["actionName"].as_str().is_some_and(|n| n.eq_ignore_ascii_case("remoteLock")))
        .max_by_key(|r| r["startDateTime"].as_str().unwrap_or_default().to_string())
        .and_then(|r| r["unlockPin"].as_str())
        .filter(|pin| !pin.is_empty())
        .map(str::to_string)
}

/// Report times carry no offset; they are UTC, and the webview would read them as local time
fn assume_utc(time: String) -> String {
    let has_offset = time.ends_with('Z')
        || time.rfind(['+', '-']).is_some_and(|i| i > time.find('T').unwrap_or(usize::MAX));
    if has_offset { time } else { time + "Z" }
}

/// A 403 here means the app permission is missing; anything else is passed through
fn graph_error(status: reqwest::StatusCode, body: String) -> AppError {
    if status == reqwest::StatusCode::FORBIDDEN {
        AppError::MissingPermission
    } else {
        AppError::Graph(body)
    }
}

#[derive(Debug, Deserialize)]
struct GraphListResponse<T> {
    value: Vec<T>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}

/// Cached token with expiration tracking
#[derive(Debug, Clone)]
pub struct CachedToken {
    pub access_token: String,
    // Wall clock, not Instant: Instant stops while macOS sleeps, but the token's lifetime doesn't
    pub expires_at: SystemTime,
}

impl CachedToken {
    pub fn is_expired(&self) -> bool {
        // Consider expired 5 minutes early to avoid edge cases
        SystemTime::now() + Duration::from_secs(300) >= self.expires_at
    }
}

/// Stored credentials for token refresh
#[derive(Debug, Clone)]
pub struct Credentials {
    pub tenant_id: String,
    pub client_id: String,
    pub client_secret: String,
}

/// Application state stored in Tauri managed state
pub struct AppState {
    pub http_client: Client,
    pub token: Option<CachedToken>,
    pub credentials: Option<Credentials>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            http_client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| Client::new()),
            token: None,
            credentials: None,
        }
    }
}

impl AppState {}

/// Acquire a token via client credentials flow
pub async fn acquire_token(
    client: &Client,
    tenant_id: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<(String, u64), AppError> {
    let url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        tenant_id
    );

    let resp = client
        .post(&url)
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("scope", "https://graph.microsoft.com/.default"),
        ])
        .send()
        .await?;

    let token_resp: TokenResponse = resp.json().await?;

    if let Some(token) = token_resp.access_token {
        let expires_in = token_resp.expires_in.unwrap_or(3600);
        Ok((token, expires_in))
    } else {
        let err = token_resp
            .error_description
            .or(token_resp.error)
            .unwrap_or_else(|| "Unknown authentication error".to_string());
        Err(AppError::Auth(err))
    }
}

/// Validates that an ID string is safe for URL interpolation
/// The app id goes into an OData filter string, so a quote must never reach it
fn validate_app_id(id: &str) -> Result<(), AppError> {
    validate_id(id, "app_id")?;
    if id.contains('\'') {
        return Err(AppError::Validation("Invalid app_id: contains forbidden characters".to_string()));
    }
    Ok(())
}

fn validate_id(id: &str, label: &str) -> Result<(), AppError> {
    if id.is_empty() {
        return Err(AppError::Validation(format!("{} cannot be empty", label)));
    }
    if id.contains('/') || id.contains('\\') || id.contains('?') || id.contains('#') || id.contains('&') {
        return Err(AppError::Validation(format!("Invalid {}: contains forbidden characters", label)));
    }
    Ok(())
}

pub struct GraphClient<'a> {
    client: &'a Client,
    access_token: String,
}

impl<'a> GraphClient<'a> {
    pub fn new(client: &'a Client, access_token: String) -> Self {
        Self {
            client,
            access_token,
        }
    }

    pub async fn get_managed_devices(&self) -> Result<Vec<DeviceInfo>, AppError> {
        let initial_url = format!(
            "{}/managedDevices?$select=id,deviceName,userPrincipalName,serialNumber,operatingSystem,osVersion,complianceState,lastSyncDateTime,managementState&$top=200",
            GRAPH_BASE
        );
        self.get_all_pages::<DeviceInfo>(&initial_url).await
    }

    pub async fn get_managed_device(&self, device_id: &str) -> Result<DeviceInfo, AppError> {
        validate_id(device_id, "device_id")?;
        let url = format!(
            "{}/managedDevices/{}?$select=id,deviceName,userPrincipalName,serialNumber,operatingSystem,osVersion,complianceState,lastSyncDateTime,managementState",
            GRAPH_BASE, device_id
        );

        let resp = self.request_with_retry(|| {
            self.client
                .get(&url)
                .bearer_auth(&self.access_token)
        }).await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Graph(body));
        }

        let device: DeviceInfo = resp.json().await?;
        Ok(device)
    }

    pub async fn sync_device(&self, device_id: &str) -> Result<(), AppError> {
        validate_id(device_id, "device_id")?;
        let url = format!("{}/managedDevices/{}/syncDevice", GRAPH_BASE, device_id);
        self.post_action(&url).await
    }

    pub async fn restart_device(&self, device_id: &str) -> Result<(), AppError> {
        validate_id(device_id, "device_id")?;
        let url = format!("{}/managedDevices/{}/rebootNow", GRAPH_BASE, device_id);
        self.post_action(&url).await
    }

    /// Full wipe. `useProtectedWipe` is a Windows option, so Apple devices are sent without it
    pub async fn wipe_device(&self, device_id: &str, apple: bool) -> Result<(), AppError> {
        validate_id(device_id, "device_id")?;
        let url = format!("{}/managedDevices/{}/wipe", GRAPH_BASE, device_id);
        let body = if apple {
            serde_json::json!({ "keepEnrollmentData": false, "keepUserData": false })
        } else {
            serde_json::json!({
                "keepEnrollmentData": false,
                "keepUserData": false,
                "useProtectedWipe": false,
            })
        };
        self.post_action_json(&url, &body).await
    }

    pub async fn lock_device(&self, device_id: &str) -> Result<(), AppError> {
        validate_id(device_id, "device_id")?;
        let url = format!("{}/managedDevices/{}/remoteLock", GRAPH_BASE, device_id);
        self.post_action(&url).await
    }

    /// iPhone and iPad only: removes the passcode so the user can set a new one
    pub async fn remove_passcode(&self, device_id: &str) -> Result<(), AppError> {
        validate_id(device_id, "device_id")?;
        let url = format!("{}/managedDevices/{}/resetPasscode", GRAPH_BASE, device_id);
        self.post_action(&url).await
    }

    /// The PIN Intune generated for the most recent lock of a Mac, if it has one yet
    pub async fn get_lock_pin(&self, device_id: &str) -> Result<Option<String>, AppError> {
        validate_id(device_id, "device_id")?;
        let url = format!("{}/managedDevices/{}?$select=deviceActionResults", GRAPH_BASE, device_id);
        let resp = self.request_with_retry(|| {
            self.client.get(&url).bearer_auth(&self.access_token)
        }).await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AppError::Graph(text));
        }
        Ok(latest_unlock_pin(&serde_json::from_str(&text)?))
    }

    pub async fn get_autopilot_devices(&self) -> Result<Vec<AutopilotDevice>, AppError> {
        let initial_url = format!(
            "{}/windowsAutopilotDeviceIdentities?$top=200",
            GRAPH_BASE
        );
        self.get_all_pages::<AutopilotDevice>(&initial_url).await
    }

    pub async fn delete_autopilot_device(&self, device_id: &str) -> Result<(), AppError> {
        validate_id(device_id, "autopilot_device_id")?;
        let url = format!(
            "{}/windowsAutopilotDeviceIdentities/{}",
            GRAPH_BASE, device_id
        );

        let resp = self.request_with_retry(|| {
            self.client
                .delete(&url)
                .bearer_auth(&self.access_token)
        }).await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Graph(format!("Delete failed: {}", body)));
        }
        Ok(())
    }

    pub async fn update_autopilot_group_tag(
        &self,
        device_id: &str,
        group_tag: &str,
    ) -> Result<(), AppError> {
        validate_id(device_id, "autopilot_device_id")?;
        let url = format!(
            "{}/windowsAutopilotDeviceIdentities/{}/updateDeviceProperties",
            GRAPH_BASE, device_id
        );

        let body = serde_json::json!({
            "groupTag": group_tag
        });

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.access_token)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let resp_body = resp.text().await.unwrap_or_default();
            return Err(AppError::Graph(format!("Update group tag failed: {}", resp_body)));
        }
        Ok(())
    }

    pub async fn import_autopilot_devices(
        &self,
        entries: Vec<AutopilotImportEntry>,
    ) -> Result<Vec<AutopilotImportResult>, AppError> {
        // Import each device individually since the batch endpoint has limitations
        let mut results = Vec::new();
        for entry in &entries {
            let url = format!(
                "{}/deviceManagement/importedWindowsAutopilotDeviceIdentities",
                GRAPH_BETA
            );

            let resp = self
                .client
                .post(&url)
                .bearer_auth(&self.access_token)
                .json(&entry)
                .send()
                .await?;

            if resp.status().is_success() {
                let result: AutopilotImportResult = resp.json().await?;
                results.push(result);
            } else {
                let body = resp.text().await.unwrap_or_default();
                results.push(AutopilotImportResult {
                    id: String::new(),
                    serial_number: entry.serial_number.clone(),
                    state: Some(AutopilotImportState {
                        device_import_status: Some("error".to_string()),
                        device_error_code: None,
                        device_error_name: Some(body),
                    }),
                });
            }
        }
        Ok(results)
    }

    pub async fn run_remediation(&self, script_id: &str, device_id: &str) -> Result<(), AppError> {
        validate_id(device_id, "device_id")?;
        validate_id(script_id, "script_id")?;
        let url = format!(
            "{}/managedDevices/{}/initiateOnDemandProactiveRemediation",
            GRAPH_BASE, device_id
        );

        let body = serde_json::json!({
            "scriptPolicyId": script_id
        });

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.access_token)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let resp_body = resp.text().await.unwrap_or_default();
            return Err(AppError::Graph(format!("Remediation failed: {}", resp_body)));
        }

        Ok(())
    }

    /// Kept apart from `get_all_pages`: its callers need other permissions, so
    /// mapping their 403s to the app-permission message would mislead
    pub async fn get_mobile_apps(&self) -> Result<Vec<MobileAppSummary>, AppError> {
        let mut apps = Vec::new();
        let mut next_url = Some(format!(
            "{}/deviceAppManagement/mobileApps?$select=id,displayName,publisher",
            GRAPH_BETA
        ));
        while let Some(url) = next_url.take() {
            let resp = self.request_with_retry(|| {
                self.client.get(&url).bearer_auth(&self.access_token)
            }).await?;
            let status = resp.status();
            if !status.is_success() {
                return Err(graph_error(status, resp.text().await.unwrap_or_default()));
            }
            let page: GraphListResponse<MobileAppSummary> = resp.json().await?;
            apps.extend(page.value);
            next_url = page.next_link;
        }
        Ok(apps)
    }

    /// One report query per app, paged; never one request per device
    pub async fn get_app_install_statuses(&self, app_id: &str) -> Result<Vec<AppInstallStatus>, AppError> {
        validate_app_id(app_id)?;
        let url = format!(
            "{}/reports/microsoft.graph.retrieveDeviceAppInstallationStatusReport",
            GRAPH_BASE
        );
        let mut rows = Vec::new();
        loop {
            let body = serde_json::json!({
                "select": ["DeviceName", "DeviceId", "AppVersion", "AppInstallState",
                           "AppInstallStateDetails", "HexErrorCode", "LastModifiedDateTime"],
                "filter": format!("(ApplicationId eq '{}')", app_id),
                "skip": rows.len(),
                "top": 500,
                "orderBy": [],
            });
            let resp = self.request_with_retry(|| {
                self.client.post(&url).bearer_auth(&self.access_token).json(&body)
            }).await?;
            let status = resp.status();
            // Sent as application/octet-stream, so read text rather than .json()
            let text = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(graph_error(status, text));
            }
            let page = parse_install_report(&serde_json::from_str(&text)?)?;
            let received = page.rows.len();
            rows.extend(page.rows);
            if received == 0 || rows.len() >= page.total {
                return Ok(rows);
            }
        }
    }

    /// Every app assigned to one device, with its state from the same report the App installs
    /// tab reads. Intune can't filter that report by device, but it can search it by device
    /// name, so this is one small query per assigned app rather than one per app's whole fleet.
    pub async fn get_device_app_states(&self, device_id: &str, device_name: &str, upn: Option<&str>) -> Result<Vec<DeviceAppState>, AppError> {
        use futures_util::{StreamExt, TryStreamExt};
        validate_id(device_id, "device_id")?;
        // Device-assigned apps sit under the all-zeros user; the primary user adds user-assigned ones
        let mut apps = self.get_intent_list(NO_USER, device_id).await?.unwrap_or_default();
        if let Some(user) = upn.filter(|u| validate_id(u, "user").is_ok()) {
            for app in self.get_intent_list(user, device_id).await.ok().flatten().unwrap_or_default() {
                if !apps.iter().any(|a| a.app_id == app.app_id) {
                    apps.push(app);
                }
            }
        }
        futures_util::stream::iter(apps)
            .map(|app| self.fill_app_state(app, device_id, device_name))
            // Intune throttles this report tightly; the App installs tab may be polling it too
            .buffered(2)
            .try_collect()
            .await
    }

    /// `None` when Intune has no intent list for this user on the device
    async fn get_intent_list(&self, user: &str, device_id: &str) -> Result<Option<Vec<DeviceAppState>>, AppError> {
        let url = format!("{}/users/{}/mobileAppIntentAndStates/{}", GRAPH_BETA, user, device_id);
        let resp = self.request_with_retry(|| self.client.get(&url).bearer_auth(&self.access_token)).await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(graph_error(status, text));
        }
        Ok(Some(parse_intent_list(&serde_json::from_str(&text)?)))
    }

    async fn fill_app_state(&self, mut app: DeviceAppState, device_id: &str, device_name: &str) -> Result<DeviceAppState, AppError> {
        if validate_app_id(&app.app_id).is_err() {
            return Ok(app);
        }
        let url = format!("{}/reports/microsoft.graph.retrieveDeviceAppInstallationStatusReport", GRAPH_BASE);
        let body = serde_json::json!({
            "select": ["DeviceName", "DeviceId", "AppVersion", "AppInstallState",
                       "AppInstallStateDetails", "HexErrorCode", "LastModifiedDateTime"],
            "filter": format!("(ApplicationId eq '{}')", app.app_id),
            "search": device_name,
            "skip": 0,
            "top": 50,
            "orderBy": [],
        });
        let resp = self.request_with_retry(|| {
            self.client.post(&url).bearer_auth(&self.access_token).json(&body)
        }).await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::MissingPermission);
        }
        // One refused app keeps its fallback state rather than failing the whole list
        if !status.is_success() {
            app.report_error = Some(if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                "Intune is busy; try Refresh in a minute".to_string()
            } else {
                format!("Intune returned HTTP {}", status.as_u16())
            });
            return Ok(app);
        }
        let page = parse_install_report(&serde_json::from_str(&text)?)?;
        // The search matches names containing this one, so keep only this device's rows
        if let Some(row) = newest_row_for(&page.rows, device_id) {
            app.install_state = row.install_state.clone();
            app.state_detail = row.state_detail.clone();
            app.error_code = row.error_code.clone();
            app.last_reported = row.last_reported.clone();
            if row.app_version.is_some() {
                app.app_version = row.app_version.clone();
            }
        }
        Ok(app)
    }

    async fn get_all_pages<T>(&self, initial_url: &str) -> Result<Vec<T>, AppError>
    where
        T: serde::de::DeserializeOwned,
    {
        let mut all_items: Vec<T> = Vec::new();
        let mut next_url: Option<String> = Some(initial_url.to_string());

        while let Some(url) = next_url.take() {
            let resp = self.request_with_retry(|| {
                self.client
                    .get(&url)
                    .bearer_auth(&self.access_token)
            }).await?;

            if !resp.status().is_success() {
                let body = resp.text().await.unwrap_or_default();
                return Err(AppError::Graph(body));
            }

            let page: GraphListResponse<T> = resp.json().await?;

            all_items.extend(page.value);
            next_url = page.next_link;
        }

        Ok(all_items)
    }

    async fn post_action(&self, url: &str) -> Result<(), AppError> {
        let resp = self.request_with_retry(|| {
            self.client
                .post(url)
                .bearer_auth(&self.access_token)
                .header("Content-Length", "0")
        }).await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Graph(body));
        }

        Ok(())
    }

    async fn post_action_json(&self, url: &str, body: &serde_json::Value) -> Result<(), AppError> {
        let resp = self.request_with_retry(|| {
            self.client
                .post(url)
                .bearer_auth(&self.access_token)
                .json(body)
        }).await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Graph(text));
        }

        Ok(())
    }

    /// Retry a request up to 3 times with exponential backoff on 429 and 5xx errors; 429 waits longer
    async fn request_with_retry<F>(
        &self,
        build_request: F,
    ) -> Result<reqwest::Response, reqwest::Error>
    where
        F: Fn() -> reqwest::RequestBuilder,
    {
        let max_retries = 3;
        let mut last_resp = None;

        for attempt in 0..=max_retries {
            let resp = build_request().send().await?;
            let status = resp.status();

            if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
                if attempt < max_retries {
                    // Check for Retry-After header
                    let retry_after = resp
                        .headers()
                        .get("Retry-After")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(0);

                    // A 429 often says "retry after 0", which is no reason to hammer it again at once
                    let floor = if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        2u64.pow(attempt as u32 + 1) // 2s, 4s, 8s
                    } else {
                        2u64.pow(attempt as u32) // 1s, 2s, 4s
                    };
                    let backoff = std::cmp::max(retry_after, floor);
                    tokio::time::sleep(Duration::from_secs(backoff)).await;
                    last_resp = Some(resp);
                    continue;
                }
                return Ok(resp);
            }

            return Ok(resp);
        }

        // Should not reach here, but return last response if we do
        Ok(last_resp.unwrap())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn intent_list_drops_unknown_states_and_nameless_ids() {
        let body = serde_json::json!({ "mobileAppList": [
            { "applicationId": "a", "displayName": "App A", "mobileAppIntent": "requiredInstall", "displayVersion": "", "installState": "unknown" },
            { "applicationId": "b", "displayName": "App B", "mobileAppIntent": "requiredInstall", "displayVersion": "2.0", "installState": "installed" },
            { "displayName": "No id" },
        ]});
        let apps = parse_intent_list(&body);
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].install_state, None);
        assert_eq!(apps[0].app_version, None);
        assert_eq!(apps[1].install_state.as_deref(), Some("installed"));
        assert_eq!(apps[1].app_version.as_deref(), Some("2.0"));
    }

    #[test]
    fn newest_row_is_for_this_device_only() {
        let row = |id: &str, at: &str, state: &str| AppInstallStatus {
            device_id: Some(id.into()), device_name: None, install_state: Some(state.into()),
            state_detail: None, error_code: None, last_reported: Some(at.into()), app_version: None,
        };
        let rows = vec![
            row("DEV-1", "2026-06-01T00:00:00Z", "Failed"),
            row("dev-1", "2026-09-01T00:00:00Z", "Installed"),
            row("dev-10", "2026-10-01T00:00:00Z", "Failed"),
        ];
        assert_eq!(newest_row_for(&rows, "dev-1").and_then(|r| r.install_state.as_deref()), Some("Installed"));
        assert!(newest_row_for(&rows, "dev-2").is_none());
    }

    #[test]
    fn unlock_pin_comes_from_the_newest_lock() {
        let device = serde_json::json!({ "deviceActionResults": [
            { "actionName": "remoteLock", "startDateTime": "2026-11-01T10:00:00Z", "unlockPin": "111111" },
            { "actionName": "syncDevice", "startDateTime": "2026-11-05T10:00:00Z" },
            { "actionName": "remoteLock", "startDateTime": "2026-11-04T10:00:00Z", "unlockPin": "222222" },
        ]});
        assert_eq!(latest_unlock_pin(&device).as_deref(), Some("222222"));
        assert_eq!(latest_unlock_pin(&serde_json::json!({ "deviceActionResults": [] })), None);
        assert_eq!(latest_unlock_pin(&serde_json::json!({})), None);
    }

    use super::*;
    use reqwest::StatusCode;
    use serde_json::json;

    #[test]
    fn parses_report_rows_by_column_name_not_position() {
        let body = json!({"TotalRowCount": 1,
            "Schema": [{"Column": "HexErrorCode"}, {"Column": "DeviceId"}, {"Column": "DeviceName"},
                       {"Column": "AppInstallState_loc"}, {"Column": "AppInstallStateDetails_loc"},
                       {"Column": "LastModifiedDateTime"}, {"Column": "AppVersion"}],
            "Values": [["0x87D30066", "abc", "LAB-R-07", "Failed", "Failed to download content.", "2026-11-04T19:36:07", "2.15.0000"]]});
        let page = parse_install_report(&body).unwrap();
        assert_eq!(page.total, 1);
        let row = &page.rows[0];
        assert_eq!(row.device_id.as_deref(), Some("abc"));
        assert_eq!(row.device_name.as_deref(), Some("LAB-R-07"));
        assert_eq!(row.install_state.as_deref(), Some("Failed"));
        assert_eq!(row.state_detail.as_deref(), Some("Failed to download content."));
        assert_eq!(row.error_code.as_deref(), Some("0x87D30066"));
        assert_eq!(row.app_version.as_deref(), Some("2.15.0000"));
    }

    #[test]
    fn report_times_without_an_offset_are_utc() {
        let body = json!({"TotalRowCount": 2, "Schema": [{"Column": "LastModifiedDateTime"}],
            "Values": [["2026-10-26T15:15:47"], ["2026-10-26T15:15:47+02:00"]]});
        let page = parse_install_report(&body).unwrap();
        assert_eq!(page.rows[0].last_reported.as_deref(), Some("2026-10-26T15:15:47Z"));
        assert_eq!(page.rows[1].last_reported.as_deref(), Some("2026-10-26T15:15:47+02:00"));
    }

    #[test]
    fn treats_missing_columns_and_nulls_and_blanks_as_none() {
        let body = json!({"TotalRowCount": 1, "Schema": [{"Column": "DeviceName"}, {"Column": "HexErrorCode"}],
            "Values": [[null, ""]]});
        let row = &parse_install_report(&body).unwrap().rows[0];
        assert_eq!(row.device_name, None);
        assert_eq!(row.error_code, None);
        assert_eq!(row.device_id, None);
    }

    #[test]
    fn empty_report_has_no_rows() {
        let body = json!({"TotalRowCount": 0, "Schema": [{"Column": "DeviceId"}], "Values": []});
        let page = parse_install_report(&body).unwrap();
        assert!(page.rows.is_empty());
        assert_eq!(page.total, 0);
    }

    #[test]
    fn report_without_schema_is_an_error() {
        assert!(parse_install_report(&json!({"error": "x"})).is_err());
    }

    #[test]
    fn rejects_quote_in_app_id() {
        assert!(validate_app_id("a' or '1'='1").is_err());
        assert!(validate_app_id("f7aa2cbf-19f4-4286-9d23-77538b8bbfd6").is_ok());
    }

    #[test]
    fn forbidden_maps_to_missing_permission() {
        assert!(matches!(graph_error(StatusCode::FORBIDDEN, "x".into()), AppError::MissingPermission));
        assert!(matches!(graph_error(StatusCode::BAD_REQUEST, "x".into()), AppError::Graph(_)));
    }
}
