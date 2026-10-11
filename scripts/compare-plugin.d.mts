import type { Plugin } from "vite";

export function compareEnabled(env?: Record<string, string | undefined>): boolean;

export function comparePlugin(options: {
  variant: "v1" | "v2";
  root: string;
  sha: string;
  emitScript?: boolean;
}): Plugin | null;
