import { existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { logger } from "../../lib/logger";

/** Document port (module 6): branded HTML in, PDF out. */
export interface PdfRenderer {
  readonly available: boolean;
  render(html: string): Promise<Buffer>;
}

/** Where Chrome or Edge usually lives, so local development needs no setup. */
function defaultBrowserPaths() {
  const programFiles = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean) as string[];
  return [
    ...programFiles.flatMap((base) => [
      join(base, "Google", "Chrome", "Application", "chrome.exe"),
      join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
}

export function findBrowser(configured: string | undefined) {
  if (configured) return existsSync(configured) ? configured : null;
  return defaultBrowserPaths().find((path) => existsSync(path)) ?? null;
}

/**
 * HTML → PDF with headless Chromium (the "HTML->PDF renderer" C-45 names). The page gets no
 * scripts and no network: everything it needs is inline, so a quote can't load anything
 * from outside. One browser is kept warm and closed after a minute without work.
 */
export class ChromiumPdf implements PdfRenderer {
  private browser: Promise<Browser> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private busy = 0;

  constructor(private readonly executablePath: string | null) {}

  get available() {
    return this.executablePath !== null;
  }

  async render(html: string): Promise<Buffer> {
    if (!this.executablePath)
      throw new Error("No Chrome or Edge was found to make PDFs. Set PDF_BROWSER_PATH.");
    this.busy += 1;
    clearTimeout(this.idleTimer);
    try {
      const browser = await this.launch();
      const page = await browser.newPage();
      try {
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on("request", (request) =>
          request.url().startsWith("data:") ? request.continue() : request.abort(),
        );
        await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
        const pdf = await page.pdf({
          format: "Letter",
          printBackground: true,
          preferCSSPageSize: true,
        });
        return Buffer.from(pdf);
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      this.busy -= 1;
      if (this.busy === 0) this.idleTimer = setTimeout(() => void this.close(), 60_000);
    }
  }

  async close() {
    const browser = this.browser;
    this.browser = null;
    if (browser) await (await browser).close().catch(() => undefined);
  }

  private launch() {
    this.browser ??= puppeteer
      .launch({
        executablePath: this.executablePath!,
        headless: true,
        // Containers run Chromium as root, which needs the sandbox off; desktops keep it.
        args: process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
      })
      .then((browser) => {
        browser.on("disconnected", () => (this.browser = null));
        return browser;
      })
      .catch((error: unknown) => {
        this.browser = null;
        logger.error({ err: error }, "could not start the PDF browser");
        throw error;
      });
    return this.browser;
  }
}
