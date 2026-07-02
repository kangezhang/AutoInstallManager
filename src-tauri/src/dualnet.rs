use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::io::ErrorKind;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use url::Url;

const NAT_NAME: &str = "DualNetBridgeNat";
const INTERNAL_IP: &str = "192.168.77.1";
const INTERNAL_NETWORK: &str = "192.168.77.0/24";
const CLIENT_IP: &str = "192.168.77.100";
const DISCOVERY_PORT: u16 = 37777;
const DEFAULT_PROXY_PORT: u16 = 7890;
const CLIENT_PRESET_IP: &str = "192.168.209.253";
const CLIENT_PRESET_MASK: &str = "255.255.255.0";
const CLIENT_PRESET_GATEWAY: &str = "192.168.209.111";
const CLIENT_PRESET_DNS_PRIMARY: &str = "192.168.0.181";
const CLIENT_PRESET_DNS_SECONDARY: &str = "192.168.0.53";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DualNetConfig {
    pub gateway: GatewayConfig,
    pub client: ClientConfig,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfig {
    pub mode: String,
    pub internal_ip: String,
    pub internal_prefix: u8,
    pub internal_network: String,
    pub nat_name: String,
    pub dns_fallback: Vec<String>,
    pub discovery_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub gateway_ip: String,
    pub client_ip: String,
    pub prefix: u8,
    pub dns: String,
    pub discovery_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAdapterInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub interface_index: u32,
    pub status: String,
    pub mac_address: Option<String>,
    pub link_speed: Option<String>,
    pub ipv4_addresses: Vec<String>,
    pub dns_servers: Vec<String>,
    pub default_gateway: Option<String>,
    pub dhcp_enabled: bool,
    pub is_default_route: bool,
    pub is_protected: bool,
    pub is_candidate: bool,
    pub is_virtual: bool,
    pub risk_flags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NatStatus {
    pub exists: bool,
    pub name: String,
    pub internal_ip_interface_address_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DualNetScanReport {
    pub supported: bool,
    pub is_admin: bool,
    pub adapters: Vec<NetworkAdapterInfo>,
    pub protected_adapter: Option<NetworkAdapterInfo>,
    pub internal_candidates: Vec<NetworkAdapterInfo>,
    pub nat_status: NatStatus,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub id: String,
    pub label: String,
    pub status: DiagnosticStatus,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DualNetDiagnostics {
    pub role: String,
    pub checks: Vec<DiagnosticCheck>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticStatus {
    Pass,
    Warning,
    Fail,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalAdapterSelection {
    pub interface_index: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterValidation {
    pub ok: bool,
    pub message: String,
    pub adapter: Option<NetworkAdapterInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElevationResult {
    pub started: bool,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStartRequest {
    pub bind_ip: String,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientProxyRequest {
    pub gateway_ip: String,
    pub port: Option<u16>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub running: bool,
    pub bind_ip: Option<String>,
    pub port: u16,
    pub endpoint: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyActionResult {
    pub ok: bool,
    pub status: ProxyStatus,
}

#[derive(Default)]
pub struct ProxyRuntime {
    state: Mutex<Option<ProxyHandle>>,
}

struct ProxyHandle {
    bind_ip: String,
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

pub fn default_config() -> DualNetConfig {
    DualNetConfig {
        gateway: GatewayConfig {
            mode: "advanced_nat".to_string(),
            internal_ip: INTERNAL_IP.to_string(),
            internal_prefix: 24,
            internal_network: INTERNAL_NETWORK.to_string(),
            nat_name: NAT_NAME.to_string(),
            dns_fallback: vec!["223.5.5.5".to_string(), "114.114.114.114".to_string()],
            discovery_port: DISCOVERY_PORT,
        },
        client: ClientConfig {
            gateway_ip: INTERNAL_IP.to_string(),
            client_ip: CLIENT_IP.to_string(),
            prefix: 24,
            dns: INTERNAL_IP.to_string(),
            discovery_port: DISCOVERY_PORT,
        },
    }
}

impl ProxyRuntime {
    pub fn status(&self) -> ProxyStatus {
        let mut state = self.state.lock().expect("proxy runtime mutex poisoned");
        if let Some(handle) = state.as_ref() {
            if handle.task.is_finished() {
                *state = None;
            }
        }

        match state.as_ref() {
            Some(handle) => ProxyStatus {
                running: true,
                bind_ip: Some(handle.bind_ip.clone()),
                port: handle.port,
                endpoint: Some(format!("{}:{}", handle.bind_ip, handle.port)),
                message: "代理服务正在运行。".to_string(),
            },
            None => ProxyStatus {
                running: false,
                bind_ip: None,
                port: DEFAULT_PROXY_PORT,
                endpoint: None,
                message: "代理服务未启动。".to_string(),
            },
        }
    }

    pub async fn start(&self, request: ProxyStartRequest) -> AppResult<ProxyActionResult> {
        let bind_ip = request.bind_ip.trim().to_string();
        if bind_ip.is_empty() || bind_ip == "0.0.0.0" || bind_ip == "::" {
            return Err(AppError::Validation(
                "代理模式必须绑定到明确的本机 IP，不能监听 0.0.0.0。".to_string(),
            ));
        }

        let ip: IpAddr = bind_ip
            .parse()
            .map_err(|_| AppError::Validation(format!("无效的绑定 IP：{bind_ip}")))?;
        let report = scan()?;
        let local_ipv4 = report
            .adapters
            .iter()
            .flat_map(|adapter| adapter.ipv4_addresses.iter())
            .collect::<Vec<_>>();
        if !local_ipv4.iter().any(|local| local.as_str() == bind_ip) {
            return Err(AppError::Validation(format!(
                "{bind_ip} 不是当前这台电脑的 IP。请在第一台电脑上选择本机 IPv4 地址；第二台电脑只需要在下方填写第一台电脑 IP。"
            )));
        }
        let port = request.port.unwrap_or(DEFAULT_PROXY_PORT);
        let addr = SocketAddr::new(ip, port);

        {
            let mut state = self.state.lock().expect("proxy runtime mutex poisoned");
            if let Some(mut handle) = state.take() {
                if let Some(shutdown) = handle.shutdown.take() {
                    let _ = shutdown.send(());
                }
                handle.task.abort();
            }
        }

        let listener = TcpListener::bind(addr).await.map_err(|e| {
            let detail = match e.raw_os_error() {
                Some(10049) => {
                    format!("{bind_ip} 不是当前这台电脑可监听的地址。请换成本机 IPv4 地址。")
                }
                Some(10048) => format!("{bind_ip}:{port} 已被占用，请换一个端口。"),
                _ => format!("无法监听代理端口 {bind_ip}:{port}：{e}"),
            };
            AppError::Network(detail)
        })?;
        ensure_proxy_firewall_rule(&bind_ip, port)?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let task_bind_ip = bind_ip.clone();
        let task = tokio::spawn(async move {
            run_proxy(listener, shutdown_rx).await;
            tracing::info!("DualNet proxy stopped on {task_bind_ip}:{port}");
        });

        let mut state = self.state.lock().expect("proxy runtime mutex poisoned");
        *state = Some(ProxyHandle {
            bind_ip,
            port,
            shutdown: Some(shutdown_tx),
            task,
        });

        Ok(ProxyActionResult {
            ok: true,
            status: self.status(),
        })
    }

    pub async fn stop(&self) -> AppResult<ProxyActionResult> {
        let handle = {
            self.state
                .lock()
                .expect("proxy runtime mutex poisoned")
                .take()
        };
        if let Some(mut handle) = handle {
            let bind_ip = handle.bind_ip.clone();
            let port = handle.port;
            if let Some(shutdown) = handle.shutdown.take() {
                let _ = shutdown.send(());
            }
            handle.task.abort();
            let _ = remove_proxy_firewall_rule(&bind_ip, port);
        }

        Ok(ProxyActionResult {
            ok: true,
            status: self.status(),
        })
    }
}

pub fn apply_client_proxy(request: ClientProxyRequest) -> AppResult<ProxyStatus> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Validation(
            "Client proxy setup is only supported on Windows.".to_string(),
        ));
    }

    let gateway_ip = request.gateway_ip.trim();
    if gateway_ip.is_empty() || gateway_ip.parse::<IpAddr>().is_err() {
        return Err(AppError::Validation(format!(
            "无效的 Gateway IP：{gateway_ip}"
        )));
    }

    let port = request.port.unwrap_or(DEFAULT_PROXY_PORT);
    let backup = client_proxy_backup_path()?;
    if !backup.exists() {
        let script = format!(
            r#"
$ErrorActionPreference = 'Stop'
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$backupPath = {}
$current = Get-ItemProperty -Path $path
[pscustomobject]@{{
  ProxyEnable = $current.ProxyEnable
  ProxyServer = $current.ProxyServer
  ProxyOverride = $current.ProxyOverride
}} | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -Path $backupPath
"#,
            ps_quote_path(&backup)
        );
        run_powershell(&script)?;
    }

    let proxy_server = format!("http={gateway_ip}:{port};https={gateway_ip}:{port}");
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value 1
Set-ItemProperty -Path $path -Name ProxyServer -Type String -Value {}
Set-ItemProperty -Path $path -Name ProxyOverride -Type String -Value '<local>'

function Invoke-DualNetProxyRefresh {{
  if (-not ('DualNetWinInet.Native' -as [type])) {{
    Add-Type -Namespace DualNetWinInet -Name Native -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("wininet.dll", SetLastError = true)]
public static extern bool InternetSetOption(System.IntPtr hInternet, int dwOption, System.IntPtr lpBuffer, int dwBufferLength);
"@
  }}
  [DualNetWinInet.Native]::InternetSetOption([System.IntPtr]::Zero, 39, [System.IntPtr]::Zero, 0) | Out-Null
  [DualNetWinInet.Native]::InternetSetOption([System.IntPtr]::Zero, 37, [System.IntPtr]::Zero, 0) | Out-Null
}}

Invoke-DualNetProxyRefresh
& netsh winhttp import proxy source=ie | Out-Null
if ($LASTEXITCODE -ne 0) {{
  throw "netsh winhttp import proxy source=ie failed with exit code $LASTEXITCODE"
}}
"#,
        ps_quote(&proxy_server)
    );
    run_powershell(&script)?;

    Ok(ProxyStatus {
        running: true,
        bind_ip: Some(gateway_ip.to_string()),
        port,
        endpoint: Some(format!("{gateway_ip}:{port}")),
        message: "已设置当前用户的 Windows HTTP/HTTPS 系统代理。".to_string(),
    })
}

pub fn restore_client_proxy() -> AppResult<ProxyStatus> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Validation(
            "Client proxy restore is only supported on Windows.".to_string(),
        ));
    }

    let backup = client_proxy_backup_path()?;
    if !backup.exists() {
        run_powershell(
            r#"
$ErrorActionPreference = 'Stop'
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value 0

function Invoke-DualNetProxyRefresh {
  if (-not ('DualNetWinInet.Native' -as [type])) {
    Add-Type -Namespace DualNetWinInet -Name Native -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("wininet.dll", SetLastError = true)]
public static extern bool InternetSetOption(System.IntPtr hInternet, int dwOption, System.IntPtr lpBuffer, int dwBufferLength);
"@
  }
  [DualNetWinInet.Native]::InternetSetOption([System.IntPtr]::Zero, 39, [System.IntPtr]::Zero, 0) | Out-Null
  [DualNetWinInet.Native]::InternetSetOption([System.IntPtr]::Zero, 37, [System.IntPtr]::Zero, 0) | Out-Null
}

Invoke-DualNetProxyRefresh
& netsh winhttp reset proxy | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "netsh winhttp reset proxy failed with exit code $LASTEXITCODE"
}
"#,
        )?;
        return Ok(ProxyStatus {
            running: false,
            bind_ip: None,
            port: DEFAULT_PROXY_PORT,
            endpoint: None,
            message: "未找到备份，已关闭当前用户系统代理。".to_string(),
        });
    }

    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$backup = Get-Content -Raw -Path {} | ConvertFrom-Json
if ($null -ne $backup.ProxyEnable) {{
  Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value ([int]$backup.ProxyEnable)
}} else {{
  Remove-ItemProperty -Path $path -Name ProxyEnable -ErrorAction SilentlyContinue
}}
if ($null -ne $backup.ProxyServer) {{
  Set-ItemProperty -Path $path -Name ProxyServer -Type String -Value ([string]$backup.ProxyServer)
}} else {{
  Remove-ItemProperty -Path $path -Name ProxyServer -ErrorAction SilentlyContinue
}}
if ($null -ne $backup.ProxyOverride) {{
  Set-ItemProperty -Path $path -Name ProxyOverride -Type String -Value ([string]$backup.ProxyOverride)
}} else {{
  Remove-ItemProperty -Path $path -Name ProxyOverride -ErrorAction SilentlyContinue
}}

function Invoke-DualNetProxyRefresh {{
  if (-not ('DualNetWinInet.Native' -as [type])) {{
    Add-Type -Namespace DualNetWinInet -Name Native -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("wininet.dll", SetLastError = true)]
public static extern bool InternetSetOption(System.IntPtr hInternet, int dwOption, System.IntPtr lpBuffer, int dwBufferLength);
"@
  }}
  [DualNetWinInet.Native]::InternetSetOption([System.IntPtr]::Zero, 39, [System.IntPtr]::Zero, 0) | Out-Null
  [DualNetWinInet.Native]::InternetSetOption([System.IntPtr]::Zero, 37, [System.IntPtr]::Zero, 0) | Out-Null
}}

Invoke-DualNetProxyRefresh
& netsh winhttp import proxy source=ie | Out-Null
if ($LASTEXITCODE -ne 0) {{
  throw "netsh winhttp import proxy source=ie failed with exit code $LASTEXITCODE"
}}
Remove-Item -Path {} -Force -ErrorAction SilentlyContinue
"#,
        ps_quote_path(&backup),
        ps_quote_path(&backup)
    );
    run_powershell(&script)?;

    Ok(ProxyStatus {
        running: false,
        bind_ip: None,
        port: DEFAULT_PROXY_PORT,
        endpoint: None,
        message: "已恢复当前用户原系统代理设置。".to_string(),
    })
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
            protected_adapter: None,
            internal_candidates: vec![],
            nat_status: NatStatus {
                exists: false,
                name: NAT_NAME.to_string(),
                internal_ip_interface_address_prefix: None,
            },
            warnings: vec!["DualNet Bridge currently targets Windows networking APIs.".to_string()],
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

pub fn nat_status() -> AppResult<NatStatus> {
    Ok(scan()?.nat_status)
}

pub fn relaunch_as_admin() -> AppResult<ElevationResult> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Validation(
            "Elevation is only supported on Windows.".to_string(),
        ));
    }

    let exe = std::env::current_exe()
        .map_err(|e| AppError::Other(format!("failed to resolve current executable: {e}")))?;
    let cwd = std::env::current_dir()
        .map_err(|e| AppError::Other(format!("failed to resolve current directory: {e}")))?;

    let script = r#"
$ErrorActionPreference = 'Stop'
$exe = $env:DUALNET_ELEVATE_EXE
$cwd = $env:DUALNET_ELEVATE_CWD
if ([string]::IsNullOrWhiteSpace($exe)) {
  throw 'DUALNET_ELEVATE_EXE is empty'
}
if ([string]::IsNullOrWhiteSpace($cwd)) {
  Start-Process -FilePath $exe -Verb RunAs
} else {
  Start-Process -FilePath $exe -WorkingDirectory $cwd -Verb RunAs
}
"#;

    let output = Command::new("powershell.exe")
        .env("DUALNET_ELEVATE_EXE", exe)
        .env("DUALNET_ELEVATE_CWD", cwd)
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(AppError::Io)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Other(if stderr.is_empty() {
            "failed to start elevated process".to_string()
        } else {
            stderr
        }));
    }

    Ok(ElevationResult {
        started: true,
        message: "Administrator launch was requested. Confirm the Windows UAC prompt to continue."
            .to_string(),
    })
}

pub fn validate_internal_adapter(
    selection: InternalAdapterSelection,
) -> AppResult<AdapterValidation> {
    let report = scan()?;
    let adapter = report
        .adapters
        .iter()
        .find(|a| a.interface_index == selection.interface_index)
        .cloned();

    let Some(adapter) = adapter else {
        return Ok(AdapterValidation {
            ok: false,
            message: "Adapter not found. Please scan again.".to_string(),
            adapter: None,
        });
    };

    if adapter.is_protected {
        return Ok(AdapterValidation {
            ok: false,
            message: "该网卡是当前默认出口/公司网络出口，已被保护，不能作为内网网卡使用。"
                .to_string(),
            adapter: Some(adapter),
        });
    }

    if !adapter.is_candidate {
        return Ok(AdapterValidation {
            ok: false,
            message: format!(
                "该网卡暂不适合作为内网侧：{}",
                adapter.risk_flags.join("；")
            ),
            adapter: Some(adapter),
        });
    }

    Ok(AdapterValidation {
        ok: true,
        message: "该网卡可作为连接第二台电脑的内网侧候选。".to_string(),
        adapter: Some(adapter),
    })
}

pub fn diagnostics(role: Option<String>) -> AppResult<DualNetDiagnostics> {
    let role = role.unwrap_or_else(|| "gateway".to_string());
    let report = scan()?;
    let mut checks = Vec::new();

    checks.push(DiagnosticCheck {
        id: "admin".to_string(),
        label: "管理员权限".to_string(),
        status: if report.is_admin {
            DiagnosticStatus::Pass
        } else {
            DiagnosticStatus::Warning
        },
        detail: if report.is_admin {
            "当前进程具备管理员权限。".to_string()
        } else {
            "当前进程不是管理员权限；真正应用网卡、NAT、防火墙配置时需要提权。".to_string()
        },
    });

    match &report.protected_adapter {
        Some(adapter) => checks.push(DiagnosticCheck {
            id: "protected_adapter".to_string(),
            label: "公司出口网卡保护".to_string(),
            status: if adapter.dhcp_enabled {
                DiagnosticStatus::Pass
            } else {
                DiagnosticStatus::Warning
            },
            detail: format!(
                "{} 已识别为默认出口{}。",
                adapter.name,
                if adapter.dhcp_enabled {
                    "，并保持 DHCP"
                } else {
                    "，但 DHCP 状态不是 Enabled"
                }
            ),
        }),
        None => checks.push(DiagnosticCheck {
            id: "protected_adapter".to_string(),
            label: "公司出口网卡保护".to_string(),
            status: DiagnosticStatus::Fail,
            detail: "未找到默认路由对应的出口网卡。".to_string(),
        }),
    }

    checks.push(DiagnosticCheck {
        id: "internal_candidate".to_string(),
        label: "内网网卡候选".to_string(),
        status: if report.internal_candidates.is_empty() {
            DiagnosticStatus::Warning
        } else {
            DiagnosticStatus::Pass
        },
        detail: if report.internal_candidates.is_empty() {
            "未找到明确可用于连接第二台电脑的网卡。".to_string()
        } else {
            format!(
                "找到 {} 个内网侧候选网卡。",
                report.internal_candidates.len()
            )
        },
    });

    checks.push(DiagnosticCheck {
        id: "nat".to_string(),
        label: "DualNet NAT 规则".to_string(),
        status: if report.nat_status.exists {
            DiagnosticStatus::Pass
        } else {
            DiagnosticStatus::Warning
        },
        detail: if report.nat_status.exists {
            format!(
                "{} 已存在，网段 {:?}。",
                report.nat_status.name, report.nat_status.internal_ip_interface_address_prefix
            )
        } else {
            format!("未检测到 {} NAT 规则。", NAT_NAME)
        },
    });

    let has_fail = checks
        .iter()
        .any(|check| matches!(check.status, DiagnosticStatus::Fail));
    let has_warning = checks
        .iter()
        .any(|check| matches!(check.status, DiagnosticStatus::Warning));

    let summary = if has_fail {
        "基础条件不完整，先处理失败项。".to_string()
    } else if has_warning {
        "基础扫描完成，但应用共享前需要处理警告项。".to_string()
    } else {
        "基础条件正常，可以进入共享配置流程。".to_string()
    };

    Ok(DualNetDiagnostics {
        role,
        checks,
        summary,
    })
}

async fn run_proxy(listener: TcpListener, mut shutdown: oneshot::Receiver<()>) {
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, peer)) => {
                        tokio::spawn(async move {
                            if let Err(err) = handle_proxy_client(stream).await {
                                tracing::debug!("DualNet proxy client {peer} failed: {err}");
                            }
                        });
                    }
                    Err(err) if err.kind() == ErrorKind::Interrupted => continue,
                    Err(err) => {
                        tracing::warn!("DualNet proxy accept failed: {err}");
                        break;
                    }
                }
            }
        }
    }
}

async fn handle_proxy_client(mut client: TcpStream) -> AppResult<()> {
    let mut buffer = Vec::with_capacity(8192);
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let read = client
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::Network(format!("proxy read failed: {e}")))?;
        if read == 0 {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > 64 * 1024 {
            return Err(AppError::Validation(
                "proxy request header too large".to_string(),
            ));
        }
        if let Some(pos) = find_header_end(&buffer) {
            break pos;
        }
    };

    let header_bytes = &buffer[..header_end];
    let rest = buffer[header_end..].to_vec();
    let header_text = String::from_utf8_lossy(header_bytes);
    let mut lines = header_text.split("\r\n");
    let first_line = lines
        .next()
        .ok_or_else(|| AppError::Validation("empty proxy request".to_string()))?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    let version = parts.next().unwrap_or("HTTP/1.1");

    if method.eq_ignore_ascii_case("CONNECT") {
        handle_connect(client, target, rest).await
    } else {
        handle_http(client, method, target, version, &header_text, rest).await
    }
}

async fn handle_connect(mut client: TcpStream, target: &str, rest: Vec<u8>) -> AppResult<()> {
    let mut upstream = TcpStream::connect(target)
        .await
        .map_err(|e| AppError::Network(format!("connect {target} failed: {e}")))?;
    client
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await
        .map_err(|e| AppError::Network(format!("proxy write failed: {e}")))?;
    if !rest.is_empty() {
        upstream
            .write_all(&rest)
            .await
            .map_err(|e| AppError::Network(format!("proxy tunnel write failed: {e}")))?;
    }
    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
    Ok(())
}

async fn handle_http(
    mut client: TcpStream,
    method: &str,
    target: &str,
    version: &str,
    header_text: &str,
    rest: Vec<u8>,
) -> AppResult<()> {
    let url = Url::parse(target)
        .map_err(|_| AppError::Validation("HTTP 代理请求必须使用绝对 URL。".to_string()))?;
    if url.scheme() != "http" {
        return Err(AppError::Validation(format!(
            "不支持的 HTTP 代理协议：{}",
            url.scheme()
        )));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Validation("HTTP 代理请求缺少 host。".to_string()))?;
    let port = url.port_or_known_default().unwrap_or(80);
    let mut upstream = TcpStream::connect((host, port))
        .await
        .map_err(|e| AppError::Network(format!("connect {host}:{port} failed: {e}")))?;

    let mut path = url.path().to_string();
    if path.is_empty() {
        path.push('/');
    }
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }

    let mut request = format!("{method} {path} {version}\r\n");
    for line in header_text.split("\r\n").skip(1) {
        if line.is_empty() {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("proxy-connection:")
            || lower.starts_with("proxy-authorization:")
            || lower.starts_with("connection:")
        {
            continue;
        }
        request.push_str(line);
        request.push_str("\r\n");
    }
    request.push_str("Connection: close\r\n\r\n");

    upstream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| AppError::Network(format!("proxy upstream write failed: {e}")))?;
    if !rest.is_empty() {
        upstream
            .write_all(&rest)
            .await
            .map_err(|e| AppError::Network(format!("proxy body write failed: {e}")))?;
    }
    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
    Ok(())
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|pos| pos + 4)
}

fn parse_scan_report(root: &Value) -> DualNetScanReport {
    let is_admin = root
        .get("is_admin")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let default_indices = parse_default_route_indices(root.get("default_routes"));
    let ip_configs = parse_ip_configs(root.get("ip_configs"));
    let ip_interfaces = parse_ip_interfaces(root.get("interfaces"));

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
        let dhcp_enabled = ip_interfaces
            .get(&interface_index)
            .map(|v| v.eq_ignore_ascii_case("enabled"))
            .unwrap_or(false);
        let is_default_route =
            default_indices.contains(&interface_index) || ip.default_gateway.is_some();
        let is_virtual = get_bool(item, "Virtual").unwrap_or(false)
            || description.to_ascii_lowercase().contains("virtual")
            || description.to_ascii_lowercase().contains("vpn");

        let mut risk_flags = Vec::new();
        if !status.eq_ignore_ascii_case("up") {
            risk_flags.push("网卡未连接".to_string());
        }
        if ip.ipv4_addresses.is_empty() {
            risk_flags.push("未检测到 IPv4 地址".to_string());
        }
        if is_virtual {
            risk_flags.push("虚拟或 VPN 网卡".to_string());
        }
        if is_default_route {
            risk_flags.push("默认出口网卡，受保护".to_string());
        }

        let is_protected = is_default_route;
        let is_candidate = status.eq_ignore_ascii_case("up")
            && !is_protected
            && !is_virtual
            && !ip.ipv4_addresses.is_empty();

        adapters.push(NetworkAdapterInfo {
            id: interface_index.to_string(),
            name,
            description,
            interface_index,
            status,
            mac_address: get_string(item, "MacAddress"),
            link_speed: get_string(item, "LinkSpeed"),
            ipv4_addresses: ip.ipv4_addresses,
            dns_servers: ip.dns_servers,
            default_gateway: ip.default_gateway,
            dhcp_enabled,
            is_default_route,
            is_protected,
            is_candidate,
            is_virtual,
            risk_flags,
        });
    }

    adapters.sort_by_key(|adapter| {
        (
            !adapter.is_protected,
            !adapter.is_candidate,
            adapter.interface_index,
        )
    });

    let protected_adapter = adapters.iter().find(|a| a.is_protected).cloned();
    let internal_candidates = adapters
        .iter()
        .filter(|a| a.is_candidate)
        .cloned()
        .collect::<Vec<_>>();
    let nat_status = parse_nat_status(root.get("nat"));

    let mut warnings = Vec::new();
    if protected_adapter.is_none() {
        warnings.push("未能识别默认出口网卡。".to_string());
    }
    if internal_candidates.is_empty() {
        warnings.push("未找到明确的内网侧候选网卡。".to_string());
    }
    if !is_admin {
        warnings.push("当前不是管理员权限，后续应用配置需要提权。".to_string());
    }

    DualNetScanReport {
        supported: true,
        is_admin,
        adapters,
        protected_adapter,
        internal_candidates,
        nat_status,
        warnings,
    }
}

#[derive(Debug, Clone, Default)]
struct IpConfig {
    ipv4_addresses: Vec<String>,
    dns_servers: Vec<String>,
    default_gateway: Option<String>,
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
                dns_servers: string_list(item.get("DnsServers")),
                default_gateway: get_string(item, "DefaultGateway"),
            },
        );
    }
    map
}

fn parse_ip_interfaces(value: Option<&Value>) -> BTreeMap<u32, String> {
    let mut map = BTreeMap::new();
    for item in value_list(value) {
        if let (Some(index), Some(dhcp)) =
            (get_u32(item, "InterfaceIndex"), get_string(item, "Dhcp"))
        {
            map.insert(index, dhcp);
        }
    }
    map
}

fn parse_default_route_indices(value: Option<&Value>) -> BTreeSet<u32> {
    let routes = value_list(value);
    let mut indices = BTreeSet::new();
    if let Some(first) = routes.first() {
        if let Some(index) = get_u32(first, "InterfaceIndex") {
            indices.insert(index);
        }
    }
    indices
}

fn parse_nat_status(value: Option<&Value>) -> NatStatus {
    let nat = value.and_then(|v| {
        if v.is_null() {
            None
        } else if let Some(arr) = v.as_array() {
            arr.first()
        } else {
            Some(v)
        }
    });
    NatStatus {
        exists: nat.is_some(),
        name: NAT_NAME.to_string(),
        internal_ip_interface_address_prefix: nat
            .and_then(|v| get_string(v, "InternalIPInterfaceAddressPrefix")),
    }
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

fn get_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn get_u32(value: &Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
}

fn client_proxy_backup_path() -> AppResult<PathBuf> {
    let base = dirs::config_dir()
        .ok_or_else(|| AppError::Other("failed to resolve config directory".to_string()))?
        .join("DevStackManager")
        .join("dualnet");
    std::fs::create_dir_all(&base)?;
    Ok(base.join("client-proxy-backup.json"))
}

fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn ps_quote_path(path: &PathBuf) -> String {
    ps_quote(&path.to_string_lossy())
}

fn validate_interface_index(interface_index: u32) -> AppResult<()> {
    if interface_index == 0 {
        return Err(AppError::Validation(
            "请选择要配置的第二台电脑网卡。".to_string(),
        ));
    }
    Ok(())
}

fn proxy_firewall_rule_name(bind_ip: &str, port: u16) -> String {
    format!("DualNet Bridge Proxy {bind_ip}:{port}")
}

fn ensure_proxy_firewall_rule(bind_ip: &str, port: u16) -> AppResult<()> {
    if !cfg!(target_os = "windows") {
        return Ok(());
    }

    let exe = std::env::current_exe()
        .map_err(|e| AppError::Other(format!("failed to resolve current executable: {e}")))?;
    let rule_name = proxy_firewall_rule_name(bind_ip, port);
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$name = {}
$program = {}
$localAddress = {}
$port = {}
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
  -DisplayName $name `
  -Group 'DualNet Bridge' `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalAddress $localAddress `
  -LocalPort $port `
  -Program $program `
  -Profile Any | Out-Null
"#,
        ps_quote(&rule_name),
        ps_quote_path(&exe),
        ps_quote(bind_ip),
        port
    );

    run_powershell(&script).map(|_| ()).map_err(|e| {
        AppError::Network(format!(
            "代理已准备监听，但防火墙入站规则创建失败：{}。如果公司策略管理防火墙，需要允许本程序或 TCP 端口 {} 的入站访问。",
            e, port
        ))
    })
}

fn remove_proxy_firewall_rule(bind_ip: &str, port: u16) -> AppResult<()> {
    if !cfg!(target_os = "windows") {
        return Ok(());
    }

    let rule_name = proxy_firewall_rule_name(bind_ip, port);
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -DisplayName {} -ErrorAction SilentlyContinue | Remove-NetFirewallRule
"#,
        ps_quote(&rule_name)
    );
    run_powershell(&script).map(|_| ())
}

fn run_powershell(script: &str) -> AppResult<String> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(AppError::Io)?;

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

$adapters = @(Get-NetAdapter -ErrorAction Stop | Select-Object Name, InterfaceDescription, InterfaceIndex, Status, MacAddress, LinkSpeed, Virtual)

$ipConfigs = @(Get-NetIPConfiguration -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    InterfaceIndex = $_.InterfaceIndex
    IPv4Addresses = @($_.IPv4Address | ForEach-Object { $_.IPAddress })
    DefaultGateway = if ($_.IPv4DefaultGateway) { $_.IPv4DefaultGateway.NextHop } else { $null }
    DnsServers = @($_.DNSServer.ServerAddresses | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' })
  }
})

$interfaces = @(Get-NetIPInterface -AddressFamily IPv4 -ErrorAction Stop | Select-Object InterfaceIndex, Dhcp, ConnectionState, InterfaceMetric)

$defaultRoutes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
  Sort-Object RouteMetric, InterfaceMetric |
  Select-Object InterfaceIndex, NextHop, RouteMetric, InterfaceMetric)

$nat = Get-NetNat -Name 'DualNetBridgeNat' -ErrorAction SilentlyContinue |
  Select-Object Name, InternalIPInterfaceAddressPrefix

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

[pscustomobject]@{
  is_admin = $isAdmin
  adapters = @($adapters)
  ip_configs = @($ipConfigs)
  interfaces = @($interfaces)
  default_routes = @($defaultRoutes)
  nat = $nat
} | ConvertTo-Json -Depth 6 -Compress
"#;
