# zai-usage

Pi Coding Agent extension for monitoring [ZAI (智谱/bigmodel.cn)](https://bigmodel.cn) Coding Plan usage.

Shows 5-hour token quota in the pi footer bar. The 5-hour pool is shared with vision MCP usage.

## Install

```bash
pi install git:github.com/inouemoby/pi-zai-usage
```

## Setup

No login needed. The extension reads your ZAI API key directly from pi's auth config (`~/.pi/agent/auth.json` → `zai.key`) — the same key pi uses to call GLM models. Just make sure pi is configured with the `zai` provider (run `/auth zai` if not).

## Commands

| Command | Description |
|---------|-------------|
| `/zai` | Show detailed usage with progress bars |

## Footer Display

When using a ZAI model, the footer shows:

```
↑3.2k ↓1.1k 12.5%/128k (auto) 5h:10%    (zai) glm-5.1 • medium
```

- `5h:10%` — 5-hour token usage window, shared with vision MCP. `!` above expected rate, `!!` exceeds 1.5× expected rate

## Quota Details

- **5h pool**: Shared by all model usage (including vision MCP calls). Shown in footer.
- **MCP calls** (search + web-reader): Monthly limit (Pro = 1000/month). Not shown — if you need it, run `/zai` for details.
- **Vision MCP**: Shares the 5h pool, no separate call limit.

## Tool: zai_usage

The extension also registers an `zai_usage` tool that the AI can call:

```
Check ZAI Coding Plan usage (5h quota)
```

## API

Fetches usage from `https://bigmodel.cn/api/monitor/usage/quota/limit` using your ZAI API key (sent raw in the `Authorization` header). The API natively returns usage percentage and reset timestamps for both the 5-hour token window (`TOKENS_LIMIT`) and the monthly MCP call limit (`TIME_LIMIT`).

## Related

- [pi-ollama-usage](https://github.com/inouemoby/pi-ollama-usage) — Same tool for Ollama Cloud
