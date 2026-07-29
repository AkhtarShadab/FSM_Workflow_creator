"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ToolLanguage } from "@/lib/fsm-types";

export interface ScriptTemplate {
  id: string;
  name: string;
  language: ToolLanguage;
  code: string;
  builtin?: boolean;
}

const BUILTIN_TEMPLATES: ScriptTemplate[] = [
  {
    id: "builtin-python-fetch",
    name: "Python · fetch pages",
    language: "python",
    builtin: true,
    code: 'import urllib.request, json\n\ndef run(args, payload):\n    url = args["SOURCE_URL"]\n    with urllib.request.urlopen(url) as r:\n        pages = r.read().decode()\n    return {"signal": "::SCRIPT.NEXT", "pages": len(pages)}\n',
  },
  {
    id: "builtin-python-transform",
    name: "Python · transform JSON",
    language: "python",
    builtin: true,
    code: 'def run(args, payload):\n    rows = payload.get("rows", [])\n    cleaned = [r for r in rows if r.get("valid")]\n    return {"signal": "::SCRIPT.NEXT", "count": len(cleaned)}\n',
  },
  {
    id: "builtin-bash-curl",
    name: "Bash · curl endpoint",
    language: "bash",
    builtin: true,
    code: '#!/usr/bin/env bash\nset -euo pipefail\ncurl -sf "$SOURCE_URL" -o /tmp/out.json\necho \'::SCRIPT.NEXT|message="saved=/tmp/out.json"\'\n',
  },
  {
    id: "builtin-cpp-echo",
    name: "C++ · echo tool",
    language: "cpp",
    builtin: true,
    code: '// ToolResponse run(ToolRequest req) {\n//   // deterministic work here\n//   return ok("::SCRIPT.NEXT", req.payload());\n// }\n',
  },
];

interface ScriptTemplateStore {
  custom: ScriptTemplate[];
  saveTemplate: (t: Omit<ScriptTemplate, "id" | "builtin">) => string;
  removeTemplate: (id: string) => void;
  all: () => ScriptTemplate[];
}

export const useScriptTemplateStore = create<ScriptTemplateStore>()(
  persist(
    (set, get) => ({
      custom: [],

      saveTemplate: (t) => {
        const id = `tpl_${Date.now().toString(36)}`;
        set((state) => ({
          custom: [...state.custom, { ...t, id, builtin: false }],
        }));
        return id;
      },

      removeTemplate: (id) =>
        set((state) => ({
          custom: state.custom.filter((t) => t.id !== id),
        })),

      all: () => [...BUILTIN_TEMPLATES, ...get().custom],
    }),
    { name: "fsm-script-templates" }
  )
);

export { BUILTIN_TEMPLATES };
