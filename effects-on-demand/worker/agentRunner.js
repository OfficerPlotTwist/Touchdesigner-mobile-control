import { query } from '@anthropic-ai/claude-agent-sdk';

// Hard-scoping system prompt for the GLM session. The agent may read other
// effects for reference but may WRITE only inside its assigned container. The
// worker (not the agent) runs the verify gates and flips fx_switch.
export function buildSystemPrompt({ effectPath, contract }) {
  return [
    `You are an effect-builder for a live TouchDesigner projection.`,
    `Build ONLY inside the container ${effectPath}. Every create_operator / execute_script / set_par_value call must target that subtree.`,
    `You may READ other effects under ${contract.effectsPath} for reference, but never modify or delete them.`,
    `NEVER modify or delete: the currently-live container, core project operators, the crowd-control / mobile-control DATs, or /project1/TD_MCP.`,
    `NEVER set ${contract.switchPath} (the switch) — flipping the projection is not your job.`,
    `NEVER pulse Start/Restart or any server-control buttons.`,
    `Checkpoint (save_checkpoint) before any structural change, per the td-mcp safety skill.`,
    `When the effect renders in ${effectPath}'s out TOP, you are done. Do not verify or switch — the host does that.`,
  ].join('\n');
}

// Build the runner the worker calls. mcpServerUrl: the TD-MCP endpoint as an
// SSE/HTTP URL (e.g. http://127.0.0.1:9980). The Agent SDK is pointed at Z.AI via
// the ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN env vars the process is started with.
//
// Transport note: this runner uses the SSE/HTTP transport ({ type: 'sse', url })
// for the Agent SDK session, while the worker's mcpBridge.js uses a raw WebSocket
// (ws://) to the same TD-MCP server — so EOD_MCP_URL may need a per-transport form
// (http:// here vs ws:// for the bridge).
//
// SDK notes (v0.3.x):
//  - query() takes { prompt, options } where options keys include model,
//    systemPrompt, abortController, mcpServers.
//  - mcpServers values must match McpServerConfig union; for a URL-based MCP
//    endpoint use { type: 'sse', url } (not 'sdk' which requires a name/instance).
//  - abortController takes an AbortController object; we bridge from the
//    incoming AbortSignal by creating a linked controller.
export function makeAgentRunner({ mcpServerUrl, model }) {
  return async function runAgentSession({ job, effectPath, contract, signal }) {
    const systemPrompt = buildSystemPrompt({ effectPath, contract });
    const prompt = `A visitor named ${job.name} requests: "${job.text}". Build it as a self-contained effect inside ${effectPath}.`;

    // Bridge AbortSignal → AbortController if provided
    let abortController;
    if (signal) {
      abortController = new AbortController();
      signal.addEventListener('abort', () => abortController.abort(signal.reason), { once: true });
    }

    const session = query({
      prompt,
      options: {
        model,                                  // GLM model id (Z.AI)
        systemPrompt,
        abortController,
        mcpServers: {
          td: { type: 'sse', url: mcpServerUrl },   // TD-MCP bridge via SSE endpoint
        },
        // The td-mcp skill + safety refs are discovered from the project the
        // worker process is launched in (they live in the TD-MCP repo).
      },
    });

    // Drain the agent turn to completion (or until aborted).
    for await (const _event of session) { /* progress is observed via the bridge */ }
    return { built: true };
  };
}
