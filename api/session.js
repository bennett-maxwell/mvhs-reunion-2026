const { google } = require("googleapis");

const ROOT_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || "1fGNsPdZqi4rxEOeFmL-yruHR6PNglC7_";
const MAX_FILES = Number(process.env.MAX_FILES || 5);
const MAX_BYTES = Number(process.env.MAX_BYTES || 60 * 1024 * 1024);
const BODY_LIMIT = Number(process.env.SESSION_BODY_LIMIT_BYTES || 256 * 1024);
const CORS_ORIGINS = new Set([
  "https://bennett-maxwell.github.io",
  "https://mvhs-reunion-2026.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (CORS_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > BODY_LIMIT) {
        reject(new Error("Metadata request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authClient() {
  const required = ["GDRIVE_CLIENT_ID", "GDRIVE_CLIENT_SECRET", "GDRIVE_REFRESH_TOKEN"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Server is missing Drive credentials: ${missing.join(", ")}`);
  const auth = new google.auth.OAuth2(process.env.GDRIVE_CLIENT_ID, process.env.GDRIVE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GDRIVE_REFRESH_TOKEN });
  return auth;
}

function driveClient(auth) {
  return google.drive({ version: "v3", auth });
}

function safeName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "contributor";
}

function contributorLabel(contributor) {
  const name = `${contributor.first || ""} ${contributor.last || ""}`.trim();
  return safeName(name || contributor.phone || contributor.email || "contributor");
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
}

async function createFolder(drive, name, parentId) {
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id,webViewLink",
    supportsAllDrives: true,
  });
  return created.data;
}

async function createUploadSession(auth, photo, parentId) {
  const access = await auth.getAccessToken();
  const token = access.token || access;
  const metadata = {
    name: safeName(photo.filename || "photo.jpg"),
    parents: [parentId],
    description: `MVHS2011 sha256=${String(photo.sha256 || "").toLowerCase()} integrity=pending-resumable`,
  };
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,size,mimeType", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": photo.type || "application/octet-stream",
      "X-Upload-Content-Length": String(photo.size || 0),
    },
    body: JSON.stringify(metadata),
  });
  const uploadUrl = response.headers.get("location");
  if (!response.ok || !uploadUrl) {
    throw new Error(`Could not create upload session for ${photo.filename || "photo"}.`);
  }
  return {
    filename: metadata.name,
    type: photo.type || "application/octet-stream",
    size: photo.size || 0,
    sha256: String(photo.sha256 || "").toLowerCase(),
    uploadUrl,
  };
}

function validate(payload) {
  if (!payload || typeof payload !== "object") return "Missing upload payload.";
  const contributor = payload.contributor || {};
  if (!contributor.first && !contributor.last && !contributor.phone) return "Please add a name or phone number.";
  if (!payload.consent) return "Consent is required.";
  if (!Array.isArray(payload.photos) || payload.photos.length === 0) return "Please add at least one photo.";
  if (payload.photos.length > MAX_FILES) return `Please send no more than ${MAX_FILES} photos.`;
  for (const photo of payload.photos) {
    if (!photo || !photo.filename || !photo.size) return "A photo is missing required metadata.";
    if (photo.size > MAX_BYTES) return `${photo.filename} is too large.`;
  }
  return null;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Use POST." });

  try {
    const payload = JSON.parse(await readBody(req));
    const problem = validate(payload);
    if (problem) return json(res, 400, { ok: false, error: problem });

    const auth = authClient();
    const drive = driveClient(auth);
    const folderName = `${contributorLabel(payload.contributor || {})} ${nowStamp()}`;
    const folder = await createFolder(drive, folderName, ROOT_FOLDER_ID);
    const sessions = [];
    for (const photo of payload.photos) {
      sessions.push(await createUploadSession(auth, photo, folder.id));
    }

    return json(res, 200, {
      ok: true,
      folderId: folder.id,
      folder: folder.webViewLink,
      sessions,
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message || String(error) });
  }
};
