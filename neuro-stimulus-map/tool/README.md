# Using the Stimulus Association Map as a tool for AI models

The evidence database, mapping rules and analysis code behind the web app are also
available as a **tool** that other AI systems can call. It comes in three forms:

| Form | Best for | Entry point |
|---|---|---|
| **MCP server (stdio)** | Local MCP clients: Claude Desktop / Claude Code, Meta Muse Code and other agents that support the Model Context Protocol | `node tool-dist/mcp-stdio.mjs` |
| **HTTP API + OpenAPI 3.1 + MCP over HTTP** | Cloud agents and connectors that call a URL (API connectors, GPT-style actions, remote MCP connectors) | `node tool-dist/http-server.mjs` → `/openapi.json`, `/tools/{name}`, `/mcp` |
| **CLI** | Agents that can run shell commands | `node tool-dist/cli.mjs …` |

Plain JSON-Schema definitions for any function-calling API are in
[`tools.json`](tools.json) (remote-safe tools) and [`tools.local.json`](tools.local.json)
(adds the local-file tool). [`openapi.json`](openapi.json) describes the HTTP API.

The `tool-dist/*.mjs` files are self-contained bundles. They need only Node.js 20 or newer, not
`npm install`. Rebuild them after changing the source with `npm run build:tool`.

## What the tools return (and never return)

Every result begins with the disclaimer: this is a **research-based stimulus association
map, not a brain scan**. The tools report which brain regions published research
associates with the *kinds* of stimuli described, together with:

- the candidate process and whether applying the research is a *direct match*, *partial match* or *extrapolation*;
- the evidence grade (strong / moderate / limited / contested) and its rationale;
- every cited source with its actual finding, design, sample size (or "not verified") and verification level;
- limitations, and explicit **"insufficient evidence"** records for things the research does not support (specific emotions → regions, dopamine, activation levels, tempo values and so on).

Interpretive features (humor, suspense, surprise, emotional theme, situation change, places)
only count when `confirmed: true`. That means a person has checked them.

### Tools

| Tool | What it does |
|---|---|
| `describe_tool` | Disclaimer, grading rubric, verification status, counts. Call it first. |
| `list_vocabulary` | Feature ids (with how each is detected and its limits), processes, regions, networks |
| `map_features` | Features you observed → processes → cited associations → regions/networks |
| `analyze_transcript` | SRT / WebVTT / Whisper JSON / plain text → segments → lexical features → mappings (no audio/video inferred) |
| `analyze_wav_audio` | Base64 PCM WAV (+ optional timed transcript) → segments → audio features → mappings |
| `analyze_audio_file` | Same, from a local path (**local transports only**, never exposed over HTTP) |
| `get_evidence` | Full record for an association, source, process or region id |
| `get_region` | Region/network orientation text + every association naming it |
| `search_evidence` | Search associations, sources and deliberate non-mappings; filter by grade |

MP3, MP4 and MOV decoding needs a browser's codecs, so for those formats either use the web
app or convert to WAV first (for example `ffmpeg -i in.mp4 -ac 1 -ar 16000 out.wav`).

## Connecting clients

### MCP clients (local)

Most MCP clients accept a server entry like this (see [`mcp-config.example.json`](mcp-config.example.json)):

```json
{
  "mcpServers": {
    "stimulus-association-map": {
      "command": "node",
      "args": ["/absolute/path/to/neuro-stimulus-map/tool-dist/mcp-stdio.mjs"]
    }
  }
}
```

- **Claude Code:** `claude mcp add stimulus-association-map -- node /absolute/path/to/neuro-stimulus-map/tool-dist/mcp-stdio.mjs`
- **Claude Desktop, Meta Muse Code and other MCP-capable agents:** add the entry above wherever that client configures MCP servers. The field names are the common `command`/`args` form; check your client's documentation for the exact file location.

### Cloud agents and connectors (Meta Muse, others) over HTTP

Cloud agents cannot reach your laptop's `localhost`. To use the tool from them:

1. Run the server somewhere reachable over **HTTPS**: a small cloud VM or container, or your computer behind a tunnel. Always set a token:
   ```bash
   STIMULUS_MAP_TOKEN="choose-a-long-random-secret" PUBLIC_URL="https://your-host.example" \
     node tool-dist/http-server.mjs --host 0.0.0.0 --port 8787
   ```
2. In the agent's connector settings, point it at one of:
   - **MCP:** `https://your-host.example/mcp` (Streamable HTTP, stateless) with header `Authorization: Bearer <token>`
   - **API/OpenAPI:** `https://your-host.example/openapi.json`, with bearer authentication.

Meta has said developers can connect services to its Muse-based assistants through an API or an
MCP server. The exact connector screens are Meta's, so follow their current instructions. The
endpoints above are the standard shapes those options expect.

Security notes: the HTTP server only analyses content sent in the request and never reads
server files. Without a token it binds to 127.0.0.1 by default, and it warns if you expose it
without one.

### Any other model with function calling

Give the model the definitions in `tools.json` (each has `name`, `description`, and `input_schema` in
JSON Schema). Execute the calls it makes with the CLI or HTTP API, for example:

```bash
node tool-dist/cli.mjs call map_features '{"features":[{"id":"speech_present"},{"id":"regular_beat","confidence":"moderate"}]}'
curl -s -X POST http://127.0.0.1:8787/tools/map_features -H 'content-type: application/json' \
     -d '{"features":[{"id":"faces_visible"}]}'
```

## Suggested instructions for the calling model

> Use the stimulus-association-map tools to explain which brain regions research associates
> with the kinds of stimuli in the media. Call `describe_tool` first. When you report results,
> say it is a research-based association map, not a brain scan. Keep detection confidence,
> evidence grade and applicability separate, cite the sources returned, mention limitations
> and "insufficient evidence" results, and never claim anything about a specific person's
> brain activity, emotions, dopamine or hormones.
