const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs-extra");

const validateVideoFile = async (filePath) => {
  console.log("[VALIDATION] Validating video file:", filePath);

  try {
    // Check if file exists
    if (!(await fs.pathExists(filePath))) {
      throw new Error("Video file not found");
    }

    // Check file size
    const stats = await fs.stat(filePath);
    if (stats.size === 0) {
      throw new Error("Video file is empty");
    }

    if (stats.size < 1024) {
      throw new Error("Video file too small to be valid");
    }

    console.log(`[VALIDATION] File size check passed: ${stats.size} bytes`);

    // Validate with FFprobe
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (error, metadata) => {
        if (error) {
          reject(new Error(`Video validation failed: ${error.message}`));
          return;
        }

        if (!metadata.streams || metadata.streams.length === 0) {
          reject(new Error("No streams found in video file"));
          return;
        }

        const videoStream = metadata.streams.find(
          (stream) => stream.codec_type === "video"
        );
        if (!videoStream) {
          reject(new Error("No video stream found in file"));
          return;
        }

        if (videoStream.duration <= 0) {
          reject(new Error("Invalid video duration"));
          return;
        }

        console.log(
          `[VALIDATION] ✅ Video validation passed - Duration: ${videoStream.duration}s`
        );
        resolve(true);
      });
    });
  } catch (error) {
    console.error("[VALIDATION] ❌ Video validation failed:", error);
    throw error;
  }
};

module.exports = { validateVideoFile };
