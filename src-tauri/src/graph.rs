use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
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
    pub expires_at: Instant,
}

impl CachedToken {
    pub fn is_expired(&self) -> bool {
        // Consider expired 5 minutes early to avoid edge cases
        Instant::now() >= self.expires_at - Duration::from_secs(300)
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
            "{}/managedDevices?$select=id,deviceName,userPrincipalName,operatingSystem,osVersion,complianceState,lastSyncDateTime,managementState&$top=200",
            GRAPH_BASE
        );
        self.get_all_pages::<DeviceInfo>(&initial_url).await
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

    /// Retry a request up to 3 times with exponential backoff on 429 and 5xx errors
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

                    let backoff = std::cmp::max(
                        retry_after,
                        2u64.pow(attempt as u32), // 1s, 2s, 4s
                    );
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
