import { Router } from "express";
import type { Request, Response } from "express";

declare module "express-session" {
  interface SessionData {
    github_token?: string;
    github_user?: {
      login: string;
      name: string;
      avatar_url: string;
    };
  }
}

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// ── Ollama quick check (same logic as anthropic route, duplicated to avoid circular deps) ──
const OLLAMA_BASE = "http://localhost:11434";
const PHI_CANDIDATES = ["phi4", "phi3.5", "phi3:mini", "phi3", "phi"];

async function localModelInfo(): Promise<{ available: boolean; model: string | null }> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return { available: false, model: null };
    const data = (await res.json()) as { models: { name: string }[] };
    const names = (data.models ?? []).map((m: { name: string }) => m.name.split(":")[0]);
    const pick = PHI_CANDIDATES.find((c) => names.some((n: string) => n === c || n.startsWith(c)));
    const anyModel = pick ?? (data.models[0]?.name ?? null);
    return { available: !!anyModel, model: anyModel };
  } catch {
    return { available: false, model: null };
  }
}

function getBaseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "localhost";
  return `${proto}://${host}`;
}

// GET /api/auth/me
router.get("/auth/me", async (req: Request, res: Response) => {
  const local = await localModelInfo();

  if (req.session.github_user) {
    res.json({
      user: req.session.github_user,
      provider: "github",
      localModel: local,
    });
    return;
  }
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    res.json({ user: null, provider: "anthropic", localModel: local });
    return;
  }
  if (local.available) {
    res.json({ user: null, provider: "local", localModel: local });
    return;
  }
  res.json({ user: null, provider: null, localModel: local });
});

// GET /api/auth/github — redirect to GitHub OAuth
router.get("/auth/github", (req: Request, res: Response) => {
  if (!GITHUB_CLIENT_ID) {
    res.status(500).json({
      error:
        "GITHUB_CLIENT_ID is not set. Create a GitHub OAuth App at github.com/settings/developers " +
        "and add GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET to your environment.",
    });
    return;
  }
  const callbackUrl = `${getBaseUrl(req)}/api/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: callbackUrl,
    scope: "read:user",
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /api/auth/github/callback — exchange code for token
router.get("/auth/github/callback", async (req: Request, res: Response) => {
  const { code } = req.query as { code?: string };
  if (!code || !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    res.redirect("/?auth=error&reason=missing_code");
    return;
  }
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${getBaseUrl(req)}/api/auth/github/callback`,
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      console.error("GitHub token error:", tokenData);
      res.redirect("/?auth=error&reason=no_token");
      return;
    }
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
    });
    const userData = (await userRes.json()) as { login: string; name?: string; avatar_url: string };
    req.session.github_token = tokenData.access_token;
    req.session.github_user = {
      login: userData.login,
      name: userData.name || userData.login,
      avatar_url: userData.avatar_url,
    };
    res.redirect("/");
  } catch (err) {
    console.error("GitHub OAuth callback error:", err);
    res.redirect("/?auth=error&reason=exception");
  }
});

// POST /api/auth/logout
router.post("/auth/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) { res.status(500).json({ error: "Could not logout" }); }
    else { res.clearCookie("connect.sid"); res.json({ success: true }); }
  });
});

export default router;
