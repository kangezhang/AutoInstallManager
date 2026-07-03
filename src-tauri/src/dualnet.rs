use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const CLIENT_PRESET_IP: &str = "192.168.209.253";
const CLIENT_PRESET_MASK: &str = "255.255.255.0";
const CLIENT_PRESET_GATEWAY: &str = "192.168.209.111";
const CLIENT_PRESET_DNS_PRIMARY: &str = "192.168.0.181";
const CLIENT_PRESET_DNS_SECONDARY: &str = "192.168.0.53";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAdapterInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub interface_index: u32,
    pub status: String,
    pub ipv4_addresses: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DualNetScanReport {
    pub supported: bool,
    pub is_admin: bool,
    pub adapters: Vec<NetworkAdapterInfo>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientIpModeRequest {
    pub interface_index: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientIpPreset {
    pub ip: String,
    pub subnet_mask: String,
    pub gateway: String,
    pub dns_primary: String,
    pub dns_secondary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientIpModeResult {
    pub mode: String,
    pub interface_index: u32,
    pub adapter_name: String,
    pub preset: Option<ClientIpPreset>,
    pub message: String,
}

pub fn client_ip_preset() -> ClientIpPreset {
    ClientIpPreset {
        ip: CLIENT_PRESET_IP.to_string(),
        subnet_mask: CLIENT_PRESET_MASK.to_string(),
        gateway: CLIENT_PRESET_GATEWAY.to_string(),
        dns_primary: CLIENT_PRESET_DNS_PRIMARY.to_string(),
        dns_secondary: CLIENT_PRESET_DNS_SECONDARY.to_string(),
    }
}

pub fn apply_client_ip_preset(request: ClientIpModeRequest) -> AppResult<ClientIpModeResult> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Validation(
            "Client IPv4 preset is only supported on Windows.".to_string(),
        ));
    }
    validate_interface_index(request.interface_index)?;

    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$adapter = Get-NetAdapter -InterfaceIndex {} -ErrorAction Stop
$name = $adapter.Name

& netsh interface ipv4 set address name=$name static {} {} {} 1 | Out-Null
if ($LASTEXITCODE -ne 0) {{
  throw "netsh set address failed with exit code $LASTEXITCODE"
}}

& netsh interface ipv4 set dnsservers name=$name static {} primary validate=no | Out-Null
if ($LASTEXITCODE -ne 0) {{
  throw "netsh set primary dns failed with exit code $LASTEXITCODE"
}}

& netsh interface ipv4 add dnsservers name=$name address={} index=2 validate=no | Out-Null
if ($LASTEXITCODE -ne 0) {{
  throw "netsh add secondary dns failed with exit code $LASTEXITCODE"
}}

$name
"#,
        request.interface_index,
        ps_quote(CLIENT_PRESET_IP),
        ps_quote(CLIENT_PRESET_MASK),
        ps_quote(CLIENT_PRESET_GATEWAY),
        ps_quote(CLIENT_PRESET_DNS_PRIMARY),
        ps_quote(CLIENT_PRESET_DNS_SECONDARY)
    );

    let adapter_name = run_powershell(&script)?;
    Ok(ClientIpModeResult {
        mode: "preset".to_string(),
        interface_index: request.interface_index,
        adapter_name,
        preset: Some(client_ip_preset()),
        message: "已切换为互联预设。用于两台电脑互相 ping 通。".to_string(),
    })
}

pub fn restore_client_dhcp(request: ClientIpModeRequest) -> AppResult<ClientIpModeResult> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Validation(
            "Client DHCP restore is only supported on Windows.".to_string(),
        ));
    }
    validate_interface_index(request.interface_index)?;

    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$adapter = Get-NetAdapter -InterfaceIndex {} -ErrorAction Stop
$name = $adapter.Name

& netsh interface ipv4 set address name=$name source=dhcp | Out-Null
if ($LASTEXITCODE -ne 0) {{
  throw "netsh set address dhcp failed with exit code $LASTEXITCODE"
}}

& netsh interface ipv4 set dnsservers name=$name source=dhcp | Out-Null
if ($LASTEXITCODE -ne 0) {{
  throw "netsh set dns dhcp failed with exit code $LASTEXITCODE"
}}

$name
"#,
        request.interface_index
    );

    let adapter_name = run_powershell(&script)?;
    Ok(ClientIpModeResult {
        mode: "dhcp".to_string(),
        interface_index: request.interface_index,
        adapter_name,
        preset: None,
        message: "已切换为自动获取 IP 和 DNS。用于恢复正常上网。".to_string(),
    })
}

pub fn scan() -> AppResult<DualNetScanReport> {
    if !cfg!(target_os = "windows") {
        return Ok(DualNetScanReport {
            supported: false,
            is_admin: false,
            adapters: vec![],
            warnings: vec!["DualNet currently targets Windows networking APIs.".to_string()],
        });
    }

    let raw = run_powershell(SCAN_SCRIPT)?;
    let root: Value = serde_json::from_str(&raw).map_err(|e| {
        AppError::Other(format!(
            "failed to parse DualNet scan output: {e}; output={raw}"
        ))
    })?;
    Ok(parse_scan_report(&root))
}

fn parse_scan_report(root: &Value) -> DualNetScanReport {
    let is_admin = root
        .get("is_admin")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let ip_configs = parse_ip_configs(root.get("ip_configs"));

    let mut adapters = Vec::new();
    for item in value_list(root.get("adapters")) {
        let interface_index = get_u32(item, "InterfaceIndex").unwrap_or(0);
        let name =
            get_string(item, "Name").unwrap_or_else(|| format!("Interface {interface_index}"));
        let description = get_string(item, "InterfaceDescription").unwrap_or_default();
        let status = get_string(item, "Status").unwrap_or_else(|| "Unknown".to_string());
        let ip = ip_configs
            .get(&interface_index)
            .cloned()
            .unwrap_or_default();

        adapters.push(NetworkAdapterInfo {
            id: interface_index.to_string(),
            name,
            description,
            interface_index,
            status,
            ipv4_addresses: ip.ipv4_addresses,
        });
    }

    adapters.sort_by_key(|adapter| {
        (
            !adapter.status.eq_ignore_ascii_case("up"),
            adapter.interface_index,
        )
    });

    let mut warnings = Vec::new();
    if !is_admin {
        warnings.push("当前不是管理员权限，应用网卡设置可能需要提权。".to_string());
    }

    DualNetScanReport {
        supported: true,
        is_admin,
        adapters,
        warnings,
    }
}

#[derive(Debug, Clone, Default)]
struct IpConfig {
    ipv4_addresses: Vec<String>,
}

fn parse_ip_configs(value: Option<&Value>) -> BTreeMap<u32, IpConfig> {
    let mut map = BTreeMap::new();
    for item in value_list(value) {
        let Some(index) = get_u32(item, "InterfaceIndex") else {
            continue;
        };
        map.insert(
            index,
            IpConfig {
                ipv4_addresses: string_list(item.get("IPv4Addresses")),
            },
        );
    }
    map
}

fn value_list(value: Option<&Value>) -> Vec<&Value> {
    match value {
        Some(Value::Array(items)) => items.iter().collect(),
        Some(Value::Null) | None => vec![],
        Some(other) => vec![other],
    }
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => vec![],
    }
}

fn get_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn get_u32(value: &Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
}

fn validate_interface_index(interface_index: u32) -> AppResult<()> {
    if interface_index == 0 {
        return Err(AppError::Validation(
            "请选择要配置的第二台电脑网卡。".to_string(),
        ));
    }
    Ok(())
}

fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn run_powershell(script: &str) -> AppResult<String> {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().map_err(AppError::Io)?;

    if !output.status.success() {
        return Err(AppError::Other(format!(
            "PowerShell failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

const SCAN_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$adapters = @(Get-NetAdapter -ErrorAction Stop | Select-Object Name, InterfaceDescription, InterfaceIndex, Status)

$ipConfigs = @(Get-NetIPConfiguration -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    InterfaceIndex = $_.InterfaceIndex
    IPv4Addresses = @($_.IPv4Address | ForEach-Object { $_.IPAddress })
  }
})

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

[pscustomobject]@{
  is_admin = $isAdmin
  adapters = @($adapters)
  ip_configs = @($ipConfigs)
} | ConvertTo-Json -Depth 6 -Compress
"#;
