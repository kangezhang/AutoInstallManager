import { useEffect, useMemo, useState } from 'react';
import { IconButton } from '../components/ui/IconButton';
import './DualNetBridge.css';

type Status = 'pass' | 'warning' | 'fail';

interface DualNetConfig {
  gateway: {
    mode: string;
    internalIp: string;
    internalPrefix: number;
    internalNetwork: string;
    natName: string;
    dnsFallback: string[];
    discoveryPort: number;
  };
  client: {
    gatewayIp: string;
    clientIp: string;
    prefix: number;
    dns: string;
    discoveryPort: number;
  };
}

interface NetworkAdapterInfo {
  id: string;
  name: string;
  description: string;
  interfaceIndex: number;
  status: string;
  macAddress?: string | null;
  linkSpeed?: string | null;
  ipv4Addresses: string[];
  dnsServers: string[];
  defaultGateway?: string | null;
  dhcpEnabled: boolean;
  isDefaultRoute: boolean;
  isProtected: boolean;
  isCandidate: boolean;
  isVirtual: boolean;
  riskFlags: string[];
}

interface NatStatus {
  exists: boolean;
  name: string;
  internalIpInterfaceAddressPrefix?: string | null;
}

interface DualNetScanReport {
  supported: boolean;
  isAdmin: boolean;
  adapters: NetworkAdapterInfo[];
  protectedAdapter?: NetworkAdapterInfo | null;
  internalCandidates: NetworkAdapterInfo[];
  natStatus: NatStatus;
  warnings: string[];
}

interface DiagnosticCheck {
  id: string;
  label: string;
  status: Status;
  detail: string;
}

interface DualNetDiagnostics {
  role: string;
  checks: DiagnosticCheck[];
  summary: string;
}

interface AdapterValidation {
  ok: boolean;
  message: string;
  adapter?: NetworkAdapterInfo | null;
}

interface ProxyStatus {
  running: boolean;
  bindIp?: string | null;
  port: number;
  endpoint?: string | null;
  message: string;
}

interface ClientIpModeResult {
  mode: string;
  interfaceIndex: number;
  adapterName: string;
  message: string;
}

const statusLabel: Record<Status, string> = {
  pass: '正常',
  warning: '注意',
  fail: '失败',
};

const clientIpPreset = {
  ip: '192.168.209.253',
  mask: '255.255.255.0',
  gateway: '192.168.209.111',
  dns: '192.168.0.181 / 192.168.0.53',
};

export function DualNetBridge() {
  const [config, setConfig] = useState<DualNetConfig | null>(null);
  const [scan, setScan] = useState<DualNetScanReport | null>(null);
  const [diagnostics, setDiagnostics] = useState<DualNetDiagnostics | null>(null);
  const [validation, setValidation] = useState<AdapterValidation | null>(null);
  const [selectedInterface, setSelectedInterface] = useState<number | null>(null);
  const [clientInterfaceIndex, setClientInterfaceIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elevationMessage, setElevationMessage] = useState<string | null>(null);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [proxyBindIp, setProxyBindIp] = useState('');
  const [proxyGatewayIp, setProxyGatewayIp] = useState('');
  const [proxyPort, setProxyPort] = useState(7890);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [clientIpMode, setClientIpMode] = useState<ClientIpModeResult | null>(null);

  const api = window.electronAPI?.dualnet;

  const localIpv4Options = useMemo(() => {
    const seen = new Set<string>();
    const options: { value: string; label: string }[] = [];
    scan?.adapters.forEach((adapter) => {
      adapter.ipv4Addresses.forEach((ip) => {
        if (seen.has(ip)) return;
        seen.add(ip);
        options.push({ value: ip, label: `${ip} · ${adapter.name}` });
      });
    });
    return options;
  }, [scan]);

  const proxyReadiness = useMemo(() => {
    if (!scan) return { label: '未扫描', tone: 'neutral' };
    if (!scan.supported) return { label: '仅支持 Windows', tone: 'danger' };
    if (!scan.protectedAdapter) return { label: '出口未识别', tone: 'danger' };
    return { label: '代理模式可用', tone: 'success' };
  }, [scan]);

  const clientAdapterOptions = useMemo(() => {
    return (
      scan?.adapters
        .filter((adapter) => adapter.status.toLowerCase() === 'up' || adapter.ipv4Addresses.length)
        .map((adapter) => ({
          value: adapter.interfaceIndex,
          label: `${adapter.name} · ${adapter.ipv4Addresses[0] ?? '无 IPv4'}`,
        })) ?? []
    );
  }, [scan]);

  const load = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const [nextConfig, nextScan] = await Promise.all([
        api.getDefaultConfig() as Promise<DualNetConfig>,
        api.scanAdapters() as Promise<DualNetScanReport>,
      ]);
      const nextProxyStatus = (await api.proxyStatus()) as ProxyStatus;
      setConfig(nextConfig);
      setScan(nextScan);
      setProxyStatus(nextProxyStatus);
      setValidation(null);
      setSelectedInterface(null);
      const defaultProxyIp =
        nextProxyStatus.bindIp ||
        nextScan.protectedAdapter?.ipv4Addresses[0] ||
        nextScan.adapters.find((adapter) => adapter.ipv4Addresses.length)?.ipv4Addresses[0] ||
        '';
      setProxyBindIp((current) => current || defaultProxyIp);
      setProxyGatewayIp((current) => current || defaultProxyIp);
      setClientInterfaceIndex(
        (current) =>
          current ||
          nextScan.protectedAdapter?.interfaceIndex ||
          nextScan.adapters.find((adapter) => adapter.status.toLowerCase() === 'up')
            ?.interfaceIndex ||
          nextScan.adapters[0]?.interfaceIndex ||
          null
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const runDiagnostics = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      setDiagnostics((await api.runDiagnostics('gateway')) as DualNetDiagnostics);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const relaunchAsAdmin = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    setElevationMessage(null);
    try {
      const result = (await api.relaunchAsAdmin()) as { message?: string };
      setElevationMessage(result.message ?? '已请求管理员启动，请确认 Windows UAC 弹窗。');
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const validateAdapter = async (adapter: NetworkAdapterInfo) => {
    if (!api) return;
    setSelectedInterface(adapter.interfaceIndex);
    setError(null);
    try {
      setValidation(
        (await api.validateInternalAdapter(adapter.interfaceIndex)) as AdapterValidation
      );
    } catch (err) {
      setError(readError(err));
    }
  };

  const startProxy = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = (await api.proxyStart(proxyBindIp, proxyPort)) as { status: ProxyStatus };
      setProxyStatus(result.status);
      setActionMessage(`代理已启动：${result.status.endpoint}`);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const stopProxy = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = (await api.proxyStop()) as { status: ProxyStatus };
      setProxyStatus(result.status);
      setActionMessage('代理已停止。');
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const applyClientProxy = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    setActionMessage(null);
    try {
      const status = (await api.clientApplyProxy(proxyGatewayIp, proxyPort)) as ProxyStatus;
      setActionMessage(status.message);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const restoreClientProxy = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    setActionMessage(null);
    try {
      const status = (await api.clientRestoreProxy()) as ProxyStatus;
      setActionMessage(status.message);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const applyClientIpPreset = async () => {
    if (!api || !clientInterfaceIndex) return;
    setBusy(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = (await api.clientApplyIpPreset(clientInterfaceIndex)) as ClientIpModeResult;
      setClientIpMode(result);
      setActionMessage(result.message);
      await load();
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const restoreClientDhcp = async () => {
    if (!api || !clientInterfaceIndex) return;
    setBusy(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = (await api.clientRestoreDhcp(clientInterfaceIndex)) as ClientIpModeResult;
      setClientIpMode(result);
      setActionMessage(result.message);
      await load();
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!api) {
    return (
      <div className="dualnet-page">
        <section className="dualnet-panel">
          <h1>DualNet Bridge</h1>
          <p className="dualnet-muted">需要在 Tauri 运行时中使用。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="dualnet-page">
      <header className="dualnet-header">
        <div>
          <h1>DualNet Bridge</h1>
          <p>双机网络共享控制台</p>
        </div>
        <div className="dualnet-actions">
          {!scan?.isAdmin && (
            <IconButton
              icon="settings"
              label="以管理员身份重启"
              onClick={relaunchAsAdmin}
              disabled={busy}
            />
          )}
          <IconButton icon="detect" label="扫描网卡" onClick={load} disabled={busy} />
          <IconButton
            icon="details"
            label="网络诊断"
            onClick={runDiagnostics}
            disabled={busy}
          />
        </div>
      </header>

      {error && <div className="dualnet-alert dualnet-alert-danger">{error}</div>}
      {elevationMessage && (
        <div className="dualnet-alert dualnet-alert-success">{elevationMessage}</div>
      )}
      {actionMessage && (
        <div className="dualnet-alert dualnet-alert-success">{actionMessage}</div>
      )}
      {scan && !scan.isAdmin && (
        <div className="dualnet-alert dualnet-alert-warning dualnet-elevation">
          <span>当前不是管理员权限；应用网卡、NAT、防火墙配置前需要提权。</span>
          <button type="button" onClick={relaunchAsAdmin} disabled={busy}>
            以管理员身份重启
          </button>
        </div>
      )}

      <div className="dualnet-shell">
        <section className="dualnet-panel dualnet-primary">
          <div className="dualnet-title-row">
            <div>
              <h2>代理共享</h2>
              <p>适用于两台电脑已经互相 ping 通、但第二台不能上网的情况。</p>
            </div>
            <StatusPill tone={proxyStatus?.running ? 'success' : proxyReadiness.tone}>
              {proxyStatus?.running ? '运行中' : proxyReadiness.label}
            </StatusPill>
          </div>

          <div className="dualnet-flow">
            <section className="dualnet-step">
              <div className="dualnet-step-index">1</div>
              <div className="dualnet-step-body">
                <h3>第一台电脑开启代理</h3>
                <div className="dualnet-form-grid">
                  <label className="dualnet-field">
                    <span>监听 IP</span>
                    <select
                      value={proxyBindIp}
                      onChange={(event) => setProxyBindIp(event.target.value)}
                    >
                      <option value="">选择当前电脑的 IP</option>
                      {localIpv4Options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="dualnet-field port">
                    <span>端口</span>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={proxyPort}
                      onChange={(event) => setProxyPort(Number(event.target.value) || 7890)}
                    />
                  </label>
                </div>
                <div className="dualnet-button-row">
                  <button type="button" onClick={startProxy} disabled={busy || !proxyBindIp}>
                    开启代理
                  </button>
                  <button type="button" className="secondary" onClick={stopProxy} disabled={busy}>
                    停止
                  </button>
                </div>
              </div>
            </section>

            <section className="dualnet-step">
              <div className="dualnet-step-index">2</div>
              <div className="dualnet-step-body">
                <h3>第二台电脑使用代理</h3>
                <label className="dualnet-field">
                  <span>第一台电脑 IP</span>
                  <input
                    value={proxyGatewayIp}
                    onChange={(event) => setProxyGatewayIp(event.target.value)}
                    placeholder="填第一台电脑能被 ping 通的 IP"
                  />
                </label>
                <div className="dualnet-button-row">
                  <button type="button" onClick={applyClientProxy} disabled={busy || !proxyGatewayIp}>
                    应用系统代理
                  </button>
                  <button type="button" className="secondary" onClick={restoreClientProxy} disabled={busy}>
                    恢复原代理
                  </button>
                </div>

                <div className="dualnet-mode-card">
                  <div className="dualnet-mode-head">
                    <div>
                      <strong>第二台网卡模式</strong>
                      <p>上网用自动获取；两台电脑互 ping 用互联预设。</p>
                    </div>
                    <StatusPill tone={clientIpMode?.mode === 'preset' ? 'warning' : 'neutral'}>
                      {clientIpMode?.mode === 'preset' ? '互联预设' : '按需切换'}
                    </StatusPill>
                  </div>
                  <label className="dualnet-field">
                    <span>要切换的网卡</span>
                    <select
                      value={clientInterfaceIndex ?? ''}
                      onChange={(event) =>
                        setClientInterfaceIndex(Number(event.target.value) || null)
                      }
                    >
                      <option value="">选择第二台电脑网卡</option>
                      {clientAdapterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="dualnet-preset-grid">
                    <span>IP {clientIpPreset.ip}</span>
                    <span>Mask {clientIpPreset.mask}</span>
                    <span>Gateway {clientIpPreset.gateway}</span>
                    <span>DNS {clientIpPreset.dns}</span>
                  </div>
                  <div className="dualnet-button-row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={restoreClientDhcp}
                      disabled={busy || !clientInterfaceIndex}
                    >
                      自动获取
                    </button>
                    <button
                      type="button"
                      onClick={applyClientIpPreset}
                      disabled={busy || !clientInterfaceIndex}
                    >
                      使用互联预设
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>

        <aside className="dualnet-panel dualnet-status-panel">
          <h2>状态</h2>
          <InfoRow label="管理员权限" value={scan?.isAdmin ? '已提权' : '未提权'} />
          <InfoRow label="代理端点" value={proxyStatus?.endpoint ?? '-'} />
          <InfoRow label="出口网卡" value={scan?.protectedAdapter?.name ?? '-'} />
          <InfoRow label="系统代理" value="当前用户" />
        </aside>
      </div>

      <details className="dualnet-panel dualnet-advanced">
        <summary>高级网络信息</summary>
        <div className="dualnet-advanced-grid">
          <section>
            <h3>受保护出口网卡</h3>
            {scan?.protectedAdapter ? (
              <AdapterCard adapter={scan.protectedAdapter} />
            ) : (
              <EmptyState text="尚未识别默认出口网卡。" />
            )}
          </section>

          <section>
            <h3>诊断</h3>
            {diagnostics ? (
              <div className="dualnet-checks">
                <p className="dualnet-summary">{diagnostics.summary}</p>
                {diagnostics.checks.map((check) => (
                  <div className="dualnet-check" key={check.id}>
                    <span className={`dualnet-badge ${check.status}`}>
                      {statusLabel[check.status]}
                    </span>
                    <div>
                      <strong>{check.label}</strong>
                      <p>{check.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="点击网络诊断后显示结果。" />
            )}
          </section>

          <section>
            <h3>完整网关模式</h3>
            <p className="dualnet-muted">只有存在独立内网网卡时才需要这里。</p>
            <div className="dualnet-adapter-list">
              {scan?.internalCandidates.length ? (
                scan.internalCandidates.map((adapter) => (
                  <button
                    key={adapter.id}
                    className={`dualnet-adapter-button ${
                      selectedInterface === adapter.interfaceIndex ? 'selected' : ''
                    }`}
                    onClick={() => validateAdapter(adapter)}
                  >
                    <AdapterCard adapter={adapter} compact />
                  </button>
                ))
              ) : (
                <EmptyState text="未发现独立内网网卡；当前建议使用代理共享。" />
              )}
            </div>
            {validation && (
              <div
                className={`dualnet-alert ${
                  validation.ok ? 'dualnet-alert-success' : 'dualnet-alert-warning'
                }`}
              >
                {validation.message}
              </div>
            )}
          </section>

          <section>
            <h3>默认配置</h3>
            <dl className="dualnet-config">
              <div>
                <dt>代理端口</dt>
                <dd>{proxyPort}</dd>
              </div>
              <div>
                <dt>NAT 名称</dt>
                <dd>{config?.gateway.natName ?? 'DualNetBridgeNat'}</dd>
              </div>
              <div>
                <dt>发现端口</dt>
                <dd>{config?.gateway.discoveryPort ?? 37777}</dd>
              </div>
            </dl>
          </section>
        </div>
      </details>
    </div>
  );
}

function AdapterCard({
  adapter,
  compact = false,
}: {
  adapter: NetworkAdapterInfo;
  compact?: boolean;
}) {
  return (
    <div className={`dualnet-adapter ${compact ? 'compact' : ''}`}>
      <div className="dualnet-adapter-main">
        <div>
          <strong>{adapter.name}</strong>
          <p>{adapter.description || '无描述'}</p>
        </div>
        <span className={`dualnet-adapter-state ${adapter.isProtected ? 'protected' : ''}`}>
          {adapter.isProtected ? '已保护' : adapter.status}
        </span>
      </div>
      <div className="dualnet-adapter-meta">
        <span>Index {adapter.interfaceIndex}</span>
        <span>{adapter.dhcpEnabled ? 'DHCP' : 'Static/Unknown'}</span>
        <span>{adapter.linkSpeed || 'Link unknown'}</span>
      </div>
      {!compact && (
        <div className="dualnet-adapter-details">
          <span>IPv4: {adapter.ipv4Addresses.join(', ') || '-'}</span>
          <span>Gateway: {adapter.defaultGateway || '-'}</span>
          <span>DNS: {adapter.dnsServers.join(', ') || '-'}</span>
        </div>
      )}
      {adapter.riskFlags.length ? (
        <div className="dualnet-risks">
          {adapter.riskFlags.map((flag) => (
            <span key={flag}>{flag}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="dualnet-empty">{text}</div>;
}

function StatusPill({ tone, children }: { tone: string; children: string }) {
  return <span className={`dualnet-status-pill ${tone}`}>{children}</span>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="dualnet-info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function readError(err: unknown) {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
