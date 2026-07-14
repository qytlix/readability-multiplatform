import { useState } from 'react';

type IpcStatus = 'idle' | 'pending' | 'success' | 'error';

const ipcStatusMessages: Record<IpcStatus, string> = {
  idle: 'IPC not tested',
  pending: 'Testing IPC...',
  success: 'IPC OK: pong',
  error: 'IPC failed',
};

export const App = () => {
  const [ipcStatus, setIpcStatus] = useState<IpcStatus>('idle');

  const testIpc = async (): Promise<void> => {
    setIpcStatus('pending');

    try {
      const response = await window.shaleAPI.system.ping();

      if (response.ok === true && response.message === 'pong') {
        setIpcStatus('success');
        return;
      }

      setIpcStatus('error');
    } catch {
      setIpcStatus('error');
    }
  };

  return (
    <main>
      <h1>Shale</h1>
      <button type="button" disabled={ipcStatus === 'pending'} onClick={testIpc}>
        Test IPC
      </button>
      <p aria-live="polite">{ipcStatusMessages[ipcStatus]}</p>
    </main>
  );
};
