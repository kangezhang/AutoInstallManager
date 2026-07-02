import { useEffect, useMemo, useState } from 'react';
import './DualNetBridge.css';

interface NetworkAdapterInfo {
  id: string;
  name: string;
  description: string;
  interfaceIndex: number;
  status: string;
  ipv4Addresses: string[];
}

interface DualNetScanReport {
  supported: boolean;
  isAdmin: boolean;
  adapters: NetworkAdapterInfo[];
  warnings: string[];
}

interface ClientIpModeResult {
  mode: string;
  interfaceIndex: number;
  adapterName: string;
  message: string;
}

const clientIpPreset = {
  ip: '192.168.209.253',
  mask: '255.255.255.0',
  gateway: '192.168.209.111',
  dns: '192.168.0.181 / 192.168.0.53',
};

export function DualNetBridge() {
  const [scan, setScan] = useState<DualNetScanReport | null>(null);
  const [clientInterfaceIndex, setClientInterfaceIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [clientIpMode, setClientIpMode] = useState<ClientIpModeResult | null>(null);

  const api = window.electronAPI?.dualnet;

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
      const nextScan = (await api.scanAdapters()) as DualNetScanReport;
      setScan(nextScan);
      setClientInterfaceIndex(
        (current) =>
          current ||
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
          <h1>第二台网卡模式</h1>
          <p className="dualnet-muted">需要在 Tauri 运行时中使用。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="dualnet-page">
      {error && <div className="dualnet-alert dualnet-alert-danger">{error}</div>}
      {actionMessage && (
        <div className="dualnet-alert dualnet-alert-success">{actionMessage}</div>
      )}
      {scan && !scan.supported && (
        <div className="dualnet-alert dualnet-alert-warning">当前仅支持 Windows 网卡设置。</div>
      )}
      {scan && !scan.isAdmin && (
        <div className="dualnet-alert dualnet-alert-warning">
          当前不是管理员权限，应用网卡设置时可能会失败。
        </div>
      )}

      <section className="dualnet-panel dualnet-card">
        <div className="dualnet-title-row">
          <div>
            <h1>第二台网卡模式</h1>
            <p>上网用自动获取；两台电脑互 ping 用互联预设。</p>
          </div>
          <span className="dualnet-status-pill">
            {clientIpMode?.mode === 'preset' ? '互联预设' : '按需切换'}
          </span>
        </div>

        <label className="dualnet-field">
          <span>要切换的网卡</span>
          <select
            value={clientInterfaceIndex ?? ''}
            onChange={(event) => setClientInterfaceIndex(Number(event.target.value) || null)}
            disabled={busy}
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
      </section>
    </div>
  );
}

function readError(err: unknown) {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
