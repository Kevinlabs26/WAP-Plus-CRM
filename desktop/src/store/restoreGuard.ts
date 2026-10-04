// 恢复时暂存接收事件和自动保存，完成或失败后按顺序继续。
let restoring = false;
let restoreGeneration = 0;
let deferred: (() => void)[] = [];

export const isDataRestoreActive = () => restoring;
export const getDataRestoreGeneration = () => restoreGeneration;

export function deferDuringRestore(action: () => void): boolean {
  if (!restoring) return false;
  deferred.push(action);
  return true;
}

export function beginDataRestore(): () => void {
  if (restoring) throw new Error("正在恢复备份，请等待完成");
  restoring = true;
  restoreGeneration++;
  return () => {
    restoring = false;
    const pending = deferred;
    deferred = [];
    for (const action of pending) {
      try { action(); } catch (error) { console.error("[restore] deferred action failed", error); }
    }
  };
}
