import { createServer } from "node:http";
import { createCanvas, joinSession, CanvasError } from "@github/copilot-sdk/extension";

const repository = "nix-ayush/tailspin-toys";
const servers = new Map();
const priorities = new Map([
    [6, "Improves performance and keeps the growing catalog manageable."],
    [1, "Removes the biggest discoverability barrier for players who know what they want."],
    [2, "Adds a high-value browsing path that complements search and pagination."],
    [4, "Extends catalog navigation after a player finds a game they like."],
    [3, "Adds useful context to an existing detail experience without schema work."],
    [5, "Improves landing-page context, but is less blocking than core browsing features."],
]);
const priorityOrder = [6, 1, 2, 4, 3, 5];

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function description(issue) {
    const text = (issue.body || "").replace(/[#*_`]/g, "").replace(/\s+/g, " ").trim();
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function card(issue, topIssue) {
    return `<article class="card ${topIssue ? "top-card" : ""}" data-testid="issue-card-${issue.number}">
      <div class="card-header"><span>#${issue.number}</span><span>${topIssue ? "Top priority" : "Follow-up"}</span></div>
      <h3><a href="${escapeHtml(issue.html_url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a></h3>
      <p>${escapeHtml(description(issue)) || "No description provided."}</p>
      ${topIssue ? `<p class="why"><strong>Why it is here:</strong> ${escapeHtml(priorities.get(issue.number))}</p>` : ""}
      <button class="context-button" data-testid="add-issue-${issue.number}" data-issue-number="${issue.number}">Add to current context</button>
      <span class="status" data-status-for="${issue.number}" role="status" aria-live="polite"></span>
    </article>`;
}

function renderHtml(issues) {
    const sorted = [...issues].sort((left, right) => {
        const leftScore = priorityOrder.indexOf(left.number);
        const rightScore = priorityOrder.indexOf(right.number);
        if (leftScore === -1 && rightScore === -1) return right.number - left.number;
        if (leftScore === -1) return 1;
        if (rightScore === -1) return -1;
        return leftScore - rightScore;
    });
    const topIssues = sorted.slice(0, 3);
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issue triage board</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 24px; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font: 14px/1.5 var(--font-sans, system-ui, sans-serif); }
      main { max-width: 960px; margin: auto; }
      h1, h2, h3 { line-height: 1.2; } h1 { margin: 0 0 6px; font-size: 24px; } h2 { margin: 28px 0 12px; font-size: 17px; }
      .muted { color: var(--text-color-muted, #656d76); margin-top: 0; }
      .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
      .card { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 8px; padding: 16px; background: var(--background-color-muted, #f6f8fa); }
      .top-card { border-color: var(--true-color-blue, #0969da); }
      .card-header { display: flex; justify-content: space-between; color: var(--text-color-muted, #656d76); font-size: 12px; font-weight: 600; text-transform: uppercase; }
      .card-header span:last-child { color: var(--true-color-blue, #0969da); } h3 { margin: 9px 0; font-size: 16px; } a { color: var(--fgColor-accent, #0969da); }
      p { margin: 8px 0; } .why { border-left: 3px solid var(--true-color-blue, #0969da); padding-left: 9px; }
      button { margin-top: 8px; border: 1px solid var(--border-color-default, #d0d7de); border-radius: 6px; padding: 7px 10px; background: var(--button-default-bgColor-rest, #f6f8fa); color: inherit; cursor: pointer; }
      button:hover { background: var(--button-default-bgColor-hover, #eaeef2); } button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
      button:disabled { cursor: wait; opacity: .65; } .status { display: block; min-height: 20px; margin-top: 5px; color: var(--text-color-muted, #656d76); font-size: 12px; }
      @media (max-width: 500px) { body { padding: 16px; } }
    </style>
  </head>
  <body>
    <main>
      <h1>Issue triage board</h1>
      <p class="muted">Open issues for <strong>${repository}</strong>, ranked by likely immediate product impact.</p>
      <h2>Needs attention now</h2>
      <section class="board" aria-label="Top three issues">${topIssues.map((issue) => card(issue, true)).join("") || "<p>No open issues.</p>"}</section>
      <h2>Next up</h2>
      <section class="board" aria-label="Remaining issues">${sorted.slice(3).map((issue) => card(issue, false)).join("") || "<p>No remaining issues.</p>"}</section>
    </main>
    <script>
      document.querySelectorAll(".context-button").forEach((button) => {
        button.addEventListener("click", async () => {
          const number = button.dataset.issueNumber;
          const status = document.querySelector("[data-status-for='" + number + "']");
          button.disabled = true; status.textContent = "Adding...";
          try {
            const response = await fetch("/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: Number(number) }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Request failed");
            status.textContent = "Added to the current context.";
          } catch (error) {
            status.textContent = "Could not add issue: " + error.message; button.disabled = false;
          }
        });
      });
    </script>
  </body>
</html>`;
}

async function fetchIssues() {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues?state=open&per_page=100`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "issue-triage-board" },
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const issues = await response.json();
    return issues.filter((issue) => !issue.pull_request);
}

async function addIssueToContext(issue) {
    await session.send({
        prompt: `Add this GitHub issue to the current working context and be ready to work on it:

#${issue.number}: ${issue.title}
${issue.html_url}

Issue description:
${issue.body || "No description provided."}`,
    });
}

async function startServer(issues) {
    const server = createServer((req, res) => {
        if (req.method === "POST" && req.url === "/context") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const number = Number(JSON.parse(body).number);
                    const issue = issues.find((candidate) => candidate.number === number);
                    if (!issue) throw new Error("Issue is no longer in the open issue list.");
                    await addIssueToContext(issue);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (error) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unable to add issue." }));
                }
            });
            return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtml(issues));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/`, issues };
}

let session;
session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue triage board",
            description: "A live Kanban board that ranks open repository issues and adds selected issues to the current context.",
            inputSchema: { type: "object", additionalProperties: false },
            actions: [{
                name: "add_issue_to_context",
                description: "Add an open GitHub issue from this board to the current session context.",
                inputSchema: {
                    type: "object",
                    properties: { number: { type: "integer", minimum: 1 } },
                    required: ["number"],
                    additionalProperties: false,
                },
                handler: async (ctx) => {
                    const entry = servers.get(ctx.instanceId);
                    const issue = entry?.issues.find((candidate) => candidate.number === ctx.input.number);
                    if (!issue) throw new CanvasError("issue_not_found", "Issue is not available on this board.");
                    await addIssueToContext(issue);
                    return { ok: true, number: issue.number };
                },
            }],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(await fetchIssues());
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Issue triage board", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
