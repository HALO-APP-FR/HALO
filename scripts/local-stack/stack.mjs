#!/usr/bin/env node
/**
 * Préproduction LOCALE de HALO, au plus près de Supabase, sans Docker :
 *   PostgreSQL 15+ (local)  +  GoTrue (auth Supabase)  +  PostgREST (API Supabase)
 *   + un relais HTTP qui expose /auth/v1 et /rest/v1 comme Supabase sur :54321
 *   + une boîte e-mail de test (SMTP :1025) qui garde les messages dans .local-stack/mails/
 *
 * Données FICTIVES uniquement. Aucune clé de production ici : les clés sont générées
 * localement et écrites dans .env.local (ignoré par git).
 *
 *   node scripts/local-stack/stack.mjs setup   # télécharge GoTrue et PostgREST (une fois)
 *   node scripts/local-stack/stack.mjs reset   # base vierge + migrations HALO
 *   node scripts/local-stack/stack.mjs start   # lance auth, API, relais et boîte e-mail
 *
 * Variables : PG_ADMIN_URL (défaut postgres://postgres:test@127.0.0.1:5432/postgres)
 */
import { spawn, execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const DIR = join(ROOT, ".local-stack");
const BIN = join(DIR, "bin");
const MAILS = join(DIR, "mails");
const DB = "halo_local";
const ADMIN = process.env.PG_ADMIN_URL ?? "postgres://postgres:test@127.0.0.1:5432/postgres";
const DB_URL = ADMIN.replace(/\/[^/]*$/, `/${DB}`);
const GOTRUE_VERSION = "v2.177.0";
const POSTGREST_VERSION = "v12.2.3";
const PORTS = { api: 54321, auth: 9999, rest: 3001, smtp: 1025, app: 3000 };

mkdirSync(BIN, { recursive: true });
mkdirSync(MAILS, { recursive: true });

const b64url = (b) => Buffer.from(b).toString("base64url");
function sign(payload, secret) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${head}.${body}.${b64url(createHmac("sha256", secret).update(`${head}.${body}`).digest())}`;
}
function secrets() {
  const file = join(DIR, "secrets.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const jwt = randomBytes(32).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
  const s = {
    jwt,
    anon: sign({ role: "anon", iss: "halo-local", exp }, jwt),
    service: sign({ role: "service_role", iss: "halo-local", exp }, jwt),
    cron: randomBytes(16).toString("hex"),
  };
  writeFileSync(file, JSON.stringify(s, null, 2));
  return s;
}
const STORE = join(DIR, "storage");

/**
 * Stockage de fichiers façon Supabase Storage, pour la préproduction LOCALE uniquement.
 * Les droits ne sont pas réimplémentés : chaque dépôt / lecture est exécuté en base sous le rôle
 * de la personne (JWT vérifié), donc avec les MÊMES politiques que storage.objects en ligne.
 */
function verifyJwt(token, secret) {
  const [h, p, sig] = (token ?? "").split(".");
  if (!h || !p || !sig) return null;
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  if (expected !== sig) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp && claims.exp * 1000 < Date.now() ? null : claims;
}
const sqlLit = (v) => `'${String(v).replace(/'/g, "''")}'`;
function asUser(claims, sql) {
  const role = claims.role === "service_role" ? "service_role" : claims.role === "authenticated" ? "authenticated" : "anon";
  const script = `begin; set local role ${role}; select set_config('request.jwt.claims', ${sqlLit(JSON.stringify(claims))}, true); ${sql}; commit;`;
  return execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", script], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}
const signFor = (secret, name, exp) => createHmac("sha256", secret).update(`${name}:${exp}`).digest("base64url");

function storage(req, res, cors, s) {
  const send = (code, body) => res.writeHead(code, { ...cors, "content-type": "application/json" }).end(JSON.stringify(body));
  const url = new URL(req.url, "http://x");
  const path = url.pathname.slice("/storage/v1".length);
  // Lecture par URL signée
  let m = /^\/object\/sign\/org-files\/(.+)$/.exec(path);
  if (req.method === "GET" && m) {
    const name = decodeURIComponent(m[1]);
    const [exp, token] = (url.searchParams.get("token") ?? ".").split(".");
    if (Number(exp) < Date.now() || token !== signFor(s.jwt, name, exp)) return send(400, { error: "InvalidSignature" });
    const file = join(STORE, name);
    if (!existsSync(file)) return send(404, { error: "not_found" });
    const meta = JSON.parse(readFileSync(`${file}.meta.json`, "utf8"));
    return res.writeHead(200, { ...cors, "content-type": meta.type }).end(readFileSync(file));
  }
  const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /, ""), s.jwt);
  if (!claims) return send(401, { error: "invalid_jwt" });
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    try {
      // Dépôt : refusé par la base si aucun emplacement réservé (begin_upload) pour cette personne
      m = /^\/object\/org-files\/([\w./-]+)$/.exec(path);
      if (req.method === "POST" && m) {
        const name = m[1];
        let type = req.headers["content-type"] ?? "";
        let bytes = body;
        // Envoi multipart (supabase-js avec un Blob) : on extrait la partie fichier
        const boundary = /multipart\/form-data;\s*boundary=(.+)$/.exec(type)?.[1];
        if (boundary) {
          const sep = Buffer.from(`--${boundary}`);
          let at = body.indexOf(sep);
          while (at !== -1) {
            const next = body.indexOf(sep, at + sep.length);
            if (next === -1) break;
            const part = body.subarray(at + sep.length + 2, next - 2);
            const headEnd = part.indexOf("\r\n\r\n");
            const head = part.subarray(0, headEnd).toString();
            if (/filename=|content-type/i.test(head) && /content-type:\s*(\S+)/i.test(head)) {
              type = /content-type:\s*(\S+)/i.exec(head)[1];
              bytes = part.subarray(headEnd + 4);
              break;
            }
            at = next;
          }
        }
        if (!/^image\/(jpeg|png|webp|heic)$/.test(type)) return send(400, { error: "invalid_mime_type" });
        if (bytes.length > 15728640) return send(413, { error: "too_large" });
        asUser(claims, `insert into storage.objects (bucket_id, name, owner, metadata) values ('org-files', ${sqlLit(name)}, ${sqlLit(claims.sub)}, ${sqlLit(JSON.stringify({ size: bytes.length, mimetype: type }))})`);
        mkdirSync(join(STORE, name, ".."), { recursive: true });
        writeFileSync(join(STORE, name), bytes);
        writeFileSync(join(STORE, `${name}.meta.json`), JSON.stringify({ type }));
        return send(200, { Key: `org-files/${name}` });
      }
      // Suppression (même règle que la base : politique « delete » sous le rôle de la personne)
      if (req.method === "DELETE" && /^\/object\/org-files\/?$/.test(path)) {
        const names = JSON.parse(body.toString() || "{}").prefixes ?? [];
        const out = [];
        for (const name of names) {
          const n = asUser(claims, `with d as (delete from storage.objects where bucket_id = 'org-files' and name = ${sqlLit(name)} returning 1) select count(*) from d`).split("\n").pop();
          if (n === "1") out.push({ name });
        }
        return send(200, out);
      }
      // URL signées : seulement pour les fichiers que la personne a le droit de lire
      m = /^\/object\/sign\/org-files(?:\/(.+))?$/.exec(path);
      if (req.method === "POST" && m) {
        const input = JSON.parse(body.toString() || "{}");
        const names = m[1] ? [decodeURIComponent(m[1])] : input.paths ?? [];
        const exp = Date.now() + Number(input.expiresIn ?? 60) * 1000;
        const out = names.map((name) => {
          const visible = asUser(claims, `select count(*) from storage.objects where bucket_id = 'org-files' and name = ${sqlLit(name)}`).split("\n").pop() === "1";
          return visible
            ? { path: name, signedURL: `/object/sign/org-files/${encodeURIComponent(name)}?token=${exp}.${signFor(s.jwt, name, String(exp))}`, error: null }
            : { path: name, signedURL: null, error: "Either the object does not exist or you do not have access to it" };
        });
        if (m[1]) return out[0].signedURL ? send(200, { signedURL: out[0].signedURL }) : send(400, { error: out[0].error });
        return send(200, out);
      }
      return send(404, { error: "not_found" });
    } catch (e) {
      return send(403, { error: "Unauthorized", message: String(e.stderr ?? e).slice(0, 200) });
    }
  });
}

const psql = (url, args) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", ...args], { stdio: "inherit" });

function writeEnv(s) {
  const env = [
    "# Généré par scripts/local-stack/stack.mjs : préproduction LOCALE, données fictives",
    `NEXT_PUBLIC_SUPABASE_URL=http://localhost:${PORTS.api}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${s.anon}`,
    `NEXT_PUBLIC_HALO_ENV=preprod-local`,
    `SUPABASE_SERVICE_ROLE_KEY=${s.service}`,
    `SMTP_URL=smtp://localhost:${PORTS.smtp}`,
    `EMAIL_FROM=HALO <no-reply@halo.test>`,
    `CRON_SECRET=${s.cron}`,
    "",
  ].join("\n");
  writeFileSync(join(ROOT, ".env.local"), env);
}

async function setup() {
  const dl = (url, out) => execFileSync("curl", ["-sSfL", "-o", out, url], { stdio: "inherit" });
  if (!existsSync(join(BIN, "postgrest"))) {
    dl(`https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz`, join(BIN, "pgrst.tar.xz"));
    execFileSync("tar", ["xf", "pgrst.tar.xz"], { cwd: BIN });
  }
  if (!existsSync(join(BIN, "gotrue", "auth"))) {
    mkdirSync(join(BIN, "gotrue"), { recursive: true });
    dl(`https://github.com/supabase/auth/releases/download/${GOTRUE_VERSION}/auth-${GOTRUE_VERSION}-x86.tar.gz`, join(BIN, "auth.tgz"));
    execFileSync("tar", ["xzf", "auth.tgz", "-C", "gotrue"], { cwd: BIN });
  }
  console.log("✓ binaires prêts dans .local-stack/bin");
}

function gotrueEnv(s) {
  return {
    ...process.env,
    GOTRUE_DB_DRIVER: "postgres",
    DATABASE_URL: DB_URL.replace("postgres://postgres:test@", "postgres://supabase_auth_admin:local-auth-admin@") + "?search_path=auth&sslmode=disable",
    GOTRUE_DB_MIGRATIONS_PATH: join(BIN, "gotrue", "migrations"),
    GOTRUE_API_HOST: "127.0.0.1",
    PORT: String(PORTS.auth),
    API_EXTERNAL_URL: `http://localhost:${PORTS.api}/auth/v1`,
    GOTRUE_SITE_URL: `http://localhost:${PORTS.app}`,
    GOTRUE_URI_ALLOW_LIST: `http://localhost:${PORTS.app}/**`,
    GOTRUE_JWT_SECRET: s.jwt,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_DISABLE_SIGNUP: "false",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "false",
    GOTRUE_MAILER_OTP_EXP: "600",
    GOTRUE_SMTP_HOST: "127.0.0.1",
    GOTRUE_SMTP_PORT: String(PORTS.smtp),
    GOTRUE_SMTP_USER: "local",
    GOTRUE_SMTP_PASS: "local",
    GOTRUE_SMTP_ADMIN_EMAIL: "no-reply@halo.test",
    GOTRUE_SMTP_SENDER_NAME: "HALO",
    GOTRUE_SMTP_MAX_FREQUENCY: "1s",
    GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000",
    GOTRUE_RATE_LIMIT_VERIFY: "1000",
    GOTRUE_RATE_LIMIT_OTP: "1000",
    GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: `http://localhost:${PORTS.api}/_templates/magic_link.html`,
    GOTRUE_MAILER_TEMPLATES_CONFIRMATION: `http://localhost:${PORTS.api}/_templates/magic_link.html`,
    GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: "Votre connexion à HALO",
    GOTRUE_MAILER_SUBJECTS_CONFIRMATION: "Votre connexion à HALO",
    GOTRUE_LOG_LEVEL: "warn",
  };
}

async function waitFor(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout ${url}`);
}

async function reset() {
  const s = secrets();
  psql(ADMIN, ["-c", `drop database if exists ${DB} with (force)`, "-c", `create database ${DB}`]);
  psql(DB_URL, ["-f", join(ROOT, "scripts/local-stack/init.sql")]);
  // GoTrue crée et migre le schéma auth, puis s'arrête
  const g = spawn(join(BIN, "gotrue", "auth"), ["migrate"], { env: gotrueEnv(s), stdio: "inherit" });
  await new Promise((res, rej) => g.on("exit", (c) => (c === 0 ? res() : rej(new Error(`gotrue migrate ${c}`)))));
  for (const f of readdirSync(join(ROOT, "supabase/migrations")).sort()) {
    console.log(`→ migration ${f}`);
    psql(DB_URL, ["-f", join(ROOT, "supabase/migrations", f)]);
  }
  writeEnv(s);
  console.log("✓ base locale prête, .env.local écrit (préproduction locale)");
}

// Modèle d'e-mail de connexion : un lien ET un code (le lien peut s'ouvrir dans un autre navigateur)
const MAGIC_TEMPLATE = `<h2>Connexion à HALO</h2><p><a href="{{ .ConfirmationURL }}">Se connecter</a></p><p>Ou saisissez ce code : <strong>{{ .Token }}</strong></p>`;

async function start() {
  const s = secrets();
  writeEnv(s);
  // Boîte e-mail de test
  const { SMTPServer } = await import("smtp-server");
  const { simpleParser } = await import("mailparser");
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onAuth: (_a, _s, cb) => cb(null, { user: "local" }),
    // Simule un refus du fournisseur pour les adresses « bounce… » (test de l'état « échec d'envoi »)
    onRcptTo: (addr, _s, cb) => (addr.address.toLowerCase().startsWith("bounce") ? cb(Object.assign(new Error("550 mailbox unavailable"), { responseCode: 550 })) : cb()),
    onData(stream, session, cb) {
      simpleParser(stream).then((m) => {
        const to = (session.envelope.rcptTo[0]?.address ?? "unknown").toLowerCase();
        const file = join(MAILS, `${Date.now()}-${to}.json`);
        writeFileSync(file, JSON.stringify({ to, subject: m.subject, html: m.html, text: m.text, at: new Date().toISOString() }, null, 2));
        cb();
      }, cb);
    },
  });
  smtp.listen(PORTS.smtp, "127.0.0.1");

  // Relais façon Supabase : /auth/v1 → GoTrue, /rest/v1 → PostgREST (avec CORS pour le navigateur)
  const proxy = http.createServer((req, res) => {
    const cors = {
      "access-control-allow-origin": req.headers.origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, range, x-supabase-api-version, x-upsert, cache-control",
      "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "access-control-expose-headers": "content-range, x-total-count",
    };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    if (req.url.startsWith("/storage/v1/")) return storage(req, res, cors, s);
    if (req.url.startsWith("/_templates/")) return res.writeHead(200, { "content-type": "text/html" }).end(MAGIC_TEMPLATE);
    const route = req.url.startsWith("/auth/v1") ? { port: PORTS.auth, path: req.url.slice(8) || "/" } : req.url.startsWith("/rest/v1") ? { port: PORTS.rest, path: req.url.slice(8) || "/" } : null;
    if (!route) return res.writeHead(404, cors).end();
    // Comme la passerelle Supabase : une clé (apikey) est obligatoire
    const key = req.headers.apikey ?? (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (key !== s.anon && key !== s.service && !req.headers.authorization) return res.writeHead(401, cors).end('{"message":"No API key found in request"}');
    const headers = { ...req.headers, host: `127.0.0.1:${route.port}` };
    if (!headers.authorization && key) headers.authorization = `Bearer ${key}`;
    const up = http.request({ host: "127.0.0.1", port: route.port, path: route.path, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors });
      r.pipe(res);
    });
    up.on("error", (e) => res.writeHead(502, cors).end(String(e)));
    req.pipe(up);
  });
  proxy.listen(PORTS.api, "127.0.0.1");

  const gotrue = spawn(join(BIN, "gotrue", "auth"), ["serve"], { env: gotrueEnv(s), stdio: "inherit" });
  const rest = spawn(join(BIN, "postgrest"), [], {
    env: {
      ...process.env,
      PGRST_DB_URI: DB_URL.replace("postgres://postgres:test@", "postgres://authenticator:local-authenticator@"),
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: s.jwt,
      PGRST_SERVER_PORT: String(PORTS.rest),
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_DB_CHANNEL_ENABLED: "false",
      PGRST_LOG_LEVEL: "error",
    },
    stdio: "inherit",
  });
  const stop = () => {
    gotrue.kill();
    rest.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await waitFor(`http://127.0.0.1:${PORTS.auth}/health`);
  await waitFor(`http://127.0.0.1:${PORTS.rest}/`);
  console.log(`✓ préproduction locale prête : API http://localhost:${PORTS.api} · e-mails dans .local-stack/mails`);
}

const cmd = process.argv[2];
if (cmd === "setup") await setup();
else if (cmd === "reset") await reset();
else if (cmd === "start") await start();
else console.log("usage : setup | reset | start");
