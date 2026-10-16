// node:sqlite 在 Node 22 / 24 上会打印 ExperimentalWarning，对使用者没有意义，也容易被当成报错。
// 必须在加载 node:sqlite 之前执行，所以 index.ts 第一个导入它。
const emit = process.emitWarning.bind(process) as (...args: unknown[]) => void;

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const opt = rest[0];
  const type = typeof opt === 'string' ? opt : ((opt as { type?: string } | undefined)?.type ?? (warning as Error)?.name);
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (type === 'ExperimentalWarning' && /SQLite/i.test(String(text))) return;
  emit(warning, ...rest);
}) as typeof process.emitWarning;

export {};
