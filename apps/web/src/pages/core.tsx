import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { ErrorState, Loading } from '../components/ui';

export { LoginPage } from './login';
export { SettingsPage } from './settings';

function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    loader()
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [loader]);
  useEffect(load, [load]);
  return { data, setData, loading, error, reload: load };
}

export function SetupGuard({ children }: { children: ReactNode }) {
  const state = useLoad(api.setupStatus);
  if (state.loading)
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950">
        <Loading label="Checking setup" />
      </div>
    );
  if (state.data?.required) return <Navigate to="/setup" replace />;
  if (state.error) return <ErrorState message={state.error} retry={state.reload} />;
  return children;
}
