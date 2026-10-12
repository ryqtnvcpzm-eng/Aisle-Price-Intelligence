"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ImportDialog } from "./import-dialog";

export interface ImportResult {
  familyIds: string[];
  variantIds: string[];
  groupId: string | null;
  brandIds?: string[];
}

interface ImportCtx {
  open: (prefill?: string, opts?: { groupId?: string; onDone?: (r: ImportResult) => void }) => void;
}

const Ctx = createContext<ImportCtx>({ open: () => {} });
export const useImport = () => useContext(Ctx);

export function ImportProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; prefill: string; groupId?: string; onDone?: (r: ImportResult) => void; key: number }>({ open: false, prefill: "", key: 0 });
  const open = useCallback((prefill?: string, opts?: { groupId?: string; onDone?: (r: ImportResult) => void }) => setState((s) => ({ open: true, prefill: prefill ?? "", groupId: opts?.groupId, onDone: opts?.onDone, key: s.key + 1 })), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ImportDialog key={state.key} open={state.open} prefill={state.prefill} groupId={state.groupId} onDone={state.onDone} onOpenChange={(v) => setState((s) => ({ ...s, open: v }))} />
    </Ctx.Provider>
  );
}
