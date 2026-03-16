#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { chromium } = require("playwright");

const server = new Server(
  { name: "screenshot", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "screenshot",
      description:
        "Take a screenshot of a web page. Returns the image for visual inspection. " +
        "Works with localhost, Tailscale IPs, and public URLs.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to screenshot (e.g. http://localhost:8000, https://pmserver.us)",
          },
          width: {
            type: "number",
            description: "Viewport width in pixels (default: 1280)",
            default: 1280,
          },
          height: {
            type: "number",
            description: "Viewport height in pixels (default: 800)",
            default: 800,
          },
          full_page: {
            type: "boolean",
            description: "Capture full scrollable page instead of just viewport (default: false)",
            default: false,
          },
          wait_for: {
            type: "string",
            description: "CSS selector to wait for before taking screenshot (optional)",
          },
          delay_ms: {
            type: "number",
            description: "Extra delay in ms after page load before screenshot (default: 0)",
            default: 0,
          },
          cookies: {
            type: "array",
            description: "Cookies to set before navigating (array of {name, value, domain, path?})",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: { type: "string" },
                domain: { type: "string" },
                path: { type: "string", default: "/" },
              },
              required: ["name", "value", "domain"],
            },
          },
          headers: {
            type: "object",
            description: "Extra HTTP headers to send (e.g. Authorization)",
            additionalProperties: { type: "string" },
          },
        },
        required: ["url"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "screenshot") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const {
    url,
    width = 1280,
    height = 800,
    full_page = false,
    wait_for,
    delay_ms = 0,
    cookies,
    headers,
  } = request.params.arguments;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      viewport: { width, height },
      ignoreHTTPSErrors: true,
    });

    if (cookies && cookies.length > 0) {
      await context.addCookies(cookies);
    }

    const page = await context.newPage();

    if (headers) {
      await page.setExtraHTTPHeaders(headers);
    }

    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });

    if (wait_for) {
      await page.waitForSelector(wait_for, { timeout: 10000 });
    }

    if (delay_ms > 0) {
      await new Promise((r) => setTimeout(r, delay_ms));
    }

    const buffer = await page.screenshot({
      fullPage: full_page,
      type: "png",
    });

    await browser.close();
    browser = null;

    return {
      content: [
        {
          type: "image",
          data: buffer.toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Screenshot failed: ${err.message}` }],
      isError: true,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
