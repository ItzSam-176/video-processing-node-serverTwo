const fs = require("fs-extra");
const path = require("path");

const cleanupTempFiles = async () => {
  console.log("[CLEANUP] Starting temp file cleanup");

  const tempDir = path.join(__dirname, "../temp");
  const uploadsDir = path.join(__dirname, "../uploads");

  try {
    // Clean temp directory
    const tempFiles = await fs.readdir(tempDir).catch(() => []);
    let tempCleaned = 0;

    for (const file of tempFiles) {
      const filePath = path.join(tempDir, file);
      const stats = await fs.stat(filePath).catch(() => null);

      if (stats && Date.now() - stats.birthtime.getTime() > 30 * 60 * 1000) {
        // 30 minutes
        await fs.remove(filePath);
        tempCleaned++;
      }
    }

    // Clean old uploads
    const uploadFiles = await fs.readdir(uploadsDir).catch(() => []);
    let uploadsCleaned = 0;

    for (const file of uploadFiles) {
      const filePath = path.join(uploadsDir, file);
      const stats = await fs.stat(filePath).catch(() => null);

      if (
        stats &&
        Date.now() - stats.birthtime.getTime() > 2 * 60 * 60 * 1000
      ) {
        // 2 hours
        await fs.remove(filePath);
        uploadsCleaned++;
      }
    }

    if (tempCleaned > 0 || uploadsCleaned > 0) {
      console.log(
        `[CLEANUP] Cleaned ${tempCleaned} temp files and ${uploadsCleaned} upload files`
      );
    }
  } catch (error) {
    console.error("[CLEANUP] Cleanup failed:", error);
  }
};

module.exports = { cleanupTempFiles };
