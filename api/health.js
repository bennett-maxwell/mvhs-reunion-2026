module.exports = function handler(req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    ok: true,
    service: "mvhs-reunion-2026",
    driveConfigured: Boolean(process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET && process.env.GDRIVE_REFRESH_TOKEN),
    folderId: process.env.GDRIVE_FOLDER_ID || "1fGNsPdZqi4rxEOeFmL-yruHR6PNglC7_",
  }));
};
