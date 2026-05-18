# zai-usage

Pi Coding Agent extension for monitoring [ZAI (智谱/bigmodel.cn)](https://bigmodel.cn) Coding Plan usage.

Shows 5-hour token quota and weekly request limits in the pi footer bar.

## Install

```bash
pi install https://github.com/inouemoby/pi-zai-usage.git
```

## Setup

### Step 1: Get your token

1. Log in to [bigmodel.cn](https://bigmodel.cn) in your browser
2. Open browser DevTools → Application → Cookies → `bigmodel.cn`
3. Copy the value of the `bigmodel_token_production` cookie

### Step 2: Configure in pi

```
/zai-login <your-bigmodel_token_production-value>
```

Or run `/zai-login` without arguments for interactive input.

## Commands

| Command | Description |
|---------|-------------|
| `/zai` | Show detailed usage with progress bars |
| `/zai-login` | Set authentication token (saved globally) |
| `/zai-logout` | Clear stored token |

## Footer Display

When using a ZAI model, the footer shows:

```
↑3.2k ↓1.1k 12.5%/128k (auto) 5h:10% Wk:0%    (zai) glm-4-plus • medium
```

- `5h:10%` — 5-hour token usage window (with `!` warning at 50%+, `!!` at 80%+)
- `Wk:0%` — Weekly request limit usage

## Tool: zai_usage

The extension also registers an `zai_usage` tool that the AI can call:

```
Check ZAI Coding Plan usage (5h quota & weekly request limits)
```

## Data Storage

Token is stored globally at `~/.config/pi-zai-usage/session.json` — configure once, works in all pi sessions across all directories.

## API

Fetches usage from `https://bigmodel.cn/api/monitor/usage/quota/limit` using your token as Bearer authentication. The token is a JWT from the `bigmodel_token_production` cookie and is long-lived (~1 year).

## Related

- [pi-ollama-usage](https://github.com/inouemoby/pi-ollama-usage) — Same tool for Ollama Cloud
- [pi-setting](https://github.com/inouemoby/pi-setting) — Pi settings backup/restore across devices
