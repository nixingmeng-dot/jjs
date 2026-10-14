import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiRequest } from '../../shared/types';
import { runAi } from '../api';
import { useApp } from '../store';

export type AiStatus = 'idle' | 'running' | 'done' | 'error';

export interface AiState {
  status: AiStatus;
  text: string;
  reasoning: string;
  error: string;
  model: string;
  request: AiRequest | null;
}

const initial: AiState = { status: 'idle', text: '', reasoning: '', error: '', model: '', request: null };

/** 单个流式 AI 任务的状态。卸载时自动中断。 */
export function useAiTask() {
  const [state, setState] = useState<AiState>(initial);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async (req: AiRequest): Promise<string | null> => {
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    const { settings } = useApp.getState();
    const full: AiRequest = {
      providerId: settings?.defaultProviderId || undefined,
      model: settings?.defaultModel || undefined,
      ...req,
    };
    setState({ ...initial, status: 'running', request: full });
    try {
      const { text } = await runAi(
        full,
        {
          onMeta: (provider, model) => setState((s) => ({ ...s, model: `${provider} · ${model}` })),
          onText: (_c, all) => setState((s) => ({ ...s, text: all })),
          onReasoning: (_c, all) => setState((s) => ({ ...s, reasoning: all })),
        },
        ac.signal,
      );
      if (ctrl.current !== ac) return null;
      setState((s) => ({ ...s, status: 'done' }));
      return text;
    } catch (err) {
      if (ctrl.current !== ac) return null;
      if ((err as Error).name === 'AbortError') {
        setState((s) => ({ ...s, status: s.text ? 'done' : 'idle' }));
        return null;
      }
      setState((s) => ({ ...s, status: 'error', error: (err as Error).message }));
      return null;
    }
  }, []);

  const stop = useCallback(() => {
    ctrl.current?.abort();
  }, []);

  const reset = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setState(initial);
  }, []);

  const retry = useCallback(() => {
    if (state.request) return run(state.request);
  }, [run, state.request]);

  return { ...state, running: state.status === 'running', run, stop, reset, retry, setText: (text: string) => setState((s) => ({ ...s, text })) };
}

export type AiTaskHandle = ReturnType<typeof useAiTask>;
