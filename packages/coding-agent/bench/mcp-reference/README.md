# MCP reference comparison

Run manually with a configured model; not part of the offline test suite:

```sh
bun packages/coding-agent/bench/mcp-reference/run.ts \
  --model provider/glm-5.3-flash --samples 3 --out /tmp/mcp-reference-results.json
```

Use the provider/id from the model configuration. `--agent-dir` selects another profile directory. Auth, model routing and provider behavior use MarIA Code's production client. The benchmark executes only synthetic tool responses: model output cannot write files or call a real MCP.

Four formats × eight scenarios × three samples. Scoring checks actual tool calls over up to four turns: the selected server, valid execution after discovery, both servers in a multi-reference request, no unrelated calls, explicit exclusions, irrelevant tasks, unavailable servers and no unrequested ticket creation. Invalid or unrelated calls count as failures even if the model later recovers. Inference errors and exhausted output limits are reported separately. The `explicit` variant imports the extension's actual template.

Measured on 2026-11-27 with `google-vertex/gemini-3-flash-preview`:

| Format | Passed | Inference errors |
| --- | ---: | ---: |
| Existing `MCP("name")` | 24/24 | 0 |
| XML without explanation | 21/24 | 0 |
| XML with explicit explanation | 24/24 | 0 |
| Plain text with explanation | 23/24 | 0 |

Bare XML substituted other MCPs for the unavailable selected server. One plain-text sample invented query-string routes before recovering. The explicit XML matched the existing format's success rate while defining selection intent and failure handling. This small fixture benchmark does not establish superiority over the existing format or performance on GLM 5.3 Flash; GLM was not available in the test environment. Repeat with the corporate endpoint to measure that deployment.
