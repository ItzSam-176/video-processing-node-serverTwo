const ffmpeg = require("fluent-ffmpeg");
const path = require("path");

const setupFFmpeg = () => {
  // Set FFmpeg and FFprobe paths if needed
  // On most systems, these should be available in PATH
  try {
    // Try to set paths explicitly if they're not in PATH
    // ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg');
    // ffmpeg.setFfprobePath('/usr/local/bin/ffprobe');

    console.log("[FFMPEG] FFmpeg configured successfully");
  } catch (error) {
    console.warn(
      "[FFMPEG] Warning: FFmpeg path not explicitly set, using PATH"
    );
  }
};

module.exports = { setupFFmpeg, ffmpeg };
