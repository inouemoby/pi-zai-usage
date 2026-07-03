import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";

// ─── Types ───────────────────────────────────────────────────────
interface QuotaLimit {
  type: "TIME_LIMIT" | "TOKENS_LIMIT";
  unit: number;
  number: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage: number;
  nextResetTime: number; // epoch ms
  usageDetails?: { modelCode: string; usage: number }[];
}

interface UsageData {
  fiveHourPercent: number;
  fiveHourResetMs: number;
  requestPercent: number;
  requestUsed: number;
  requestTotal: number;
  requestResetMs: number;
  requestDetails?: { modelCode: string; usage: number }[];
  level: string;
  _ts: number;
}

const CACHE_MS = 60_000;
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;

// ─── API Key Storage ─────────────────────────────────────────────
function getAuthPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return resolve(home, ".pi", "agent", "auth.json");
}

function readApiKey(): string {
  try {
    const path = getAuthPath();
    if (!existsSync(path)) return "";
    const auth = JSON.parse(readFileSync(path, "utf-8"));
    return auth?.zai?.key ?? "";
  } catch { return ""; }
}

// ─── Helpers ─────────────────────────────────────────────────────
/** Returns severity: 0=normal, 1=above expected, 2=critical (1.5x expected) */
function usageSeverity(pct: number, windowMs: number, resetMs: number): number {
  const remainingMs = resetMs - Date.now();
  const elapsedMs = Math.max(0, windowMs - remainingMs);
  const elapsedRatio = elapsedMs / windowMs;
  const expectedPct = elapsedRatio * 100;
  if (pct > expectedPct * 1.5) return 2;
  if (pct > expectedPct)      return 1;
  return 0;
}

function humanDuration(untilMs: number): string {
  if (untilMs <= 0) return "now";
  const m = Math.floor(untilMs / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mins}m`;
  return `${mins}m`;
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1e6) return `${Math.round(count / 1000)}k`;
  if (count < 1e7) return `${(count / 1e6).toFixed(1)}M`;
  return `${Math.round(count / 1e6)}M`;
}

// ─── Fetch ───────────────────────────────────────────────────────
async function fetchUsage(apiKey: string): Promise<UsageData> {
  const resp = await fetch("https://bigmodel.cn/api/monitor/usage/quota/limit", {
    headers: {
      Authorization: apiKey,
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.success) throw new Error(json.msg || "API error");

  const limits: QuotaLimit[] = json.data?.limits ?? [];
  const level: string = json.data?.level ?? "unknown";

  let fiveHourPercent = -1, fiveHourResetMs = 0;
  let requestPercent = -1, requestUsed = 0, requestTotal = 0, requestResetMs = 0;
  let requestDetails: { modelCode: string; usage: number }[] | undefined;

  for (const lim of limits) {
    if (lim.type === "TOKENS_LIMIT") {
      // This is the 5-hour token usage window
      fiveHourPercent = lim.percentage;
      fiveHourResetMs = lim.nextResetTime;
    } else if (lim.type === "TIME_LIMIT") {
      // Monthly MCP call limit (search + web-reader + vision MCP)
      requestPercent = lim.percentage;
      requestUsed = lim.currentValue ?? 0;
      requestTotal = lim.usage ?? 0;
      requestResetMs = lim.nextResetTime;
      requestDetails = lim.usageDetails;
    }
  }

  return {
    fiveHourPercent, fiveHourResetMs,
    requestPercent, requestUsed, requestTotal, requestResetMs, requestDetails,
    level, _ts: Date.now(),
  };
}

// ─── Main ────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  let apiKey = "";
  let usage: UsageData | null = null;
  let footerOn = false;
  let _tui: any = null;
  let thinkingLevel = "off";

  async function getUsage(): Promise<UsageData> {
    if (!apiKey) throw new Error("ZAI API key not found in ~/.pi/agent/auth.json");
    if (usage && Date.now() - usage._ts < CACHE_MS) return usage;
    usage = await fetchUsage(apiKey);
    return usage;
  }

  function isZAI(ctx: any) {
    const p = ctx.model?.provider?.toLowerCase() ?? "";
    return p === "zai" || p === "bigmodel" || p.includes("zai") || p.includes("bigmodel");
  }
  function trigger() { if (_tui) setTimeout(() => _tui.requestRender?.(), 0); }

  // ── Refresh ─────────────────────────────────────────────────
  async function refresh(ctx: any) {
    if (!apiKey) return;
    if (!isZAI(ctx)) {
      if (usage) { usage = null; toggleFooter(ctx); }
      return;
    }
    try { await getUsage(); trigger(); } catch { /* silent */ }
  }

  // ── Footer ──────────────────────────────────────────────────
  function toggleFooter(ctx: any) {
    if (isZAI(ctx) && apiKey) {
      if (!footerOn) {
        ctx.ui.setFooter(buildFooter(ctx));
        footerOn = true;
      }
    } else {
      if (footerOn) {
        _tui = null;
        ctx.ui.setFooter(undefined as any);
        footerOn = false;
      }
    }
  }

  function buildFooter(ctx: any) {
    return (tui: any, theme: any, fd: any) => {
      _tui = tui;
      const unsub = fd.onBranchChange(() => tui.requestRender());
      return {
        dispose: () => { unsub(); _tui = null; },
        invalidate() {},
        render(width: number): string[] {
          const sm = ctx.sessionManager;

          // ── Line 1: pwd ──────────────────────────────────
          const home = process.env.HOME || process.env.USERPROFILE || "";
          let pwd = ctx.cwd || sm.getCwd?.() || "";
          if (home && pwd.startsWith(home)) pwd = "~" + pwd.slice(home.length);
          const branch = fd.getGitBranch();
          if (branch) pwd += ` (${branch})`;
          const sname = sm.getSessionName?.();
          if (sname) pwd += ` • ${sname}`;
          const ln1 = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

          // ── Line 2: stats ────────────────────────────────
          let ti = 0, to = 0, tr = 0, tw = 0, tc = 0;
          for (const e of sm.getEntries()) {
            if (e.type === "message" && e.message?.role === "assistant") {
              const u = (e.message as AssistantMessage).usage;
              ti += u.input; to += u.output;
              tr += u.cacheRead; tw += u.cacheWrite;
              tc += u.cost.total;
            }
          }
          const parts: string[] = [];
          if (ti) parts.push(`↑${formatTokens(ti)}`);
          if (to) parts.push(`↓${formatTokens(to)}`);
          if (tr) parts.push(`R${formatTokens(tr)}`);
          if (tw) parts.push(`W${formatTokens(tw)}`);
          if (tc) parts.push(`$${tc.toFixed(3)}`);

          // Context %
          const cu = ctx.getContextUsage();
          const cw = cu?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const raw = cu?.percent;
          const cp = raw !== null && raw !== undefined ? raw.toFixed(1) : "?";
          let cpStr: string;
          if (cp === "?") cpStr = `?/${formatTokens(cw)} (auto)`;
          else if (parseFloat(cp) > 90) cpStr = theme.fg("error", `${cp}%/${formatTokens(cw)} (auto)`);
          else if (parseFloat(cp) > 70) cpStr = theme.fg("warning", `${cp}%/${formatTokens(cw)} (auto)`);
          else cpStr = `${cp}%/${formatTokens(cw)} (auto)`;
          parts.push(cpStr);

          // ZAI usage
          if (usage && usage.fiveHourPercent >= 0) {
            const sSev = usageSeverity(usage.fiveHourPercent, FIVE_HOUR_MS, usage.fiveHourResetMs);
            const sFlag = sSev === 2 ? "!!" : sSev === 1 ? "!" : "";
            parts.push(`${sFlag}5h:${usage.fiveHourPercent}%`);
          }
          let left = parts.join(" ");

          // Right side: model info
          const m = ctx.model;
          let right = m?.id || "no-model";
          if (m?.reasoning) {
            const tl = thinkingLevel;
            right = tl === "off" ? `${right} • thinking off` : `${right} • ${tl}`;
          }
          if (m) {
            const withProv = `(${m.provider}) ${right}`;
            if (visibleWidth(left) + 2 + visibleWidth(withProv) <= width) {
              right = withProv;
            }
          }

          const lw = visibleWidth(left);
          const rw = visibleWidth(right);

          let ln2: string;
          if (lw + 2 + rw <= width) {
            ln2 = left + " ".repeat(width - lw - rw) + right;
          } else if (lw + 2 < width) {
            ln2 = truncateToWidth(left + "  " + right, width, "");
          } else {
            ln2 = truncateToWidth(left, width, "...");
          }

          return [ln1, theme.fg("dim", ln2)];
        },
      };
    };
  }

  // ── Events ─────────────────────────────────────────────────
  pi.on("session_start", async (_e, ctx) => {
    apiKey = readApiKey();
    thinkingLevel = pi.getThinkingLevel?.() || "off";
    toggleFooter(ctx);
    if (apiKey) refresh(ctx);
  });

  pi.on("model_select", async (_e, ctx) => { toggleFooter(ctx); if (apiKey) refresh(ctx); });
  pi.on("thinking_level_select", async (event: any) => { thinkingLevel = event.level || "off"; trigger(); });
  pi.on("agent_end", async (_e, ctx) => { if (apiKey) refresh(ctx); });

  // ── /zai ────────────────────────────────────────────────
  pi.registerCommand("zai", {
    description: "Show ZAI Coding Plan usage",
    handler: async (_args, ctx) => {
      try {
        const d = await getUsage();
        const bar = (pct: number) =>
          "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));

        const lines = [`══ ZAI Coding Plan (${d.level}) ══`];

        if (d.fiveHourPercent >= 0) {
          lines.push(
            `5h  ${bar(d.fiveHourPercent)}  ${d.fiveHourPercent}% used  (${(100 - d.fiveHourPercent).toFixed(1)}% left)  resets ${humanDuration(d.fiveHourResetMs - Date.now())}`,
          );
        }
        if (d.requestPercent >= 0) {
          lines.push(
            `MCP ${bar(d.requestPercent)}  ${d.requestUsed}/${d.requestTotal} calls  (${d.requestPercent}% used)  resets ${humanDuration(d.requestResetMs - Date.now())}`,
          );
          if (d.requestDetails?.length) {
            const det = d.requestDetails
              .filter(x => x.usage > 0)
              .map(x => `${x.modelCode}:${x.usage}`)
              .join("  ");
            if (det) lines.push(`    └ ${det}`);
          }
        }
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err: any) {
        ctx.ui.notify(`ZAI: ${err.message}`, "error");
      }
    },
  });

  // ── zai_usage tool ──────────────────────────────────────
  pi.registerTool({
    name: "zai_usage",
    label: "ZAI Usage",
    description: "Check ZAI (智谱/bigmodel.cn) Coding Plan usage: 5-hour quota percentage and request limits.",
    promptSnippet: "Check ZAI Coding Plan usage (5h quota & request limits)",
    promptGuidelines: [
      "Use zai_usage to check ZAI Coding Plan quota before expensive operations.",
      "Use zai_usage when the user asks about ZAI usage, limits, or remaining credits.",
    ],
    parameters: Type.Object({}),
    async execute(_id: any, _p: any, _s: any, _up: any, ctx: any) {
      try {
        const d = await getUsage();
        const result: any = {
          plan: d.level,
          fiveHour: {
            used: d.fiveHourPercent,
            remaining: d.fiveHourPercent >= 0 ? +(100 - d.fiveHourPercent).toFixed(1) : -1,
            resetsIn: humanDuration(d.fiveHourResetMs - Date.now()),
          },
          requests: {
            used: d.requestUsed,
            total: d.requestTotal,
            percent: d.requestPercent,
            resetsIn: humanDuration(d.requestResetMs - Date.now()),
          },
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    },
  });
}
